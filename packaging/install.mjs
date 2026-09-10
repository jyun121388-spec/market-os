/**
 * Installs a packaged Market OS on the machine it is sitting on.
 *
 *   node install.mjs [--data-dir <path>] [--port <n>] [--probe-only]
 *
 * What it does is create a PostgreSQL cluster the application owns, a database inside it, a role
 * with a freshly generated password, and the `market-os.json` that tells the launcher how to reach
 * all three. What it does NOT do is touch anything that was there first: the classifier refuses a
 * data directory containing files, and refuses an existing cluster whose configuration has gone
 * missing rather than reinitialising over a database that may hold everything the user has.
 *
 * The generated password is never printed. It is written into `market-os.json` and nowhere else,
 * and it is handed to `initdb` through a file that is deleted immediately afterwards rather than
 * through a command line, because a command line is visible to every other process on the machine.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyInstall } from "./install-classify.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

const APPLICATION_FILES = ["server.js", "launcher.mjs", "first-run.mjs", "prisma/schema.prisma"];
const ROLE = "marketos";
const DATABASE = "market_os";

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

function pgBin(name) {
  return join(ROOT, "pgsql", "bin", process.platform === "win32" ? `${name}.exe` : name);
}

function countEntries(dir) {
  try {
    return readdirSync(dir).length;
  } catch {
    return 0;
  }
}

function probe(dataDir) {
  const dataDirExists = existsSync(dataDir) && statSync(dataDir).isDirectory();
  const entries = dataDirExists ? countEntries(dataDir) : 0;
  return {
    applicationFilesPresent: APPLICATION_FILES.every((f) =>
      existsSync(join(ROOT, ...f.split("/"))),
    ),
    postgresPresent: existsSync(pgBin("initdb")) && existsSync(pgBin("pg_ctl")),
    dataDirExists,
    dataDirEmpty: entries === 0,
    dataDirEntryCount: entries,
    clusterPresent: dataDirExists && existsSync(join(dataDir, "PG_VERSION")),
    configPresent: existsSync(join(ROOT, "market-os.json")),
  };
}

/**
 * A port nothing is listening on.
 *
 * Asked for from the operating system rather than picked from a list: a hard-coded default
 * collides with whatever else the user runs, and a list of candidates is a shorter list of
 * collisions. The port is recorded in the configuration, so the answer only has to be right once.
 */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * A password with no characters that mean anything to a URL parser.
 *
 * `base64url` deliberately: it contains no `?`, no `@`, no `/`, no `%`. That is not tidiness — a
 * password containing `?` makes `new URL` return an EMPTY password for the connection string,
 * which was measured while building the launcher's redactor, and a password containing `@` or `/`
 * changes where the authority ends. Generating one that cannot provoke either is cheaper than
 * being right about every parser that will ever read it.
 */
function generatePassword() {
  return randomBytes(24).toString("base64url");
}

function run(exe, args, options = {}) {
  return spawnSync(exe, args, { encoding: "utf8", ...options });
}

/**
 * Start PostgreSQL, with its output going NOWHERE this process holds open.
 *
 * `stdio: "ignore"` is the whole of this function and it is not a tidiness choice. `pg_ctl start`
 * launches the server as a child and then exits; the server INHERITS the pipes, and `spawnSync`
 * waits for those pipes to close before it returns. So the call does not come back when `pg_ctl`
 * finishes — it comes back when PostgreSQL shuts down, which is to say never.
 *
 * That is not a theory. The first installation run against a real distribution created its cluster,
 * started it, and then sat there: twenty minutes with the server up, the log filling with routine
 * checkpoints, and `market-os.json` never written. Reproduced in isolation, `pg_ctl start` returned
 * `status: 0` alongside `ETIMEDOUT`, which is exactly this shape — the program succeeded and the
 * pipe outlived it.
 *
 * Nothing is lost by ignoring the streams: the server's own output already goes to `postgres.log`
 * via `-l`, which is what the failure message points at, and `-w` means the exit status is a real
 * answer about whether it came up.
 */
function startPostgres(dataDir, port, logPath) {
  return spawnSync(
    pgBin("pg_ctl"),
    ["-D", dataDir, "-o", `-p ${port} -h 127.0.0.1`, "-l", logPath, "-w", "start"],
    { stdio: "ignore" },
  );
}

