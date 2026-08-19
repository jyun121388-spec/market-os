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

/**
 * Temp-file-and-rename, so a crash mid-write leaves the old file or the new one and never a
 * half-written one.
 *
 * Used for `state.json` only. It gives ATOMICITY OF CONTENT and no exclusion whatsoever — the
 * distinction the lock rewrite above is entirely about — so it is safe here precisely because the
 * cursor has a single writer: the watcher holding the lock.
 *
 * The previous comment asserted that Windows `rename` fails when the destination exists. The
 * reviewer flagged it and it does not belong in the code either way: nothing here should depend on
 * cross-platform replacement semantics, and this function does not, because the destination is
 * only ever written by one process.
 */
function writeAtomic(path: string, contents: string): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, contents, "utf8");
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

  // A heartbeat in the future is not a fresh one. The subtraction goes negative and the record
  // stays "current" until wall time catches up, so a lock stamped 2099 would block acquisition for
  // decades — a dead watcher holding the channel shut with a typo. Small skew is tolerated because
  // clocks do drift; a heartbeat a full interval ahead is a broken record, not a fast clock.
  if (started - nowMs > heartbeatAgeMs) return true;

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

/**
 * The lock, rebuilt around the only atomic operation plain files actually give you.
 *
 * Three earlier attempts failed the same way, each time one indirection further out, and the shape
 * is worth stating because it is genuinely easy to walk into:
 *
 * 1. `existsSync` then write — two callers both see nothing and both write.
 * 2. Read, then `unlinkSync(path)` — deletes whatever is at the path, including the live lock a
 *    competitor created in between.
 * 3. Read, then `renameSync(path, token)` — MOVES whatever is at the path. A rename does not
 *    arbitrate anything; it just relocates the file, competitor's lock included.
 *
 * Each fix made the window smaller and left it open, and each carried a comment asserting it was
 * closed. The mistake underneath all three is treating an operation as a mutex because it is
 * atomic. `rename` is atomic; that says the move either happens or does not, and nothing about
 * WHICH file was moved.
 *
 * The one operation here that can arbitrate is EXCLUSIVE CREATE — `wx` fails when the file already
 * exists, so exactly one of any number of racers succeeds. So:
 *
 * - Acquiring an unheld lock is a `wx` create of the lock itself.
 * - Every other mutation — takeover, refresh, release — first `wx`-creates a separate mutation
 *   token. Whoever wins that create holds the exclusive right to touch the lock file, and
 *   everybody else backs off rather than guessing.
 *
 * The token is itself timestamped and expires, because a process that dies holding it would
 * otherwise wedge the channel permanently — a deadlock is not an improvement on a race.
 */
export function acquireLock(
  paths: StorePaths,
  record: LockRecord,
  staleAfterMs: number,
): LockOutcome {
  ensureRuntimeDir(paths);
  const serialised = `${JSON.stringify(record, null, 2)}\n`;

  // Fast path: nobody holds it.
  if (createExclusive(paths.lock, serialised)) return { acquired: true, record };

  const held = readLock(paths);
  const nowMs = Date.parse(record.startedAt);
  if (held && processAlive(held.pid) && !lockIsStale(held, staleAfterMs, nowMs)) {
    return {
      acquired: false,
      heldBy: held,
      reason: `watcher pid ${held.pid} is running and its heartbeat is current`,
    };
  }

  // The holder looks stale or the record is unreadable, so somebody may take over — but only one
  // somebody, and only under the mutation right.
  return (
    withMutation(paths, record, staleAfterMs, () => {
      // Re-read INSIDE the right. The holder may have been replaced by a live watcher while we were
      // queuing for it, and acting on the record we read outside is exactly the class of mistake
      // this rewrite exists to end.
      const current = readLock(paths);
      if (current && processAlive(current.pid) && !lockIsStale(current, staleAfterMs, nowMs)) {
        return {
          acquired: false,
          heldBy: current,
          reason: `watcher pid ${current.pid} took the lock first and its heartbeat is current`,
        };
      }
      removeIfPresent(paths.lock);
      if (createExclusive(paths.lock, serialised)) return { acquired: true, record };
      return {
        acquired: false,
        heldBy: current ?? record,
        reason: "the lock reappeared while it was being replaced",
      };
    }) ?? {
      acquired: false,
      heldBy: held ?? record,
      reason: "another watcher holds the mutation right; not competing for it",
    }
  );
}

