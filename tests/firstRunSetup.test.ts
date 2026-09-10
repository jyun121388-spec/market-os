import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { classifyFirstRun, FIRST_RUN_ACTIONS } from "../packaging/first-run-classify.mjs";
import { makeRedactor } from "../packaging/first-run-redact.mjs";
import type { FirstRunProbes } from "../packaging/first-run-classify.js";
import { MIGRATION_RUNNER_PATH, PACKAGED_SETUP_FILES } from "../scripts/stage-runtime";

/**
 * Unit H — first-run setup.
 *
 * The files under test are the files that SHIP. They are plain `.mjs` because a packaged Market OS
 * has no TypeScript loader, and they are imported here directly rather than re-implemented, so
 * there is no second copy of the decision that touches a user's database.
 */

const PACKAGING = join(process.cwd(), "packaging");
const source = (name: string) => readFileSync(join(PACKAGING, name), "utf8");

/**
 * The same file with its comments removed.
 *
 * Every structural scan below runs on this rather than on the raw text, and the reason is a
 * failure this project has now made three times: a substring scan that fires on the sentence
 * explaining why the thing is forbidden. `first-run.mjs` says in as many words that a package has
 * no `.env` and that it does not loop over `migration.sql`, and the first version of these tests
 * failed on both — reporting the denial as the offence.
 *
 * So: assert the affirmative form is absent from the CODE, and, where it matters, assert the
 * denial is present in the prose.
 */