function createCluster(dataDir, port) {
  const password = generatePassword();
  mkdirSync(dataDir, { recursive: true });

  // Through a file, not a command line: a command line is readable by every other process on the
  // machine for as long as the program runs.
  const pwfile = join(ROOT, `.initdb-${randomBytes(6).toString("hex")}`);
  writeFileSync(pwfile, password, "utf8");
  try {
    const init = run(pgBin("initdb"), [
      "-D",
      dataDir,
      "-U",
      ROLE,
      "-E",
      "UTF8",
      "--auth-host=scram-sha-256",
      "--auth-local=scram-sha-256",
      `--pwfile=${pwfile}`,
    ]);
    if (init.status !== 0) {
      console.error("INSTALL CLUSTER_INIT_FAILED");
      return null;
    }
  } finally {
    // Always, including when initdb threw. The whole reason for the file is that it is brief.
    rmSync(pwfile, { force: true });
  }

  const started = startPostgres(dataDir, port, join(ROOT, "postgres.log"));
  if (started.status !== 0) {
    console.error("INSTALL CLUSTER_START_FAILED");
    console.error("  See postgres.log beside the application for what PostgreSQL reported.");
    return null;
  }

  try {
    const created = run(
      pgBin("createdb"),
      ["-h", "127.0.0.1", "-p", String(port), "-U", ROLE, DATABASE],
      { env: { ...process.env, PGPASSWORD: password } },
    );
    if (created.status !== 0) {
      console.error("INSTALL DATABASE_CREATE_FAILED");
      return null;
    }
  } finally {
    run(pgBin("pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "stop"]);
  }

  return { password, port };
}

function writeConfig(dataDir, port, password) {
  const config = {
    databaseUrl: `postgresql://${ROLE}:${password}@127.0.0.1:${port}/${DATABASE}`,
    port: 3100,
    postgres: {
      manage: true,
      binDir: "pgsql/bin",
      dataDir: relativeToRoot(dataDir),
    },
    openBrowser: true,
  };
  const path = join(ROOT, "market-os.json");
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return path;
}

function relativeToRoot(dataDir) {
  // The launcher resolves `dataDir` against the package root, so a path inside it is stored
  // relative and one outside it is stored whole. Keeping the common case relative is what lets a
  // user move the whole folder without the installation breaking.
  const prefix = ROOT.endsWith("\\") || ROOT.endsWith("/") ? ROOT : ROOT + "\\";
  if (dataDir.startsWith(prefix)) return dataDir.slice(prefix.length).split("\\").join("/");
  return dataDir;
}

async function main() {
  const dataDir = arg("data-dir", join(ROOT, "pgdata"));
  const probeOnly = process.argv.includes("--probe-only");
  const probes = probe(dataDir);
  const verdict = classifyInstall(probes);

  console.log(`INSTALL ${verdict.action}`);

  switch (verdict.action) {
    case "REFUSE_INCOMPLETE_PACKAGE":
      console.error(
        "  This folder does not contain a complete Market OS. Nothing was changed. Unpack the\n" +
          "  distribution again.",
      );
      return 3;

    case "REFUSE_NO_POSTGRES":
      console.error(
        "  This distribution has no bundled PostgreSQL, so it cannot create a database of its\n" +
          "  own. Nothing was changed. Use the full distribution, or configure market-os.json to\n" +
          "  point at a PostgreSQL you already run.",
      );
      return 4;

    case "REFUSE_DATA_DIR_NOT_EMPTY":
      console.error(
        `  The chosen data directory already contains ${verdict.entryCount} item(s) and is not a\n` +
          "  Market OS database. Creating a cluster there would destroy them, so nothing was\n" +
          "  changed. Choose an empty directory with --data-dir.",
      );
      return 5;

    case "REFUSE_CLUSTER_WITHOUT_CONFIG":
      console.error(
        "  A Market OS database exists here but market-os.json is missing, and the password for\n" +
          "  that database was generated at install time and is not recoverable from it. Nothing\n" +
          "  was changed — reinitialising would destroy the data. Restore market-os.json from a\n" +
          "  backup, or install into a different directory with --data-dir.",
      );
      return 6;

    case "ALREADY_INSTALLED":
      console.log("  Market OS is already installed here. Nothing was changed.");
      console.log("INSTALL READY");
      return 0;

    case "CREATE_CLUSTER": {
      if (probeOnly) {
        console.log("INSTALL PROBE_ONLY — nothing was changed.");
        return 0;
      }
      const port = Number(arg("port", 0)) || (await freePort());
      console.log(`  creating a database cluster on port ${port}`);
      const created = createCluster(dataDir, port);
      if (created === null) return 7;

      writeConfig(dataDir, port, created.password);
      // Presence, never the value — the same rule the rest of the package follows.
      console.log("INSTALL CONFIG_WRITTEN credential=generated");
      console.log("INSTALL READY");
      console.log('  Start Market OS by running "Market OS.cmd" in this folder.');
      return 0;
    }

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
    console.error(`INSTALL UNEXPECTED_FAILURE (${error?.name ?? "Error"})`);
    process.exitCode = 8;
  },
);
