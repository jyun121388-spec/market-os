/**
 * First-run setup for a packaged Market OS. Ships inside the package and runs there.
 *
 *   node first-run.mjs [--probe-only]
 *
 * A packaged app arrives at a machine with a database that is empty, or absent, or — the case
 * worth being frightened of — full of somebody else's data. This decides which of those it is
 * before touching anything, and then applies the schema using PRISMA'S OWN MIGRATION RUNNER.
 *
 * It is worth saying why that last part is not a homemade SQL loop, because a loop over
 * `prisma/migrations/*<slash>migration.sql` is about fifteen lines and looks equivalent. It is not.
 * `migrate deploy` records each migration in `_prisma_migrations` with a checksum, refuses to
 * proceed when an already-applied migration's file has changed underneath it, applies each one in
 * its own transaction, and marks a failure so the next run resumes instead of silently
 * half-applying. Re-implementing that is re-implementing the part that makes migrations safe. So
 * the toolchain is STAGED into the package and invoked, and `scripts/stage-runtime.ts` proves it
 * is there.
 *
 * No credential is printed. The database URL carries a password, so every line the child process
 * writes is filtered through a redactor built from the actual value before it reaches a console
 * or a log file.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyFirstRun } from "./first-run-classify.mjs";
import { makeRedactor } from "./first-run-redact.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Where the database URL comes from, in order. The environment first so a launcher can supply it
 * without writing it to disk at all; `market-os.json` beside the server second, because a Windows
 * user double-clicking an icon has no environment to speak of.
 */
function resolveDatabaseUrl() {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv && fromEnv.trim().length > 0) return { url: fromEnv.trim(), from: "environment" };

  const configPath = join(ROOT, "market-os.json");
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      if (typeof parsed.databaseUrl === "string" && parsed.databaseUrl.trim().length > 0) {
        return { url: parsed.databaseUrl.trim(), from: "market-os.json" };
      }
    } catch {
      // A malformed config is reported as an absent URL rather than as a parse error, because the
      // parse error would quote the file, and the file is where the password lives.
      return { url: undefined, from: "market-os.json (unreadable)" };
    }
  }
  return { url: undefined, from: "nowhere" };
}

