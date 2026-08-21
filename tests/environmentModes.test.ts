import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The environments this suite actually runs in, and the assumptions that differ between them.
 *
 * `ENVIRONMENT_DRIFT` is a three-instance cluster whose lesson is "a check made on surface text
 * rather than on what the text resolves to" — `localhost` and `127.0.0.1` compared as different
 * hosts, a suite that skipped and read as passing. The countermeasure: for each guard, ask what two
 * different strings could denote the same thing, and what differs between the places this runs.
 *
 * Four hypotheses were probed against the real environments. All four were REFUTED, and recording
 * that is the point — a cluster does not get to keep generating findings just because it exists.
 *
 *  1. "CI skips every integration test, because it blanks DATABASE_URL." Refuted: `vitest.config`
 *     resolves the guard's decision and rewires `DATABASE_URL` to the test database for every
 *     worker, so the 39 integration files run there exactly as they do locally.
 *  2. "File-content assertions break on CRLF." Refuted: no test asserts a multi-line literal
 *     against file text, and the ones that split lines use `\r?\n`.
 *  3. "The no-database path is broken." Refuted: 569 pass and 205 skip across 39 skipped files,
 *     cleanly, in 28s.
 *  4. "ADMIN_EMAILS is frozen into the production build." Refuted: `/admin` is `force-dynamic` and
 *     builds as `ƒ`, so the allowlist is read per request.
 *
 * What this file pins is the two mechanisms those answers depend on. Both are one edit away from
 * silently changing, and neither has anything else watching it.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the CI environment must still run the integration suite", () => {
  /**
   * CI deliberately blanks `DATABASE_URL` so a stray value cannot resolve to the build database,
   * and passes `TEST_DATABASE_URL` instead. Every integration file then gates on
   * `Boolean(process.env.DATABASE_URL)`, which would be false — except the vitest config rewires
   * it from the guard's decision before the workers start.
   *
   * That rewiring is the only thing standing between "CI runs 39 integration files" and "CI
   * creates a test database, migrates it, and then skips everything that would use it while
   * reporting green". Remove it and nothing else fails.
   */
  it("rewires DATABASE_URL from the guard's resolved decision", () => {
    const config = read("vitest.config.mts");
    expect(config).toContain("process.env.DATABASE_URL = decision.databaseUrl");
    // And passes it to the workers, not just to the parent process.
    expect(config).toMatch(/env:\s*decision\.databaseUrl\s*\?\s*\{\s*DATABASE_URL/);
  });

  it("gates every integration file on the same condition, so the rewiring covers all of them", () => {
    const files = readdirSync(join(process.cwd(), "tests/integration")).filter((n) =>
      n.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThanOrEqual(39);

    const idioms = new Set(
      files.map((name) => {
        const source = read(`tests/integration/${name}`);
        const match = /const hasDb = ([^;]+);/.exec(source);
        return match ? match[1].trim() : `NO GATE in ${name}`;
      }),
    );
    // One idiom, not several. A file gating on something else would be invisible to the rewiring.
    expect([...idioms]).toEqual(["Boolean(process.env.DATABASE_URL)"]);
  });
});

describe("the no-database environment must skip, never fail", () => {
  /**
   * A clean checkout with no database is a real environment — it is what a new contributor has
   * before running anything, and what `npm ci && npm test` sees. The suite must be honest there:
   * skipped is a legitimate answer, and a skip that reads as a pass is `EN-02`.
   */
  it("keeps the guard fail-closed rather than falling back", () => {
    const guard = read("tests/support/testDatabaseGuard.mts");
    // The rule that matters: never silently borrow DATABASE_URL for a destructive suite.
    expect(guard).toContain("same database");
    expect(guard.toLowerCase()).toContain("refus");
  });

  it("does not let an integration file run without a database by accident", () => {
    // Every integration file must use `describeIfDb`, not a bare `describe`. One that forgot would
    // try to reach a database that is not there and fail in the no-DB environment — reported as a
    // broken suite rather than as the missing precondition it is.
    const files = readdirSync(join(process.cwd(), "tests/integration")).filter((n) =>
      n.endsWith(".test.ts"),
    );
    for (const name of files) {
      const source = read(`tests/integration/${name}`);
      expect(source, `${name} must gate on describeIfDb`).toContain("describeIfDb(");
      expect(source, `${name} has an ungated describe`).not.toMatch(/^describe\(/m);
    }
  });
});
