import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Guards against the whole integration suite silently disappearing.
 *
 * Every file in `tests/integration/` opens with
 * `const describeIfDb = hasDb ? describe : describe.skip`, so if `DATABASE_URL` is unset the
 * entire directory — currently 25 files and the large majority of this project's real coverage —
 * skips itself and the run still reports green. That is exactly the shape of failure the
 * 2026-08-17 local round kept finding: a suite that is honest about the environment it ran in
 * and silent about what it therefore did not check. `docs/TEST_STRATEGY.md`'s "do not fake pass"
 * rule applies to a whole directory quietly opting out just as much as to an individual
 * `it.skip`.
 *
 * This file deliberately does NOT use `describeIfDb`. It always runs, and in CI it fails loudly
 * rather than letting a misconfigured or missing Postgres service pass as a green build. Locally
 * it stays a warning, because running the unit tests without a database is a legitimate thing to
 * want to do mid-change.
 */
describe("integration coverage guard", () => {
  const integrationDir = path.join(__dirname, "integration");
  const integrationFiles = readdirSync(integrationDir).filter((f) => f.endsWith(".test.ts"));

  it("finds the integration test directory (it has not been moved or emptied)", () => {
    expect(integrationFiles.length).toBeGreaterThan(20);
  });

  it("has a database configured whenever it is running in CI", () => {
    const inCi = Boolean(process.env.CI);
    if (!inCi) {
      if (!process.env.DATABASE_URL) {
        console.warn(
          `\n[integration coverage guard] DATABASE_URL is not set, so all ${integrationFiles.length} ` +
            "integration test files are skipping themselves. The result of this run says nothing " +
            "about the database-backed behaviour of this project.\n",
        );
      }
      return;
    }

    expect(
      process.env.DATABASE_URL,
      `DATABASE_URL is unset in CI, which would silently skip all ${integrationFiles.length} ` +
        "integration test files and still report a green build. Fix the workflow's Postgres " +
        "service or its env block — do not relax this assertion.",
    ).toBeTruthy();
  });
});