/** Migration directory names shipped in this package, in the order Prisma orders them. */
function packagedMigrations() {
  const dir = join(ROOT, "prisma", "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .filter((name) => existsSync(join(dir, name, "migration.sql")))
    .sort();
}

async function probeDatabase(url) {
  const empty = {
    databaseReachable: false,
    publicTables: [],
    migrationTablePresent: false,
    appliedMigrations: [],
  };
  if (!url) return empty;

  // `pg` is a dependency of `@prisma/adapter-pg`, so it is already traced into the package. This
  // deliberately does NOT use the Prisma client: the client is generated against a schema that
  // does not exist yet, which is the whole situation being measured.
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch {
    try {
      await client.end();
    } catch {
      /* the connection never opened */
    }
    return empty;
  }

  try {
    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()",
    );
    const publicTables = tables.rows.map((r) => r.tablename);
    const migrationTablePresent = publicTables.includes("_prisma_migrations");

    let appliedMigrations = [];
    if (migrationTablePresent) {
      // FINISHED only. A migration that started and failed is recorded with a null `finished_at`,
      // and treating it as applied would skip the very migration that needs re-running.
      const applied = await client.query(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL",
      );
      appliedMigrations = applied.rows.map((r) => r.migration_name);
    }
    return { databaseReachable: true, publicTables, migrationTablePresent, appliedMigrations };
  } catch {
    return empty;
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

/** The staged Prisma CLI. Absent means the package was assembled wrong, not that migrations are optional. */
function migrationRunnerPath() {
  return join(ROOT, "migrate-tools", "node_modules", "prisma", "build", "index.js");
}

function applyMigrations(url, redact) {
  const runner = migrationRunnerPath();
  if (!existsSync(runner)) {
    console.error("FIRST_RUN MIGRATION_TOOLCHAIN_MISSING");
    console.error(
      "  This package has migrations but not the runner that applies them, so it was assembled\n" +
        "  incorrectly. Re-stage it; do not apply the SQL by hand.",
    );
    return 4;
  }

  // Working directory is the TOOLCHAIN directory, not the package root, and that is not
  // incidental. `prisma.config.mjs` imports `prisma/config`, which resolves only from inside
  // `migrate-tools/node_modules` — run from the root, the CLI reports
  // `Cannot find module 'prisma/config'` and applies nothing. Measured on the first real run
  // against an empty database; the config and its schema paths were moved rather than patched
  // around.
  const result = spawnSync(process.execPath, [runner, "migrate", "deploy"], {
    cwd: join(ROOT, "migrate-tools"),
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  for (const line of redact(output).split("\n")) {
    if (line.trim().length > 0) console.log(`  | ${line}`);
  }

  if (result.status !== 0) {
    console.error(`FIRST_RUN MIGRATION_FAILED (exit ${result.status})`);
    return 5;
  }
  return 0;
}

async function main() {
  const probeOnly = process.argv.includes("--probe-only");
  const { url, from } = resolveDatabaseUrl();
  const redact = makeRedactor(url);

  // Presence, never the value. This line is the only thing said about the credential.
  console.log(`FIRST_RUN DATABASE_URL_PRESENT=${Boolean(url)} SOURCE=${from}`);

  const packaged = packagedMigrations();
  const probes = { ...(await probeDatabase(url)), packagedMigrations: packaged };
  const verdict = classifyFirstRun(probes);

  console.log(
    `FIRST_RUN ${verdict.action}  packaged=${packaged.length} applied=${probes.appliedMigrations.length}`,
  );

  switch (verdict.action) {
    case "REFUSE_EMPTY_PACKAGE":
      console.error(
        "  This package contains no migrations, so it cannot create a database. Nothing was\n" +
          "  changed. Re-stage the package.",
      );
      return 3;

    case "WAIT_FOR_DATABASE":
      console.error(
        "  The database did not answer. Start PostgreSQL, check the connection settings, and run\n" +
          "  this again. Nothing was changed.",
      );
      return 2;

    case "REFUSE_FOREIGN_DATABASE":
      console.error(
        `  The database already contains ${verdict.foreignTableCount} table(s) that Market OS did\n` +
          "  not create, and it has no Market OS migration history. Applying the schema here could\n" +
          "  destroy data belonging to something else, so nothing was changed. Point Market OS at\n" +
          "  an empty database, or at one it created itself.",
      );
      return 6;

    case "REFUSE_DATABASE_AHEAD":
      console.error(
        "  The database was created by a NEWER version of Market OS: it records migrations this\n" +
          `  package does not contain (${verdict.unknownMigrations.join(", ")}). Nothing was\n` +
          "  changed. Install the newer version, or point this one at a different database.",
      );
      return 7;

    case "APPLY_MIGRATIONS": {
      console.log(
        `  ${verdict.pending.length} migration(s) to apply: ${verdict.pending.join(", ")}`,
      );
      if (probeOnly) {
        console.log("FIRST_RUN PROBE_ONLY — nothing was changed.");
        return 0;
      }
      const code = applyMigrations(url, redact);
      if (code !== 0) return code;
      // Re-probe rather than assume. The runner exiting zero is its claim; this is the evidence.
      const after = { ...(await probeDatabase(url)), packagedMigrations: packaged };
      const settled = classifyFirstRun(after);
      console.log(
        `FIRST_RUN AFTER_APPLY ${settled.action} applied=${after.appliedMigrations.length}`,
      );
      if (settled.action !== "NOTHING_TO_DO") {
        console.error(
          "  The migration runner reported success but the schema is still incomplete.",
        );
        return 5;
      }
      console.log("FIRST_RUN READY");
      return 0;
    }

    case "NOTHING_TO_DO":
      console.log("  The schema is already up to date. Nothing was changed.");
      console.log("FIRST_RUN READY");
      return 0;

    default:
      console.error(`  Unrecognised verdict: ${verdict.action}`);
      return 9;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    // Even here, no error object is printed: an exception raised while connecting can carry the
    // connection string in its message.
    console.error(`FIRST_RUN UNEXPECTED_FAILURE (${error?.name ?? "Error"})`);
    process.exitCode = 8;
  },
);
