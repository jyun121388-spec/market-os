/**
 * The Windows launcher for a packaged Market OS. Ships inside the package and runs there.
 *
 *   node launcher.mjs [--no-browser] [--stay]
 *
 * A user double-clicks one thing and expects a working window. Between those two events there are
 * four steps that can each fail in their own way, and the whole design of this file is that they
 * happen IN ORDER and that nothing later is attempted when something earlier did not succeed:
 *
 *   1. Start the database, if this installation owns one. An installation pointed at a database
 *      somebody else runs must never start or stop it, so managing one is opt-in.
 *   2. Run first-run setup, which decides for itself whether there is anything to do and refuses
 *      outright if the database belongs to something else.
 *   3. Start the server.
 *   4. Wait for `/api/ready` — not for the port to open. The port accepts connections well before
 *      the schema is usable, and opening a browser at that moment shows the user an error page
 *      that the launcher then has to explain. `APP_PROCESS_STARTED` is not `MARKET_OS_READY`.
 *
 * Then, and only then, the browser.
 *
 * No credential is printed. The one line about configuration comes from `describeLaunchConfig`,
 * which reports the database as `configured` and never as a value.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { describeLaunchConfig, resolveLaunchConfig } from "./launch-config.mjs";
import { classifyReadyAttempt } from "./ready-poll.mjs";
import { makeRedactor } from "./first-run-redact.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** How long to wait for READY before giving up. Generous: a first run applies 17 migrations. */
const READY_BUDGET_MS = 180_000;
const POLL_INTERVAL_MS = 750;

const REFUSAL_HELP = {
  MALFORMED_CONFIG:
    "market-os.json could not be read as a configuration file. Repair or delete it and run the\n" +
    "  installer again.",
  NO_DATABASE_URL:
    "No database is configured. Set DATABASE_URL, or put a databaseUrl into market-os.json.",
  INVALID_DATABASE_URL:
    "The configured database address is not a PostgreSQL connection string. It must begin with\n" +
    "  postgresql://",
  INVALID_PORT: "The configured port is not a number between 1 and 65535.",
  INCOMPLETE_POSTGRES_CONFIG:
    "market-os.json asks Market OS to manage PostgreSQL but does not say where it is. Both\n" +
    "  postgres.binDir and postgres.dataDir are required.",
};

function readConfigFile() {
  const path = join(ROOT, "market-os.json");
  if (!existsSync(path)) return { present: false, file: undefined };
  try {
    return { present: true, file: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    // Reported as a malformed config, never quoted: the file is where the password lives.
    return { present: true, file: "" };
  }
}

/** The database's own port, taken from the connection string so there is one source of truth. */
function databasePort(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.port ? Number(parsed.port) : 5432;
  } catch {
    return 5432;
  }
}

/**
 * `resolve` and not `join`, and the difference is not stylistic. The installer records a data
 * directory INSIDE the package as a relative path so the whole folder can be moved, and one
 * outside it whole. `join("C:/app", "D:/data")` produces `C:/app/D:/data`; `resolve` returns
 * `D:/data`, which is what was meant. Both forms have to work, because both are written.
 *
 * It is imported as `resolvePath` because `resolve` is also the name every Promise executor in
 * this file gives its own first argument, and two different `resolve`s in one module is a reading
 * hazard for no benefit.
 */
function pgPath(dir) {
  return resolvePath(ROOT, dir);
}

