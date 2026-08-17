/**
 * Decides which database the test suite is allowed to touch — and refuses, loudly, when that
 * cannot be established safely.
 *
 * The integration tests are destructive by construction: they `deleteMany` by corpCode,
 * sourceId and email to isolate themselves. Run against a database holding real ingested
 * verification data, they erase it. That happened three times on 2026-08-17, each time
 * presenting as "the page suddenly shows nothing" rather than as anything test-related.
 *
 * The first fix redirected tests to `TEST_DATABASE_URL` when it was set and fell back to
 * `DATABASE_URL` when it was not. That is the wrong default: the protection only applies to
 * people who already know they need it, and forgetting the variable silently reinstates the
 * original hazard. This resolves fail-closed instead.
 *
 * The rule, stated precisely because the edge cases matter:
 *
 *   - No database configured at all → allowed, with no database. Integration tests skip
 *     themselves (`describeIfDb`) and `tests/integration-coverage-guard.test.ts` makes that
 *     visible. Nothing can be destroyed because nothing is reachable.
 *   - `DATABASE_URL` set but `TEST_DATABASE_URL` absent → REFUSED. This is the dangerous case:
 *     a reachable database that nobody has confirmed is disposable.
 *   - `TEST_DATABASE_URL` set but pointing at the same database as `DATABASE_URL` → REFUSED.
 *   - `TEST_DATABASE_URL` set but not named like a disposable database → REFUSED.
 *
 * Kept as a pure function so the decision itself is testable. `vitest.config.mts` applies it.
 */

export type TestDatabaseDecision =
  { ok: true; databaseUrl: string | null; reason: string } | { ok: false; reason: string };

export interface TestDatabaseEnv {
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
}

/**
 * Names that mark a database as disposable. A test database has to say so in its own name —
 * inference from anything else is guesswork, and guessing wrong deletes real data.
 */
const DISPOSABLE_NAME = /(^|[_-])(test|tests|scratch|throwaway|ci)([_-]|$)/i;

/** Names that must never be used as a test target even if they also contain "test". */
const PROTECTED_NAME = /(prod|production|live|staging|main)/i;

function databaseNameOf(url: string): string | null {
  try {
    // `postgresql://user:pass@host:port/dbname?params` — the name is the first path segment.
    return new URL(url).pathname.replace(/^\//, "").split("/")[0] || null;
  } catch {
    return null;
  }
}

/**
 * Loopback spellings that all reach the same machine.
 *
 * Comparing host TEXT alone meant `localhost` and `127.0.0.1` read as two different servers, so
 * two URLs naming one physical database could pass the same-target check and the suite would
 * treat a populated database as disposable. Contrived, but this guard exists because real
 * ingested data was destroyed three times, and the cost of closing it is four lines
 * (independent review, `gpt-5.6-luna`, 2026-08-18).
 *
 * Deliberately a fixed list rather than a DNS lookup: resolution would make a safety decision
 * depend on the network, and a guard that behaves differently when DNS is slow or absent is worse
 * than one with a known blind spot. Any host not listed here is compared literally, so an
 * unrecognised alias falls back to the old behaviour rather than being wrongly cleared.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function canonicalHost(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  const port = url.port || "5432";
  return `${LOOPBACK_HOSTNAMES.has(hostname) ? "localhost" : hostname}:${port}`;
}

/** True when both URLs address the same host, port and database, however they are spelled. */
function sameTarget(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      canonicalHost(ua) === canonicalHost(ub) &&
      ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "")
    );
  } catch {
    return a === b;
  }
}

export function resolveTestDatabase(env: TestDatabaseEnv): TestDatabaseDecision {
  const devUrl = env.DATABASE_URL?.trim() || undefined;
  const testUrl = env.TEST_DATABASE_URL?.trim() || undefined;

  if (!testUrl) {
    if (!devUrl) {
      return {
        ok: true,
        databaseUrl: null,
        reason:
          "No DATABASE_URL and no TEST_DATABASE_URL. Running without a database: integration " +
          "tests will skip themselves and the coverage guard will say so.",
      };
    }
    return {
      ok: false,
      reason:
        "DATABASE_URL is set but TEST_DATABASE_URL is not.\n\n" +
        "The integration tests are destructive — they delete rows by corpCode, sourceId and " +
        "email — and refusing to guess which database is safe to destroy is deliberate. Point " +
        "TEST_DATABASE_URL at a disposable database whose name says so, for example:\n\n" +
        "  TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:55432/market_os_test?schema=public\n\n" +
        "Unset DATABASE_URL instead if you meant to run without a database at all.",
    };
  }

  const name = databaseNameOf(testUrl);
  if (!name) {
    return {
      ok: false,
      reason: `TEST_DATABASE_URL does not name a database: ${JSON.stringify(testUrl)}`,
    };
  }

  // Checked before the naming rules on purpose. If the test URL and the dev URL are the same
  // database, that is the most specific and most alarming thing wrong with the configuration,
  // and "does not identify itself as disposable" would bury it.
  if (devUrl && sameTarget(devUrl, testUrl)) {
    return {
      ok: false,
      reason:
        "TEST_DATABASE_URL and DATABASE_URL address the same database. That defeats the point: " +
        "the suite would destroy exactly the data this guard exists to protect.",
    };
  }

  if (PROTECTED_NAME.test(name)) {
    return {
      ok: false,
      reason:
        `TEST_DATABASE_URL points at a database named "${name}", which reads as a real ` +
        "environment rather than a disposable one. Refusing to run destructive tests against it.",
    };
  }

  if (!DISPOSABLE_NAME.test(name)) {
    return {
      ok: false,
      reason:
        `TEST_DATABASE_URL points at a database named "${name}", which does not identify itself ` +
        "as disposable. Name it so the intent is explicit — test, tests, scratch, throwaway or " +
        "ci — rather than relying on whoever reads this later to know it is safe to wipe.",
    };
  }

  return {
    ok: true,
    databaseUrl: testUrl,
    reason: `Tests will use the disposable database "${name}".`,
  };
}
