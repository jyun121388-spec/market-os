/**
 * The control-bus watcher process, and its start/status/stop commands.
 *
 * Portable Node rather than a shell daemon. This machine is Windows, and every Unix daemonisation
 * trick — nohup, double-fork, trap handlers — is either absent or behaves differently here. A
 * detached child with `unref()` is the one mechanism that works the same on both.
 *
 * Usage:
 *   npm run control-bus:start    detach a watcher, or report the one already running
 *   npm run control-bus:status   health, cursor, inbox depth, last read
 *   npm run control-bus:stop     signal the running watcher and release the lock
 *   npm run control-bus:once     a single cycle in the foreground, for diagnosis
 *
 * **The honest limitation, recorded here because it is easy to forget:** this watcher polls from
 * this machine. If Windows sleeps, hibernates or powers off, it stops polling, and decisions sit
 * on GitHub unread until it wakes. Nothing here is "always on"; it is "on while the machine is".
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { health, unprocessedDecisions } from "@/server/controlbus/state";
import {
  acquireLock,
  heartbeat,
  loadState,
  logLine,
  processAlive,
  readLock,
  releaseLock,
  storePaths,
} from "@/server/controlbus/store";
import { githubFetchComments, runCycle } from "@/server/controlbus/watch";

const ISSUE = 2;
const HEARTBEAT_MS = 45_000;
const paths = storePaths();

const nowIso = () => new Date().toISOString();

async function watchForever(): Promise<void> {
  const record = {
    pid: process.pid,
    startedAt: nowIso(),
    // Distinguishes this run from a recycled pid. Cheap, and pid recycling is fast on Windows.
    nonce: `${process.pid}-${process.hrtime.bigint().toString(36)}`,
  };

  const outcome = acquireLock(paths, record, HEARTBEAT_MS);
  if (!outcome.acquired) {
    console.error(`Not starting: ${outcome.reason}`);
    process.exitCode = 1;
    return;
  }

  const shutdown = () => {
    logLine(paths, `${nowIso()} watcher stopping (pid ${process.pid})`);
    releaseLock(paths, record);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logLine(paths, `${nowIso()} watcher started (pid ${process.pid})`);

  let state = loadState(paths, ISSUE);
  for (;;) {
    const result = await runCycle({
      state,
      paths,
      fetchComments: githubFetchComments,
      now: nowIso(),
    });
    state = result.state;

    // The heartbeat is what makes a stale lock detectable. Written after the cycle, so a watcher
    // wedged inside a fetch stops heartbeating and is correctly judged stale.
    // Stop if the lock has moved on. A watcher that lost its lock to a replacement must not keep
    // writing the shared cursor — that is the concurrent-writer case (IR-049) from the other side.
    if (!heartbeat(paths, record, nowIso())) {
      logLine(
        paths,
        `${nowIso()} lock taken over by another watcher; exiting (pid ${process.pid})`,
      );
      return;
    }

    if (result.admitted.length > 0) {
      // Deliberately only a log line and a durable inbox. The watcher never applies anything —
      // that is the consumer's job, at a scheduler checkpoint, after Governance has had its say.
      logLine(paths, `${nowIso()} CONTROL_EVENT decision(s) awaiting the consumer`);
    }

    await new Promise((resolve) => setTimeout(resolve, result.nextDelayMs));
  }
}

function status(): void {
  const lock = readLock(paths);
  const alive = lock !== null && processAlive(lock.pid);
  const state = existsSync(paths.state) ? loadState(paths, ISSUE) : null;

  if (!state) {
    console.log("control bus: never run. `npm run control-bus:start` to begin.");
    return;
  }

  const pending = unprocessedDecisions(state);
  console.log(
    `health              ${health({ state, watcherAlive: alive, writeAvailable: false })}`,
  );
  console.log(`watcher             ${alive ? `alive (pid ${lock?.pid})` : "not running"}`);
  console.log(`issue               #${state.issueNumber}`);
  console.log(`last remote comment ${state.lastRemoteCommentId ?? "none"}`);
  console.log(
    `last successful read${state.lastSuccessfulRead ? ` ${state.lastSuccessfulRead}` : " never"}`,
  );
  console.log(
    `last successful write${state.lastSuccessfulWrite ? ` ${state.lastSuccessfulWrite}` : " never"}`,
  );
  console.log(
    `inbox depth         ${state.inbox.length} (${pending.length} awaiting the consumer)`,
  );
  console.log(`outbox depth        ${state.outbox.length}`);
  console.log(`consecutive failures${` ${state.consecutiveFailures}`}`);
  console.log(`transport           ${state.transportState}`);
  if (!alive) {
    console.log(
      "\nThe watcher is not running, so decisions posted to the issue are not being read.\n" +
        "This is also the state after the machine sleeps or restarts — it is not always-on.",
    );
  }
}

function stop(): void {
  const lock = readLock(paths);
  if (!lock) {
    console.log("No watcher lock present; nothing to stop.");
    return;
  }
  if (!processAlive(lock.pid)) {
    releaseLock(paths);
    console.log(`Stale lock for pid ${lock.pid} removed.`);
    return;
  }
  try {
    process.kill(lock.pid, "SIGTERM");
    console.log(`Signalled watcher pid ${lock.pid}.`);
  } catch (error) {
    // Never force. A pid that refuses SIGTERM may not be our watcher at all — pid reuse is the
    // whole reason the nonce exists — and killing it harder would compound the mistake.
    console.error(
      `Could not signal pid ${lock.pid}: ${error instanceof Error ? error.name : "unknown"}. ` +
        "The lock is left in place deliberately; remove it by hand if the process is gone.",
    );
    process.exitCode = 1;
  }
}

function start(): void {
  const lock = readLock(paths);
  if (lock && processAlive(lock.pid)) {
    console.log(`Watcher already running (pid ${lock.pid}). Nothing to do.`);
    return;
  }
  // `__filename` does not exist under ESM, which is how tsx runs this. Deriving it from
  // import.meta.url is the portable form and avoids a runtime crash that only appears on start.
  const selfPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [...process.execArgv, selfPath, "watch"], {
    detached: true,
    stdio: "ignore",
    // Quoting matters here: this repository's path has no spaces, but a user's checkout might.
    // `spawn` with an argument array never builds a command line, so nothing needs escaping.
    cwd: process.cwd(),
  });
  child.unref();
  console.log(`Watcher started (pid ${child.pid}). \`npm run control-bus:status\` to check.`);
}

async function once(): Promise<void> {
  const state = loadState(paths, ISSUE);
  const result = await runCycle({
    state,
    paths,
    fetchComments: githubFetchComments,
    now: nowIso(),
  });
  console.log(`${result.outcome}: ${result.detail}`);
  console.log(`next poll would be in ${Math.round(result.nextDelayMs / 1000)}s`);
}

const command = process.argv[2] ?? "status";
const main = async () => {
  switch (command) {
    case "watch":
      await watchForever();
      break;
    case "start":
      start();
      break;
    case "stop":
      stop();
      break;
    case "once":
      await once();
      break;
    default:
      status();
  }
};

void main();
