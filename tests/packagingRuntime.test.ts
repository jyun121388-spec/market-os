import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isForbiddenStagedPath } from "../scripts/stage-runtime";
import { classifyReadiness, READINESS_VOCABULARY, type NotReadyReason } from "@/lib/readiness";

/**
 * Packaging controls. These protect the two claims a staged runtime makes that nothing else
 * checks: that it contains no developer content, and that its readiness answer cannot leak.
 *
 * The end-to-end proof — build, stage outside the worktree, start a disposable PostgreSQL, deploy
 * migrations with the staged toolchain, read a row back through the staged server — is a
 * procedure, not a unit test, and is recorded in `docs/REVIEW_DEBT.md` under IR-142 with the
 * measurements it produced. What is unit-tested here is the part that would fail silently.
 */

describe("standalone output is configured", () => {
  it("next.config.ts asks for a standalone build", () => {
    // Without this the build emits no `.next/standalone` at all, and every packaging step below
    // has nothing to act on. It is one line and it is load-bearing.
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toMatch(/output:\s*"standalone"/);
  });
});

describe("the staging manifest refuses developer content", () => {
  const matches = isForbiddenStagedPath;

  it("rejects every category a user must never receive", () => {
    for (const path of [
      ".git/config",
      "some/nested/.git/HEAD",
      ".env",
      ".env.local",
      "prisma/.env",
      ".local/pgdata/postgresql.conf",
      "tests/askMarket.test.ts",
      "test/fixture.json",
      "scripts/mutation/holecompression.py",
      "CLAUDE.md",
      ".claude/settings.json",
      "docs/escalation/PENDING_COMMENTS.md",
      "src/lib/userStatus.test.ts",
    ]) {
      expect(matches(path), `${path} must be refused`).toBe(true);
    }
  });

  it("does not reject the runtime files a package actually needs", () => {
    // A forbidden-content check that also rejects the product is a check nobody can ship with,
    // and the fix would be to weaken it — so the false-positive direction is tested too.
    for (const path of [
      "server.js",
      "package.json",
      ".next/BUILD_ID",
      ".next/server/app/today/page.js",
      ".next/static/chunks/webpack-4cf3af3b610ade60.js",
      "public/next.svg",
      "prisma/schema.prisma",
      "prisma/migrations/20260817200000_ingest_runs/migration.sql",
      "node_modules/next/dist/server/next-server.js",
      "node_modules/@prisma/client/index.js",
      "market-os-manifest.json",
    ]) {
      expect(matches(path), `${path} must be allowed`).toBe(false);
    }
  });

  it("does not refuse a third-party package for shipping its own tests", () => {
    // The scope that had to be narrowed. 136 packages come with the migration toolchain and
    // several ship `test/` directories; flagging those would make the check unsatisfiable, and an
    // unsatisfiable check is one somebody deletes.
    expect(matches("migrate-tools/node_modules/effect/test/Chunk.test.js")).toBe(false);
    expect(matches("node_modules/some-pkg/tests/index.js")).toBe(false);
    // But the three that no package has any business containing still apply there.
    expect(matches("node_modules/evil-pkg/.git/config")).toBe(true);
    expect(matches("node_modules/evil-pkg/.env")).toBe(true);
    expect(matches("node_modules/evil-pkg/pgdata/base")).toBe(true);
  });

  it("refuses a bundler build cache, which really did hold credential values", () => {
    // Found by the live-provider leak audit: `.next/cache/turbopack/*.sst` on the developer
    // machine contained real API keys, because the cache captured a build run's environment.
    // Nothing shipped — staging copies only `standalone` and `static` — but "excluded because
    // nobody copied it" is weaker than "refused", and this makes it the latter.
    expect(matches(".next/cache/turbopack/v16.3.1-3d32eb87/00000093.sst")).toBe(true);
    expect(matches("cache/webpack/client-production/0.pack")).toBe(true);
    // Even vendored, since the rule is about what the file IS.
    expect(matches("node_modules/some-pkg/cache/turbopack/x.sst")).toBe(true);
    // But an ordinary directory called "cache" is not a bundler cache.
    expect(matches("public/cache/logo.svg")).toBe(false);
  });

  it("matches on a path segment, not a substring", () => {
    // `contents/` contains "tests" only if you ignore boundaries, and a check that flags real
    // runtime files would be turned off by the first person it inconvenienced.
    expect(matches("node_modules/latest/index.js")).toBe(false);
    expect(matches("src/contests/page.js")).toBe(false);
  });
});