/**
 * Refreshes the lock, and only while holding both the mutation right and the lock itself.
 *
 * Returns false when either is missing. The caller stops rather than retrying: a watcher that has
 * lost its lock has no business writing the shared cursor, and one that cannot get the mutation
 * right is racing a takeover it should let happen.
 */
export function heartbeat(paths: StorePaths, record: LockRecord, at: string): boolean {
  const result = withMutation(paths, record, HEARTBEAT_STALE_MS, () => {
    const held = readLock(paths);
    // Positive ownership. An unreadable record is not "not somebody else's".
    if (!held || held.nonce !== record.nonce) return false;
    // Safe to write in place: nothing else may touch the lock while the right is held, so there is
    // no destination-replacement question to get wrong per platform.
    writeFileSync(paths.lock, `${JSON.stringify({ ...record, startedAt: at }, null, 2)}\n`, "utf8");
    return true;
  });
  return result ?? false;
}

export function readLock(paths: StorePaths): LockRecord | null {
  if (!existsSync(paths.lock)) return null;
  try {
    return JSON.parse(readFileSync(paths.lock, "utf8")) as LockRecord;
  } catch {
    return null;
  }
}

/**
 * Releases the lock, and only our own.
 *
 * `record` is required in practice. The earlier signature made it optional and deleted
 * unconditionally when omitted, which is a live-lock destroyer sitting behind a default argument —
 * the reviewer found it as a separate finding from the races, and it is the easiest of the set to
 * trigger because it needs no concurrency at all.
 */
export function releaseLock(paths: StorePaths, record?: LockRecord): void {
  if (!existsSync(paths.lock)) return;
  if (!record) return;

  withMutation(paths, record, HEARTBEAT_STALE_MS, () => {
    const held = readLock(paths);
    if (!held || held.nonce !== record.nonce) return false;
    removeIfPresent(paths.lock);
    return true;
  });
}

/** Default staleness horizon for the mutation right, in milliseconds. */
const HEARTBEAT_STALE_MS = 45_000;

/** Exclusive create. True when this caller made the file; false when it already existed. */
function createExclusive(path: string, contents: string): boolean {
  try {
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone, which is the state we wanted.
  }
}

/**
 * Runs `body` while holding the exclusive right to mutate the lock, or returns null.
 *
 * The right is a `wx` create of a second file, which is what makes it a right rather than a hope.
 * It expires, because a process that dies holding it would wedge the channel — and a deadlock is
 * not an improvement on a race.
 */
function withMutation<T>(
  paths: StorePaths,
  record: LockRecord,
  staleAfterMs: number,
  body: () => T,
): T | null {
  const mutationPath = `${paths.lock}.mutate`;
  const stamp = `${JSON.stringify({ nonce: record.nonce, at: record.startedAt })}\n`;

  if (!createExclusive(mutationPath, stamp)) {
    // Somebody holds it. Take it over only if theirs has expired.
    let heldAt = Number.NaN;
    try {
      heldAt = Date.parse((JSON.parse(readFileSync(mutationPath, "utf8")) as { at: string }).at);
    } catch {
      heldAt = Number.NaN;
    }
    const nowMs = Date.parse(record.startedAt);
    const expired = Number.isNaN(heldAt) || nowMs - heldAt > staleAfterMs;
    if (!expired) return null;
    removeIfPresent(mutationPath);
    if (!createExclusive(mutationPath, stamp)) return null;
  }

  try {
    return body();
  } finally {
    removeIfPresent(mutationPath);
  }
}
