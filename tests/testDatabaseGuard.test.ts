import { describe, expect, it } from "vitest";
import { resolveTestDatabase } from "./support/testDatabaseGuard";

/**
 * The guard that decides which database destructive tests may touch.
 *
 * This protects a real dataset: the local development database holds ingested SEC data used to
 * verify the product against reality, and the integration suite deletes rows by corpCode,
 * sourceId and email. An earlier version of this protection fell back to `DATABASE_URL` when
 * `TEST_DATABASE_URL` was unset, which meant forgetting the variable silently reinstated the
 * hazard. These cases pin the fail-closed behaviour that replaced it.
 */

const DEV = "postgresql://postgres:pw@127.0.0.1:55432/market_os_dev?schema=public";
const TEST = "postgresql://postgres:pw@127.0.0.1:55432/market_os_test?schema=public";

describe("resolveTestDatabase", () => {
  it("allows a run with no database at all", () => {
    // Legitimate: unit tests without Postgres. Integration files skip themselves and the
    // coverage guard reports it, so nothing passes silently and nothing can be destroyed.
    const decision = resolveTestDatabase({});
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.databaseUrl).toBeNull();
  });

  it("REFUSES when a database is reachable but no test database was named", () => {
    // The dangerous case, and the one the previous fallback got wrong.
    const decision = resolveTestDatabase({ DATABASE_URL: DEV });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/TEST_DATABASE_URL is not/i);
    // The message has to be actionable, not just a refusal.
    expect(decision.reason).toMatch(/TEST_DATABASE_URL=/);
  });

  it("accepts a clearly disposable test database", () => {
    const decision = resolveTestDatabase({ DATABASE_URL: DEV, TEST_DATABASE_URL: TEST });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.databaseUrl).toBe(TEST);
  });

  it("accepts a test database when no dev database is configured", () => {
    const decision = resolveTestDatabase({ TEST_DATABASE_URL: TEST });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.databaseUrl).toBe(TEST);
  });

  it("REFUSES when the test URL addresses the same database as the dev URL", () => {
    const decision = resolveTestDatabase({ DATABASE_URL: DEV, TEST_DATABASE_URL: DEV });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/same database/i);
  });

  it("REFUSES the same database even when the two URLs are spelled differently", () => {
    // Different credentials and query string, same host/port/database. A string comparison
    // would wave this through, which is exactly how the guard would be bypassed by accident.
    const decision = resolveTestDatabase({
      DATABASE_URL: DEV,
      TEST_DATABASE_URL: "postgresql://someone:else@127.0.0.1:55432/market_os_dev",
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/same database/i);
  });

  it.each([
    ["market_os_dev", /does not identify itself as disposable/i],
    ["market_os", /does not identify itself as disposable/i],
    ["postgres", /does not identify itself as disposable/i],
  ])("REFUSES a test URL naming the non-disposable database %s", (name, expected) => {
    const decision = resolveTestDatabase({
      TEST_DATABASE_URL: `postgresql://postgres:pw@127.0.0.1:55432/${name}`,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(expected);
  });

  it.each(["market_os_production", "prod_test", "live_test", "staging_test", "main_test"])(
    "REFUSES %s, which reads as a real environment even where it also says test",
    (name) => {
      const decision = resolveTestDatabase({
        TEST_DATABASE_URL: `postgresql://postgres:pw@127.0.0.1:55432/${name}`,
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toMatch(/real environment/i);
    },
  );

  it.each(["market_os_test", "market_os_tests", "scratch_db_test", "ci", "throwaway"])(
    "accepts the disposable name %s",
    (name) => {
      const decision = resolveTestDatabase({
        TEST_DATABASE_URL: `postgresql://postgres:pw@127.0.0.1:55432/${name}`,
      });
      expect(decision.ok).toBe(true);
    },
  );

  it("REFUSES a test URL that names no database at all", () => {
    const decision = resolveTestDatabase({ TEST_DATABASE_URL: "not-a-url" });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/does not name a database/i);
  });

  it("treats whitespace-only values as absent rather than as a database name", () => {
    const decision = resolveTestDatabase({ DATABASE_URL: DEV, TEST_DATABASE_URL: "   " });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/TEST_DATABASE_URL is not/i);
  });
});
