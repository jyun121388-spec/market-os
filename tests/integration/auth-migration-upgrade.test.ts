import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, cpSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

/**
 * H1 regression (see docs/DECISIONS.md): proves the staged auth migration
 * (prisma/migrations/20260816001500_auth) is safe to apply to a database that ALREADY has
 * pre-existing User/WatchlistItem rows from before Auth shipped — not just to an empty database.
 *
 * This can only be verified against a real PostgreSQL instance running real DDL: it creates a
 * throwaway database, applies migrations only up to (not including) the auth migration, inserts
 * fixture rows using the pre-auth schema (no email/passwordHash/isLegacyAccount columns exist
 * yet), then applies the remaining migrations (auth onward) and asserts the pre-existing rows —
 * and their FK-dependent WatchlistItem rows — survived, got the documented legacy treatment, and
 * that no fake credential was ever synthesized as if it were real.
 */
describeIfDb("auth migration upgrade safety (integration)", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const migrationsRoot = path.join(repoRoot, "prisma", "migrations");
  const prismaCli = path.join(repoRoot, "node_modules", "prisma", "build", "index.js");
  const testDbName = "market_os_migration_upgrade_test";

  // Derived inside `beforeAll`, not at describe-body scope. Vitest still evaluates the body of
  // a skipped describe in order to collect it, so parsing `DATABASE_URL!` out here threw and
  // failed the whole file whenever no database was configured — a suite that is supposed to
  // skip itself instead taking the run down with it.
  let adminUrl: URL;
  let testDbUrl: URL;

  let stageDir: string;

  async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  function runMigrateDeploy(migrationsDir: string) {
    const configPath = path.join(stageDir, "prisma.config.ts");
    const configContents = `
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "${path.join(repoRoot, "prisma", "schema.prisma").replace(/\\/g, "\\\\")}",
  migrations: { path: "${migrationsDir.replace(/\\/g, "\\\\")}" },
  datasource: { url: process.env["DATABASE_URL"] },
});
`;
    writeFileSync(configPath, configContents);
    // Run Prisma's CLI as a plain Node script rather than going through `npx`. `npx` resolves to
    // `npx.cmd` on Windows, and modern Node refuses to spawn a .cmd without a shell (EINVAL,
    // the CVE-2024-27980 mitigation) while the bare name is ENOENT — so the npx route fails
    // this suite before its first assertion on Windows either way. Invoking the CLI entry point
    // directly is both portable and one process shorter.
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--config", configPath], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: testDbUrl.toString() },
      stdio: "pipe",
    });
  }

  beforeAll(async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    adminUrl = new URL(baseUrl.toString());
    adminUrl.pathname = "/postgres";
    testDbUrl = new URL(baseUrl.toString());
    testDbUrl.pathname = `/${testDbName}`;

    // The generated prisma.config.ts is executed by Prisma's config loader, which resolves
    // `require("prisma/config")` relative to the config file's own location — it must live
    // somewhere under the repo's node_modules resolution chain, not a bare OS tmpdir.
    const localTmpRoot = path.join(repoRoot, ".tmp-test-artifacts");
    mkdirSync(localTmpRoot, { recursive: true });
    stageDir = mkdtempSync(path.join(localTmpRoot, "migration-upgrade-"));

    await withAdminClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
      await client.query(`CREATE DATABASE "${testDbName}"`);
    });

    // Stage 1: copy only the migrations that predate auth into a temp migrations dir, and apply
    // them to the fresh test database — this reproduces "a real deployment that shipped
    // Watchlist (M19) before Auth (M22) existed."
    const preAuthDir = path.join(stageDir, "migrations-pre-auth");
    mkdirSync(preAuthDir, { recursive: true });
    const allMigrations = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const authIndex = allMigrations.indexOf("20260816001500_auth");
    expect(authIndex).toBeGreaterThan(-1);
    const preAuthMigrations = allMigrations.slice(0, authIndex);
    expect(preAuthMigrations.length).toBeGreaterThan(0);
    for (const name of preAuthMigrations) {
      cpSync(path.join(migrationsRoot, name), path.join(preAuthDir, name), { recursive: true });
    }
    cpSync(
      path.join(migrationsRoot, "migration_lock.toml"),
      path.join(preAuthDir, "migration_lock.toml"),
    );
    runMigrateDeploy(preAuthDir);
    // This hook creates a throwaway database and shells out to `prisma migrate deploy`, which
    // takes ~20s on its own and considerably longer when the rest of the suite is competing for
    // the same Postgres instance. 60s was enough in isolation and timed out in a full run — a
    // budget problem, not a logic one, so the budget is what changes.
  }, 240_000);

  afterAll(async () => {
    await withAdminClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
    });
    rmSync(stageDir, { recursive: true, force: true });
  });

  it("preserves pre-existing User/WatchlistItem rows, distinguishes them as legacy, and never fabricates a real credential", async () => {
    const testClient = new Client({ connectionString: testDbUrl.toString() });
    await testClient.connect();

    let preexistingUserId: string;
    try {
      // Fixture: a User row inserted against the PRE-AUTH schema (id + createdAt only — no
      // email/passwordHash/isLegacyAccount columns exist at this point), with a dependent
      // WatchlistItem, exactly the shape M19 could have produced before M22 (Auth) shipped.
      const userResult = await testClient.query<{ id: string }>(
        `INSERT INTO "users" ("id") VALUES ($1) RETURNING "id"`,
        ["preexisting-user-1"],
      );
      preexistingUserId = userResult.rows[0].id;

      await testClient.query(
        `INSERT INTO "watchlist_items" ("id", "userId", "itemType", "itemRef", "label")
         VALUES ($1, $2, 'ETF', 'SPY', 'S&P 500 ETF')`,
        ["preexisting-watchlist-item-1", preexistingUserId],
      );

      const preCount = await testClient.query(`SELECT count(*)::int AS n FROM "users"`);
      expect(preCount.rows[0].n).toBe(1);
    } finally {
      await testClient.end();
    }

    // Stage 2: apply the FULL migration set (auth onward) against the now-populated database —
    // this is the actual upgrade path being tested.
    runMigrateDeploy(migrationsRoot);

    const verifyClient = new Client({ connectionString: testDbUrl.toString() });
    await verifyClient.connect();
    try {
      // The pre-existing row was not deleted.
      const user = await verifyClient.query(
        `SELECT "id", "email", "passwordHash", "isLegacyAccount" FROM "users" WHERE "id" = $1`,
        [preexistingUserId],
      );
      expect(user.rows).toHaveLength(1);
      const row = user.rows[0];

      // Distinguished as legacy, not silently treated as a normal new account.
      expect(row.isLegacyAccount).toBe(true);

      // A real, non-null, unique-constraint-satisfying email was synthesized (required by the
      // tightened NOT NULL + UNIQUE constraints) — but it is a synthetic, unguessable
      // placeholder derived from the row's own id, not a fabricated real-looking address.
      expect(row.email).toBe(`legacy+${preexistingUserId}@market-os.invalid`);

      // The passwordHash is the documented sentinel, NOT a real scrypt record
      // ("<N>:<r>:<p>:<saltHex>:<hashHex>") — never a fake credential presented as real.
      expect(row.passwordHash).toBe("LEGACY_ACCOUNT_NO_CREDENTIALS");
      expect(row.passwordHash).not.toMatch(/^\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/);

      // FK preservation: the dependent WatchlistItem row is intact and still points at the same
      // (unchanged) user id.
      const watchlistItem = await verifyClient.query(
        `SELECT "userId" FROM "watchlist_items" WHERE "id" = $1`,
        ["preexisting-watchlist-item-1"],
      );
      expect(watchlistItem.rows).toHaveLength(1);
      expect(watchlistItem.rows[0].userId).toBe(preexistingUserId);

      // Unique constraint on email is actually enforced post-upgrade.
      await expect(
        verifyClient.query(
          `INSERT INTO "users" ("id", "email", "passwordHash") VALUES ($1, $2, $3)`,
          ["dup-email-user", row.email, "irrelevant"],
        ),
      ).rejects.toThrow();

      // The full column set now matches the current schema (email/passwordHash NOT NULL,
      // isLegacyAccount present) for a BRAND NEW row created after the upgrade too.
      const freshUser = await verifyClient.query(
        `INSERT INTO "users" ("id", "email", "passwordHash") VALUES ($1, $2, $3)
         RETURNING "isLegacyAccount"`,
        ["fresh-post-upgrade-user", "fresh-user@example.com", "not-a-real-hash-just-a-fixture"],
      );
      expect(freshUser.rows[0].isLegacyAccount).toBe(false);
    } finally {
      await verifyClient.end();
    }
  }, 60_000);
});
