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
 * Claims the lock by creating the file exclusively.
 *
 * The first version was `existsSync` then write, which is not acquisition at all — the second
 * review found the interleaving in one line: two watchers both see no lock, both write, both
 * return `acquired: true`. `writeAtomic` made the CONTENTS atomic and said nothing about
 * ownership, and the distinction is easy to miss because "atomic write" sounds like it covers it.
 *
 * `wx` is the primitive that actually decides: the OS creates the file or fails with EEXIST, and
 * exactly one caller can win. Everything else here is about what to do when it fails.
 */
export function acquireLock(
  paths: StorePaths,
  record: LockRecord,
  staleAfterMs: number,
): LockOutcome {
  ensureRuntimeDir(paths);
  const serialised = `${JSON.stringify(record, null, 2)}\n`;

  const claim = (): LockOutcome | null => {
    try {
      // Exclusive create. Fails rather than truncates if anyone got here first.
      writeFileSync(paths.lock, serialised, { encoding: "utf8", flag: "wx" });
      return { acquired: true, record };
    } catch {
      return null;
    }
  };

  const won = claim();
  if (won) return won;

  let held: LockRecord | null = null;
  try {
    held = JSON.parse(readFileSync(paths.lock, "utf8")) as LockRecord;
  } catch {
    held = null;
  }

  if (held) {
    const stale = lockIsStale(held, staleAfterMs, Date.parse(record.startedAt));
    // Alive but not heartbeating means the pid was reused by something unrelated. Taking the lock
    // is correct; killing that process would not be.
    if (processAlive(held.pid) && !stale) {
      return {
        acquired: false,
        heldBy: held,
        reason: `watcher pid ${held.pid} is running and its heartbeat is current`,
      };
    }
  }

  // The holder is stale or the file is unreadable. Remove it and re-claim exclusively — if another
  // watcher removes it first and claims, our re-claim fails and we correctly report not-acquired
  // rather than stealing it.
  try {
    unlinkSync(paths.lock);
  } catch {
    // Someone else cleared it between the read and here, which is fine: the claim below decides.
  }
  const reclaimed = claim();
  if (reclaimed) return reclaimed;

  return {
    acquired: false,
    heldBy: held ?? record,
    reason: "another watcher claimed the lock while this one was clearing a stale record",
  };
}

/**
 * Refreshes the lock, but only if we still hold it.
 *
 * The nonce existed from the start and nothing ever compared it, which the adversarial review
 * turned into a concrete sequence (IR-049): watcher A pauses past three heartbeats, B judges the
 * lock stale and takes it, A resumes and blindly rewrites the lock with its own record. Two
 * watchers, each believing it holds the lock, overwriting each other's state snapshots.
 *
 * Returns false when the lock has moved on. The caller stops rather than fighting for it — the
 * replacement is the legitimate holder, and a watcher that has lost its lock has no business
 * writing the shared cursor.
 */
export function heartbeat(paths: StorePaths, record: LockRecord, at: string): boolean {
  const held = readLock(paths);
  // Ownership must be POSITIVELY established. The first version passed when `held` was null, so a
  // corrupt or deleted lock read as "not somebody else's" and got overwritten — the second review
  // pointed out that absence of a mismatch is not proof of a match, which is the same fail-open
  // shape as an unsupplied allowlist.
  if (!held || held.nonce !== record.nonce) return false;
  writeAtomic(paths.lock, `${JSON.stringify({ ...record, startedAt: at }, null, 2)}\n`);
  return true;
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
 * The same defect as the heartbeat and the worse half of it: a resumed watcher deleting the lock
 * of the watcher that replaced it leaves no lock at all while a live process is still running, so
 * the next start sees the field clear and a third watcher joins.
 */
export function releaseLock(paths: StorePaths, record?: LockRecord): void {
  if (!existsSync(paths.lock)) return;
  if (record) {
    const held = readLock(paths);
    // Same correction as the heartbeat: a corrupt lock read as null and was then deleted by a
    // watcher that could not possibly have owned it, clearing the field while a live process was
    // still polling. Ownership has to be shown, not merely not-disproved.
    if (!held || held.nonce !== record.nonce) return;
  }
  unlinkSync(paths.lock);
}