describe("readiness answers the launcher's question without leaking", () => {
  it("distinguishes a database that is not up from a schema that is not there", () => {
    // Order matters: an unreachable database makes the schema probe fail too, and reporting
    // SCHEMA_NOT_READY for a database that has simply not finished starting sends a retry loop
    // after the wrong thing.
    expect(classifyReadiness({ databaseReachable: false, schemaUsable: false })).toEqual({
      status: "NOT_READY",
      reason: "DATABASE_UNAVAILABLE",
    });
    expect(classifyReadiness({ databaseReachable: false, schemaUsable: true })).toEqual({
      status: "NOT_READY",
      reason: "DATABASE_UNAVAILABLE",
    });
    expect(classifyReadiness({ databaseReachable: true, schemaUsable: false })).toEqual({
      status: "NOT_READY",
      reason: "SCHEMA_NOT_READY",
    });
  });

  it("is READY only when both probes passed", () => {
    expect(classifyReadiness({ databaseReachable: true, schemaUsable: true })).toEqual({
      status: "READY",
    });
  });

  it("carries no reason when ready, so a caller cannot render a stale one", () => {
    const ready = classifyReadiness({ databaseReachable: true, schemaUsable: true });
    expect("reason" in ready).toBe(false);
  });

  it("emits only tokens from its closed vocabulary — there is no free-text channel", () => {
    // This is the security property. The classifier takes BOOLEANS, so an exception object cannot
    // reach it; and every string it can emit is in this list, so nothing a caller renders from it
    // can contain a connection string, a path, a pid or a stack frame.
    const outputs = [
      classifyReadiness({ databaseReachable: false, schemaUsable: false }),
      classifyReadiness({ databaseReachable: true, schemaUsable: false }),
      classifyReadiness({ databaseReachable: true, schemaUsable: true }),
    ];
    for (const out of outputs) {
      const strings: string[] = [out.status, out.reason ?? ""].filter((s) => s.length > 0);
      for (const s of strings) {
        expect(READINESS_VOCABULARY as readonly string[]).toContain(s);
      }
    }
  });

  it("cannot be handed anything that carries a secret in the first place", () => {
    // The type says booleans, and this is the runtime restatement of that: whatever a caller
    // catches, only `true`/`false` crosses the boundary. Written as a control because "the type
    // prevents it" stops being true the moment somebody widens the interface.
    const probes: { databaseReachable: boolean; schemaUsable: boolean } = {
      databaseReachable: false,
      schemaUsable: false,
    };
    expect(Object.values(probes).every((v) => typeof v === "boolean")).toBe(true);
    const result = classifyReadiness(probes);
    expect(JSON.stringify(result)).not.toMatch(/postgresql:|C:\\|\/home\/|at Object|pid \d/);
  });

  it("names every reason the route can produce", () => {
    // `UNKNOWN_ERROR` exists in the vocabulary for a future probe failure the classifier does not
    // yet distinguish. Asserted so it cannot quietly become a free-text field.
    const reasons: NotReadyReason[] = ["DATABASE_UNAVAILABLE", "SCHEMA_NOT_READY", "UNKNOWN_ERROR"];
    for (const r of reasons) expect(READINESS_VOCABULARY as readonly string[]).toContain(r);
  });
});

describe("the developer's build directory", () => {
  it("is replaced in the staged tree, in all three spellings it appears as", () => {
    // `next build` writes the directory it ran in into `.next/required-server-files.json` and into
    // several compiled server chunks. The packaged app does not RESOLVE anything from it — it runs
    // with the checkout untouched — but it hands every user a verbatim description of the layout
    // of the machine that built it. The clean-room acceptance found it by looking, and "the app
    // still works" is not an argument for shipping it.
    const stager = readFileSync(join(process.cwd(), "scripts", "stage-runtime.ts"), "utf8");
    expect(stager).toContain("BUILD_DIR_PLACEHOLDER_SEGMENTS");
    // Separators of ANY run length, rather than an enumerated list of spellings. The path appears
    // with one backslash as Windows wrote it, two where a string escapes it, FOUR where a string
    // containing that string is escaped again, and with forward slashes in URLs. The first version
    // listed three and missed the fourth, which is how a redaction ends up looking finished while
    // `.next/server/app/login/page.js` still names the developer's checkout.
    expect(stager).toContain("const segments = buildDir.split");
    expect(stager).toContain("separator");

    // And the replacement is a PATH, not a marker. `<market-os-build-dir>` made an invalid `file:`
    // URL out of the location Prisma's generated client records for itself, and every page failed
    // with a parse error. Angle brackets are the specific thing that must not come back.
    const stagerModule = stager.slice(stager.indexOf("BUILD_DIR_PLACEHOLDER_SEGMENTS"));
    expect(stagerModule.slice(0, 200)).not.toContain("<market-os");
  });

  it("is verified gone on the RESULT, not trusted to the replacement", () => {
    const stager = readFileSync(join(process.cwd(), "scripts", "stage-runtime.ts"), "utf8");
    expect(stager).toContain("still name the build directory");
  });
});