function code(name: string): string {
  return source(name)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

const THREE = ["20260815155143_init", "20260815161529_filings", "20260815162331_events"];

function probes(over: Partial<FirstRunProbes> = {}): FirstRunProbes {
  return {
    databaseReachable: true,
    publicTables: [],
    migrationTablePresent: false,
    appliedMigrations: [],
    packagedMigrations: THREE,
    ...over,
  };
}

describe("what a first run decides to do", () => {
  it("applies everything to a database that is empty", () => {
    const verdict = classifyFirstRun(probes());
    expect(verdict.action).toBe("APPLY_MIGRATIONS");
    expect(verdict).toHaveProperty("pending", THREE);
  });

  it("applies only what is missing, so a resumed install is not a repeat", () => {
    const verdict = classifyFirstRun(
      probes({
        publicTables: ["_prisma_migrations", "Source"],
        migrationTablePresent: true,
        appliedMigrations: [THREE[0]],
      }),
    );
    expect(verdict.action).toBe("APPLY_MIGRATIONS");
    expect(verdict).toHaveProperty("pending", [THREE[1], THREE[2]]);
  });

  it("does nothing at all when the schema is already current", () => {
    const verdict = classifyFirstRun(
      probes({
        publicTables: ["_prisma_migrations", "Source"],
        migrationTablePresent: true,
        appliedMigrations: [...THREE],
      }),
    );
    expect(verdict.action).toBe("NOTHING_TO_DO");
  });

  it("is idempotent: the verdict after a successful apply is NOTHING_TO_DO, not a second apply", () => {
    // The property an installer actually depends on, stated as the sequence a user produces by
    // running the thing twice.
    const before = classifyFirstRun(probes());
    expect(before.action).toBe("APPLY_MIGRATIONS");
    const after = classifyFirstRun(
      probes({ migrationTablePresent: true, appliedMigrations: [...THREE] }),
    );
    expect(after.action).toBe("NOTHING_TO_DO");
  });

  it("waits for a database that has not answered instead of guessing about its schema", () => {
    // Every schema probe is false when the database is down. Reporting the schema as the problem
    // would send a launcher's retry loop, or a person, after entirely the wrong thing.
    const verdict = classifyFirstRun(probes({ databaseReachable: false }));
    expect(verdict.action).toBe("WAIT_FOR_DATABASE");
  });

  it("refuses a database full of somebody else's tables", () => {
    const verdict = classifyFirstRun(
      probes({ publicTables: ["orders", "customers", "invoices"], migrationTablePresent: false }),
    );
    expect(verdict.action).toBe("REFUSE_FOREIGN_DATABASE");
    expect(verdict).toHaveProperty("foreignTableCount", 3);
  });

  it("counts the foreign tables and does not name them", () => {
    // A refusal is actionable without the names — the answer is always "use an empty database" —
    // and the names are the schema of whatever else this person runs, on their way into a log
    // they may later hand to someone.
    const verdict = classifyFirstRun(
      probes({ publicTables: ["payroll_secret_salaries", "acme_customer_pii"] }),
    );
    const serialized = JSON.stringify(verdict);
    expect(serialized).not.toContain("payroll");
    expect(serialized).not.toContain("acme");
    expect(verdict).toHaveProperty("foreignTableCount", 2);
  });

  it("resumes an interrupted first run rather than calling its own half-built schema foreign", () => {
    // The boundary the check above must not swallow. A history table that exists but records
    // nothing is OUR first run, killed partway. Refusing here would strand a user with a database
    // that no version of this program will ever touch again.
    const verdict = classifyFirstRun(
      probes({
        publicTables: ["_prisma_migrations", "Source"],
        migrationTablePresent: true,
        appliedMigrations: [],
      }),
    );
    expect(verdict.action).toBe("APPLY_MIGRATIONS");
  });

  it("refuses a database built by a newer version, and names the migrations it lacks", () => {
    const verdict = classifyFirstRun(
      probes({
        publicTables: ["_prisma_migrations", "Source"],
        migrationTablePresent: true,
        appliedMigrations: [...THREE, "20270101000000_from_the_future"],
      }),
    );
    expect(verdict.action).toBe("REFUSE_DATABASE_AHEAD");
    // These names are the package's own filenames, so naming them leaks nothing and is the only
    // way a reader can tell which build they need.
    expect(verdict).toHaveProperty("unknownMigrations", ["20270101000000_from_the_future"]);
  });

  it("refuses a package with no migrations instead of calling an empty database finished", () => {
    // The vacuity control. With no packaged migrations the pending list is empty, and an empty
    // pending list reads as NOTHING_TO_DO — a schemaless database declared ready. This project has
    // shipped that exact shape before, in a guard that closed over `every()` and was vacuously
    // true on an empty array, so the check is ordered FIRST rather than trusted to fall out.
    const verdict = classifyFirstRun(probes({ packagedMigrations: [] }));
    expect(verdict.action).toBe("REFUSE_EMPTY_PACKAGE");
  });

  it("refuses an empty package even when everything else looks perfect", () => {
    const verdict = classifyFirstRun(
      probes({
        packagedMigrations: [],
        publicTables: ["_prisma_migrations", "Source"],
        migrationTablePresent: true,
        appliedMigrations: [...THREE],
      }),
    );
    expect(verdict.action).toBe("REFUSE_EMPTY_PACKAGE");
  });

  it("only ever answers from the closed vocabulary", () => {
    const cases: Partial<FirstRunProbes>[] = [
      {},
      { packagedMigrations: [] },
      { databaseReachable: false },
      { publicTables: ["x"] },
      { migrationTablePresent: true, appliedMigrations: ["nope"] },
      { migrationTablePresent: true, appliedMigrations: [...THREE] },
      { migrationTablePresent: true, appliedMigrations: [THREE[0]] },
    ];
    const seen = new Set(cases.map((c) => classifyFirstRun(probes(c)).action));
    for (const action of seen) expect(FIRST_RUN_ACTIONS).toContain(action);
    // And the vocabulary is not larger than what is reachable, minus nothing: all six occur here.
    expect(seen.size).toBe(FIRST_RUN_ACTIONS.length);
  });
});

describe("what the packaged setup prints", () => {
  const URL_WITH_PASSWORD = "postgresql://marketos:s3cr3t%2Fpass@127.0.0.1:55432/market_os";

  it("removes the whole connection string, not merely the password", () => {
    const redact = makeRedactor(URL_WITH_PASSWORD);
    const out = redact(`Datasource "db": PostgreSQL database at ${URL_WITH_PASSWORD}`);
    expect(out).not.toContain("s3cr3t");
    expect(out).not.toContain("127.0.0.1:55432");
    expect(out).toContain("[redacted]");
  });

  it("removes the password on its own, in both the encoded and the decoded form", () => {
    const redact = makeRedactor(URL_WITH_PASSWORD);
    // A library that reports the password back has usually decoded it first, and a redactor built
    // only from the URL's own bytes would miss that form entirely.
    expect(redact("auth failed for s3cr3t/pass")).not.toContain("s3cr3t");
    expect(redact("auth failed for s3cr3t%2Fpass")).not.toContain("s3cr3t");
  });

  it("survives a password made of regex metacharacters", () => {
    // Building a pattern out of a secret is how a redactor silently stops matching the one value
    // it exists to hide. This one uses `split`/`join`, and this is the case that proves it.
    const url = "postgresql://u:.*+?[](){}|^$@127.0.0.1:5432/db";
    const redact = makeRedactor(url);
    expect(redact(`connecting to ${url}`)).not.toContain("127.0.0.1");
    expect(redact("password was .*+?[](){}|^$")).not.toContain(".*+?");
  });

  it("redacts nothing and throws nothing when there is no URL to redact", () => {
    const redact = makeRedactor(undefined);
    expect(redact("nothing secret here")).toBe("nothing secret here");
  });

  it("still redacts a connection string it could not parse", () => {
    const junk = "not://a[valid]url at all";
    expect(makeRedactor(junk)(`saw ${junk}`)).toBe("saw [redacted]");
  });

  it("reports the database URL as a boolean and never as a value", () => {
    const text = code("first-run.mjs");
    expect(text).toContain("DATABASE_URL_PRESENT=${Boolean(url)}");
    // The two shapes that would put the value on the console. Searched structurally rather than
    // trusted to review, because this is the file that runs on a user's machine.
    expect(text).not.toContain("console.log(url");
    expect(text).not.toContain("${url}");
  });

  it("prints no error object, because an error can carry the connection string", () => {
    const text = code("first-run.mjs");
    expect(text).not.toContain("console.error(error)");
    expect(text).toContain('error?.name ?? "Error"');
  });

  it("filters the migration runner's own output through the redactor", () => {
    // The runner announces its datasource, which is where the password would appear.
    const text = code("first-run.mjs");
    expect(text).toContain("redact(output)");
  });
});

describe("the package the stager must produce", () => {
  it("ships every setup file the tests exercise", () => {
    for (const name of Object.keys(PACKAGED_SETUP_FILES)) {
      expect(() => source(name), `packaging/${name} is missing`).not.toThrow();
    }
  });

  it("agrees with first-run.mjs about where the migration runner lives", () => {
    // A contract between two files that never import each other: the stager puts the CLI here,
    // and the setup program looks here. Drift would produce a package that refuses to migrate
    // with a message saying it was assembled wrong, which is true and unhelpful.
    const text = code("first-run.mjs");
    for (const segment of MIGRATION_RUNNER_PATH.split("/")) {
      expect(text, `first-run.mjs does not mention "${segment}"`).toContain(`"${segment}"`);
    }
  });

  it("does not look for a developer's .env from inside a package", () => {
    // A package has no `.env` and must not acquire the habit of hunting for one. The repository's
    // own `prisma.config.ts` imports `dotenv/config`; the packaged one deliberately does not.
    for (const name of Object.keys(PACKAGED_SETUP_FILES)) {
      expect(code(name), `packaging/${name} reaches for dotenv`).not.toContain("dotenv");
      // A QUOTED `.env` on ONE line, which is what naming a file looks like. Two narrowings, each
      // of which this assertion needed after getting it wrong: a bare `.env` substring is not the
      // same claim, because `process.env.DATABASE_URL` contains it and reading an environment
      // variable is the intended mechanism; and the character class must exclude newlines, or it
      // spans from the closing quote of an unrelated import all the way to that same
      // `process.env` several lines later and reports a match that is two separate expressions.
      expect(code(name), `packaging/${name} names a .env file`).not.toMatch(/["'][^"'\n]*\.env\b/);
    }
    // And the denial itself is present, so the absence above is a decision rather than an
    // oversight nobody would notice if a later edit reintroduced it.
    expect(source("prisma.config.mjs")).toContain("dotenv");
  });

  it("uses Prisma's own runner rather than a loop over the SQL files", () => {
    const text = code("first-run.mjs");
    expect(text).toContain('"migrate", "deploy"');
    // It may LOOK at `migration.sql` — that is how a migration directory is told from any other
    // directory — but it must never READ one, because reading one is the first line of the
    // homemade runner this package is not allowed to grow.
    expect(text).toContain('"migration.sql"');
    expect(text).not.toMatch(/readFileSync\([^)]*migration/);
    expect(text).not.toContain("migrate dev");
  });

  it("re-probes after applying instead of believing the runner's exit code", () => {
    expect(code("first-run.mjs")).toContain("AFTER_APPLY");
  });
});