function pgCtl(config, args, options = {}) {
  const exe = join(
    pgPath(config.postgres.binDir),
    process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl",
  );
  return spawnSync(exe, ["-D", pgPath(config.postgres.dataDir), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

/**
 * A file saying that a Market OS launcher, not a person, started this database.
 *
 * It exists because Windows cannot be relied on to let a program clean up after itself. A console
 * Ctrl+C arrives as a signal and the shutdown below runs; being killed — Task Manager, a closed
 * window, a machine going to sleep — does not, because `TerminateProcess` is not interceptable.
 * So a cluster this launcher started can outlive it, and without a record nothing afterwards would
 * ever know it was ours to stop.
 *
 * Measured, not assumed: an acceptance run killed a launcher and found PostgreSQL still up
 * afterwards. The marker is what turns that from a leak into a thing the next launch tidies away.
 */
const OWNERSHIP_MARKER = join(ROOT, ".database-started-by-launcher");

/**
 * Start the bundled database, and report whether it is THIS installation's to stop.
 *
 * The distinction matters at shutdown: a database somebody else was already running belonged to
 * them before this process existed, and stopping it on exit would take it away from them. The
 * marker is what tells the two apart when a cluster is found already running.
 */
function startDatabase(config) {
  const status = pgCtl(config, ["status"]);
  // `pg_ctl status` exits 0 when the server is running, 3 when it is not, 4 when the data
  // directory is unusable. Only the first means there is nothing to start.
  if (status.status === 0) {
    // Already up. Ours only if a previous launcher started it and never got to stop it.
    const adopted = existsSync(OWNERSHIP_MARKER);
    console.log(`LAUNCH DATABASE_ALREADY_RUNNING adopted=${adopted}`);
    return { started: adopted, ok: true };
  }
  if (status.status === 4) {
    console.error("LAUNCH DATABASE_DIRECTORY_UNUSABLE");
    return { started: false, ok: false };
  }

  const port = databasePort(config.databaseUrl);
  // `stdio: "ignore"`, and this one line is the difference between a launcher and a hang.
  // `pg_ctl start` launches the server as a child and exits; the SERVER inherits the pipes, so
  // `spawnSync` waits for them to close — which happens when PostgreSQL shuts down, not when
  // `pg_ctl` finishes. Measured during the first real installation: the cluster came up, the log
  // filled with routine checkpoints, and the calling process never returned. `-l` already sends
  // the server's own output to `postgres.log`, and `-w` makes the exit status a real answer.
  const started = pgCtl(
    config,
    ["-o", `-p ${port} -h 127.0.0.1`, "-l", join(ROOT, "postgres.log"), "-w", "start"],
    { stdio: "ignore" },
  );
  if (started.status !== 0) {
    console.error("LAUNCH DATABASE_FAILED_TO_START");
    console.error("  See postgres.log beside the application for what PostgreSQL reported.");
    return { started: false, ok: false };
  }
  // Written BEFORE the success is announced, so a launcher killed in the next millisecond still
  // leaves behind the fact that this database is ours.
  try {
    writeFileSync(OWNERSHIP_MARKER, new Date().toISOString(), "utf8");
  } catch {
    // A read-only installation directory is a reason to lose the tidy-up, not the launch.
  }
  console.log("LAUNCH DATABASE_STARTED");
  return { started: true, ok: true };
}

function stopDatabase(config) {
  const result = pgCtl(config, ["-m", "fast", "-w", "stop"]);
  if (result.status === 0) {
    try {
      rmSync(OWNERSHIP_MARKER, { force: true });
    } catch {
      // A stale marker makes the next launch adopt a database it did not start, which stops one
      // process too many at worst. Failing to stop is the error worth reporting; this is not.
    }
  }
  console.log(`LAUNCH DATABASE_STOPPED=${result.status === 0}`);
}

/** Run the packaged first-run setup, inheriting its output verbatim — it redacts its own. */
function runFirstRun(config) {
  const result = spawnSync(process.execPath, [join(ROOT, "first-run.mjs")], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: config.databaseUrl },
    stdio: "inherit",
  });
  return result.status === 0;
}

function startServer(config) {
  // `server.js` is Next's standalone entry point. HOSTNAME is pinned to loopback: this is a
  // desktop application, and binding a database-backed app to every interface on someone's
  // network is not a default anyone asked for.
  return spawn(process.execPath, [join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: config.databaseUrl,
      PORT: String(config.port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", "inherit", "pipe"],
  });
}

async function waitForReady(config, deadlineFrom) {
  const url = `http://127.0.0.1:${config.port}/api/ready`;
  for (;;) {
    const elapsedMs = Date.now() - deadlineFrom;
    let attempt = { reached: false, elapsedMs, budgetMs: READY_BUDGET_MS };
    try {
      const response = await fetch(url, { cache: "no-store" });
      attempt = {
        reached: true,
        status: response.status,
        body: await response.text(),
        elapsedMs,
        budgetMs: READY_BUDGET_MS,
      };
    } catch {
      // Connection refused while the server boots. Not an error, and not worth printing on every
      // one of the two hundred attempts a first run can take.
    }

    const verdict = classifyReadyAttempt(attempt);
    if (verdict !== "RETRY") return verdict;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      // The empty string is `start`'s title argument. Without it, a quoted URL becomes the window
      // title and nothing opens.
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // A browser that will not open is not a reason to stop a server that is working.
    console.log("LAUNCH BROWSER_NOT_OPENED");
  }
}

/** The oldest Node this package's server is known to run on. */
export const MINIMUM_NODE_MAJOR = 20;

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
    // Checked here rather than in the .cmd shim, because parsing a version in batch is worse than
    // the problem it solves, and because a bundled Node makes the shim's check moot anyway.
    console.error("LAUNCH REFUSED UNSUPPORTED_NODE");
    console.error(
      `  Market OS needs Node ${MINIMUM_NODE_MAJOR} or newer; this one is ${process.versions.node}.`,
    );
    return 9;
  }

  const { file } = readConfigFile();
  const resolution = resolveLaunchConfig({ file, env: process.env });
  if (!resolution.ok) {
    console.error(`LAUNCH REFUSED ${resolution.refusal}`);
    console.error(`  ${REFUSAL_HELP[resolution.refusal]}`);
    return 2;
  }

  const config = resolution.config;
  if (process.argv.includes("--no-browser")) config.openBrowser = false;
  console.log(describeLaunchConfig(config));

  const redact = makeRedactor(config.databaseUrl);
  let ownsDatabase = false;

  if (config.postgres) {
    const database = startDatabase(config);
    if (!database.ok) return 3;
    ownsDatabase = database.started;
  }

  if (!runFirstRun(config)) {
    console.error("LAUNCH REFUSED SETUP_FAILED");
    console.error("  The messages above say what first-run setup found. Nothing was started.");
    if (ownsDatabase) stopDatabase(config);
    return 4;
  }

  const server = startServer(config);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!server.killed) server.kill();
    if (ownsDatabase) stopDatabase(config);
  };
  // Every way out of this process that Windows lets a program observe.
  //
  // `SIGINT` is a console Ctrl+C and does arrive. `SIGBREAK` is Ctrl+Break, and `SIGHUP` reaches
  // Node when a console window closes. `exit` catches a normal return and an uncaught throw, and
  // runs synchronously, which is why `shutdown` uses `spawnSync` throughout.
  //
  // What none of these catches is a hard kill: `TerminateProcess` — Task Manager, `taskkill /F`,
  // `child.kill()` from another program — cannot be intercepted, so the database this launcher
  // started can survive it. That is measured, not feared: an acceptance run killed a launcher and
  // found PostgreSQL still up. The answer is not a better handler, because there is not one; it is
  // `OWNERSHIP_MARKER`, which lets the NEXT launch recognise that cluster as ours and stop it when
  // it exits properly.
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
    try {
      process.on(signal, () => {
        shutdown();
        process.exit(0);
      });
    } catch {
      // Not every signal name is valid on every platform, and one that is not is not a reason to
      // register none of the others.
    }
  }
  process.on("exit", shutdown);
  // The server's stderr is the one stream that could carry a connection string, since a database
  // failure surfaces there.
  server.stderr?.on("data", (chunk) => process.stderr.write(redact(chunk)));

  const verdict = await waitForReady(config, Date.now());

  if (verdict === "READY") {
    const url = `http://127.0.0.1:${config.port}/`;
    console.log(`LAUNCH READY ${url}`);
    if (config.openBrowser) openBrowser(url);
    // Without `--stay` this returns here, and the `exit` handler above then stops the server and
    // the database on the way out. That is deliberate rather than a leak: this launcher is always
    // the supervisor of what it started, and a mode that walked away would leave a server with
    // nothing watching it and a database nobody remembers owning.
    //
    // So the two modes are "start it, prove it works, put it back" and, with `--stay`, "start it
    // and keep it running until this window closes". The double-clicked shortcut passes `--stay`.
    if (!process.argv.includes("--stay")) {
      // Explicitly, rather than by returning and trusting the `exit` handler. Returning does not
      // end this process: the server child is held by its stderr pipe and the event loop stays
      // alive, so `exit` never fires. Measured — an acceptance run reached READY, printed nothing
      // further, and left both the launcher and the database running. Relying on a program to
      // exit is not the same as making it.
      shutdown();
      return 0;
    }
    await new Promise(() => {});
  }

  if (verdict === "NOT_MARKET_OS") {
    console.error("LAUNCH REFUSED PORT_IN_USE");
    console.error(
      `  Something else is already answering on port ${config.port}. Market OS did not open a\n` +
        "  browser at it. Choose another port in market-os.json, or stop the other program.",
    );
  } else {
    console.error("LAUNCH REFUSED NOT_READY_IN_TIME");
    console.error("  The server started but never reported itself ready. Nothing was opened.");
  }
  shutdown();
  return 5;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`LAUNCH UNEXPECTED_FAILURE (${error?.name ?? "Error"})`);
    process.exitCode = 8;
  },
);
