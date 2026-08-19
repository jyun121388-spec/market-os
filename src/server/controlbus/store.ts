/**
 * Durable local state for the control bus, and the single-instance lock.
 *
 * Everything here lives under a gitignored runtime directory. None of it is committed: a watcher
 * polling every 45 seconds would otherwise produce a commit stream that buries the engineering
 * history it is supposed to sit alongside. The schema, the tests and the documentation are the
 * committed parts; the cursor and the message log are not.
 *
 * Two properties are load-bearing.
 *
 * **Writes are atomic.** Every state write goes to a temporary file and is renamed into place, so
 * a crash mid-write leaves either the previous state or the new one and never a truncated JSON
 * document. A control bus whose cursor file can be half-written has no crash story at all.
 *
 * **Messages are appended before the cursor moves.** `commitCycle` enforces the ordering rather
 * than documenting it, because it is the one invariant a later edit is most likely to reverse for
 * tidiness — and the reversal loses decisions permanently while looking like a refactor.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ControlBusState, InboxEntry } from "./state";
import { emptyState } from "./state";

export const RUNTIME_DIR = ".local/control-bus";

export interface StorePaths {
  root: string;
  state: string;
  inbox: string;
  outbox: string;
  lock: string;
  log: string;
}

export function storePaths(root: string = RUNTIME_DIR): StorePaths {
  return {
    root,
    state: join(root, "state.json"),
    inbox: join(root, "inbox.jsonl"),
    outbox: join(root, "outbox.jsonl"),
    lock: join(root, "watcher.lock.json"),
    log: join(root, "watcher.log"),
  };
}

export function ensureRuntimeDir(paths: StorePaths): void {
  if (!existsSync(paths.root)) mkdirSync(paths.root, { recursive: true });
}

/** Temp-file-and-rename. `rename` is atomic within a filesystem on both Windows and POSIX. */
function writeAtomic(path: string, contents: string): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, contents, "utf8");
  // Windows `rename` fails if the destination exists, unlike POSIX. `renameSync` handles the
  // replace for us on Node, but the temp file must be removed if it somehow does not.
  try {
    renameSync(temp, path);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

export function loadState(paths: StorePaths, issueNumber: number): ControlBusState {
  if (!existsSync(paths.state)) return emptyState(issueNumber);
  try {
    return JSON.parse(readFileSync(paths.state, "utf8")) as ControlBusState;
  } catch {
    // A corrupt state file is recoverable and must not be silently replaced by an empty one — that
    // would reset the cursor to the beginning and re-admit every decision on the issue as new.
    // Refusing loudly is the only safe response.
    throw new Error(
      `${paths.state} is not readable JSON. The cursor is in it, so starting fresh would ` +
        "re-admit every decision on the issue. Move the file aside deliberately if that is what " +
        "you want.",
    );
  }
}

/**
 * Persists one poll cycle: messages first, then the cursor.
 *
 * The argument order of the writes is the crash-safety contract, so it lives in one function that
 * every caller goes through rather than in a comment beside two calls someone can reorder.
 */
export function commitCycle(
  paths: StorePaths,
  state: ControlBusState,
  admitted: InboxEntry[],
): void {
  ensureRuntimeDir(paths);

  // 1. Durable message log, append-only. If the process dies here, the next cycle re-reads the
  //    same comments from GitHub and deduplication absorbs them.
  for (const entry of admitted) {
    appendFileSync(paths.inbox, `${JSON.stringify(entry)}\n`, "utf8");
  }

  // 2. Only now the cursor. A crash between the two costs a redelivery, never a decision.
  writeAtomic(paths.state, `${JSON.stringify(state, null, 2)}\n`);
}

export function appendOutbox(paths: StorePaths, line: object): void {
  ensureRuntimeDir(paths);
  appendFileSync(paths.outbox, `${JSON.stringify(line)}\n`, "utf8");
}

/** Bounded log. Rotation by truncation, because an unbounded log on a 45-second poll is a leak. */
export function logLine(paths: StorePaths, message: string, maxBytes = 512_000): void {
  ensureRuntimeDir(paths);
  if (existsSync(paths.log)) {
    const size = readFileSync(paths.log).byteLength;
    if (size > maxBytes) writeFileSync(paths.log, "", "utf8");
  }
  appendFileSync(paths.log, `${message}\n`, "utf8");
}

export interface LockRecord {
  pid: number;
  startedAt: string;
  /** Identifies THIS run, so a reused pid cannot impersonate it. */
  nonce: string;
}

export type LockOutcome =
  { acquired: true; record: LockRecord } | { acquired: false; heldBy: LockRecord; reason: string };

/**
 * Whether a lock record describes a process that is actually running.
 *
 * A bare pid check is not enough and the failure is not theoretical: pids are recycled, quickly on
 * Windows, so a stale lock from a crashed watcher can name a pid that now belongs to something
 * unrelated. Answering "is that pid alive" then reports the wrong thing with total confidence and
 * the second watcher never starts.
 *
 * So the pid is a necessary condition and the nonce is the sufficient one — a live watcher rewrites
 * its lock with the same nonce as it polls, and a stale record is one whose heartbeat has stopped.
 */
export function lockIsStale(record: LockRecord, heartbeatAgeMs: number, nowMs: number): boolean {
  const started = Date.parse(record.startedAt);
  if (Number.isNaN(started)) return true;
  // Three missed heartbeats. Two is within the noise of a slow poll on a loaded machine.
  return nowMs - started > heartbeatAgeMs * 3;
}

export function processAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without delivering anything. Throws if the pid is gone.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(
  paths: StorePaths,
  record: LockRecord,
  staleAfterMs: number,
): LockOutcome {
  ensureRuntimeDir(paths);
  if (existsSync(paths.lock)) {
    let held: LockRecord | null = null;
    try {
      held = JSON.parse(readFileSync(paths.lock, "utf8")) as LockRecord;
    } catch {
      held = null;
    }
    if (held) {
      const stale = lockIsStale(held, staleAfterMs, Date.parse(record.startedAt));
      const alive = processAlive(held.pid);
      if (alive && !stale) {
        return {
          acquired: false,
          heldBy: held,
          reason: `watcher pid ${held.pid} is running and its heartbeat is current`,
        };
      }
      // Alive but not heartbeating means the pid was reused by something else; taking the lock is
      // correct and killing that process would not be.
    }
  }
  writeAtomic(paths.lock, `${JSON.stringify(record, null, 2)}\n`);
  return { acquired: true, record };
}

export function heartbeat(paths: StorePaths, record: LockRecord, at: string): void {
  writeAtomic(paths.lock, `${JSON.stringify({ ...record, startedAt: at }, null, 2)}\n`);
}

export function readLock(paths: StorePaths): LockRecord | null {
  if (!existsSync(paths.lock)) return null;
  try {
    return JSON.parse(readFileSync(paths.lock, "utf8")) as LockRecord;
  } catch {
    return null;
  }
}

export function releaseLock(paths: StorePaths): void {
  if (existsSync(paths.lock)) unlinkSync(paths.lock);
}
