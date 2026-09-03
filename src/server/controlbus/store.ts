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
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ControlBusState, InboxEntry } from "./state";
import { emptyState } from "./state";
import { defaultBusRoot } from "./root";
import { ownerLiveness, processStart, type OwnerIdentity, type StartProbe } from "./owner";

// The bus's NAME and the rule for turning it into a PLACE live in `./root`, which knows nothing
// about decisions. Re-exported because every caller has always asked this module for them, and
// because `applicationPrerequisite.test.ts` — rightly — objects to one file that both reads
// decisions and spawns a process.
export { RUNTIME_DIR, repositoryBusRoot } from "./root";

export interface StorePaths {
  root: string;
  state: string;
  inbox: string;
  outbox: string;
  lock: string;
  log: string;
}

export function storePaths(explicitRoot?: string): StorePaths {
  const root = explicitRoot ?? defaultBusRoot();
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

/**
 * The outbound APPEND-ONLY LOG. Advisory, never the authority.
 *
 * It was called `appendOutbox`, had no callers at all, and wrote a file no reader consulted while
 * `health()` and the triage's open-id authority both read `state.outbox` — two independently
 * mutable records of the same thing, one of them dead (IR-115). Renamed so the role is unmistakable
 * and given exactly one caller: `outbound.ts` writes this first and the state array second, in that
 * order, so a crash between them costs a re-read rather than a claim that outran its evidence.
 *
 * Do not call it alone. Writing the log without the state reintroduces the split.
 */
export function appendOutboxLog(paths: StorePaths, line: object): void {
  ensureRuntimeDir(paths);
  appendFileSync(paths.outbox, `${JSON.stringify(line)}\n`, "utf8");
}

/**
 * The authority write, atomic, for callers outside a poll cycle.
 *
 * `commitCycle` stays the watcher's path and orders inbox-then-cursor. This is the same atomic
 * rename for the outbound side, so state reaches disk one way rather than through an ad-hoc
 * `writeFileSync` that can leave a truncated document.
 */
export function writeState(paths: StorePaths, state: object): void {
  ensureRuntimeDir(paths);
  writeAtomic(paths.state, `${JSON.stringify(state, null, 2)}\n`);
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
  /**
   * What the OS says about the owning process, so ownership can be PROVED rather than assumed.
   *
   * Optional because records written before IR-075 do not carry it, and a record that cannot be
   * judged must fail closed rather than be guessed at — `ownerLiveness` answers `UNKNOWN` for one,
   * and `UNKNOWN` never permits a takeover.
   */
  owner?: OwnerIdentity;
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
  probe: StartProbe = processStart,
): LockOutcome {
  ensureRuntimeDir(paths);
  const serialised = `${JSON.stringify(record, null, 2)}\n`;

  // Fast path: nobody holds it.
  if (createExclusive(paths.lock, serialised)) return { acquired: true, record };

  const nowMs = Date.parse(record.startedAt);
  const held = readLock(paths);

  // An unreadable lock is not an abandoned one, and IR-075 is explicit that it never becomes one
  // by waiting. `wx` creates the directory entry before the contents land, so a competitor
  // acquiring RIGHT NOW is briefly an empty file; but a permanently corrupt record is equally
  // unjudgeable, and the previous version let elapsed time convert it into a takeover.
  //
  // Refusing forever is an availability cost, taken deliberately: manufacturing ownership from an
  // unreadable record is how two watchers end up writing one cursor. The reason names the recovery.
  if (!held) {
    return {
      acquired: false,
      heldBy: record,
      reason: lockWrittenRecently(paths.lock, nowMs)
        ? "the lock file was created moments ago and is still being written"
        : `the lock at ${paths.lock} cannot be read, so its owner cannot be proved gone; ` +
          "remove it by hand once you have confirmed no watcher is running",
    };
  }

  const liveness = ownerLiveness(held.owner, probe);
  if (liveness.state !== "GONE") {
    // Heartbeat age is a HEALTH signal and never an ownership proof. IR-075: a watcher suspended
    // inside its critical section stops writing heartbeats while still owning the channel, and the
    // old condition — `alive && !stale` — made exactly that case replaceable.
    const stale = lockIsStale(held, staleAfterMs, nowMs);
    return {
      acquired: false,
      heldBy: held,
      reason:
        liveness.state === "ALIVE"
          ? `watcher pid ${held.pid} is still running (${liveness.because})` +
            (stale
              ? "; its heartbeat has lapsed, which is a health signal and not an eviction"
              : "")
          : `cannot prove the holder is gone: ${liveness.because}`,
    };
  }

  // The owner is PROVEN gone, so somebody may take over — but only one somebody, and only under
  // the mutation right.
  return (
    withMutation(paths, record, staleAfterMs, nowMs, probe, () => {
      // Re-read INSIDE the right. The holder may have been replaced by a live watcher while we were
      // queuing for it, and acting on the record we read outside is exactly the class of mistake
      // this rewrite exists to end.
      const current = readLock(paths);
      if (current && ownerLiveness(current.owner, probe).state !== "GONE") {
        return {
          acquired: false,
          heldBy: current,
          reason: `watcher pid ${current.pid} took the lock first and cannot be proved gone`,
        };
      }
      if (!stillHoldsMutation(paths, record)) {
        return {
          acquired: false,
          heldBy: current ?? record,
          reason: "the mutation right expired before the lock could be replaced",
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
export function heartbeat(
  paths: StorePaths,
  record: LockRecord,
  at: string,
  probe: StartProbe = processStart,
): boolean {
  const result = withMutation(paths, record, HEARTBEAT_STALE_MS, Date.parse(at), probe, () => {
    const held = readLock(paths);
    // Positive ownership. An unreadable record is not "not somebody else's".
    if (!held || held.nonce !== record.nonce) return false;
    if (!stillHoldsMutation(paths, record)) return false;
    // Written through a temp file rather than in place. Holding the right means nothing else
    // SHOULD be looking, but an in-place rewrite is briefly truncated on disk and an acquirer
    // reading at that instant would see a corrupt record — the same partial-read the acquisition
    // path just had to defend against, produced by the refresh instead of the create.
    writeAtomic(paths.lock, `${JSON.stringify({ ...record, startedAt: at }, null, 2)}\n`);
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
export function releaseLock(
  paths: StorePaths,
  record?: LockRecord,
  probe: StartProbe = processStart,
): void {
  if (!existsSync(paths.lock)) return;
  if (!record) return;

  withMutation(paths, record, HEARTBEAT_STALE_MS, Date.now(), probe, () => {
    const held = readLock(paths);
    if (!held || held.nonce !== record.nonce) return false;
    if (!stillHoldsMutation(paths, record)) return false;
    removeIfPresent(paths.lock);
    return true;
  });
}

/** What a write attempt under canonical authority produced, or why it produced nothing. */
export type WriteAuthority<T> = { held: true; value: T } | { held: false; reason: string };

/**
 * Run `body` while this process PROVABLY holds the right to write canonical state.
 *
 * The existing exclusion primitive, exposed rather than duplicated. `outbound.ts` needed it after
 * review found the hole: it checked the watcher lock ONCE, then went away for a network round trip,
 * then wrote the state object it had captured before leaving. A snapshot test is not a
 * serialisation primitive, and the store's own header says so — atomic rename gives content
 * atomicity, never writer exclusion. Two things could go wrong in that gap and both did on paper: a
 * watcher acquires ownership mid-flight, and the state it advanced meanwhile is overwritten by the
 * stale object.
 *
 * Three checks, in this order, and the middle one is the only real mutex:
 *
 * 1. BEFORE: a live lock held by somebody else refuses immediately. Ownership is `(pid, nonce)`,
 *    never pid alone — pids are recycled, and `acquireLock` already treats the nonce as the
 *    sufficient condition. A same-pid different-nonce record is a DIFFERENT lease.
 * 2. THE TOKEN: `withMutation` `wx`-creates the mutation right. Exactly one racer wins a create.
 * 3. AFTER, still inside the token: re-read the lock. If it changed identity while we were taking
 *    the right, ownership was replaced under us and nothing may be written.
 *
 * `body` runs only when all three pass, so it is the only place a caller may reload-and-write.
 */
export function withCanonicalWriteAuthority<T>(
  paths: StorePaths,
  claim: LockRecord,
  staleAfterMs: number,
  nowMs: number,
  body: () => T,
  /** Test seam: fires after the write right is won and before ownership is re-read. */
  afterRightTaken?: () => void,
  probe: StartProbe = processStart,
): WriteAuthority<T> {
  const ours = (held: LockRecord | null): boolean =>
    held === null || (held.pid === claim.pid && held.nonce === claim.nonce);

  const before = readLock(paths);
  // IR-075 here too: the pre-flight refused only a holder that was alive AND current, so a live
  // owner whose heartbeat had lapsed stopped blocking the canonical write. Ownership decides;
  // staleness does not.
  if (before !== null && !ours(before) && ownerLiveness(before.owner, probe).state !== "GONE") {
    return {
      held: false,
      reason: `a live watcher holds the lock (pid ${before.pid}, nonce ${before.nonce})`,
    };
  }

  const outcome = withMutation(paths, claim, staleAfterMs, nowMs, probe, (): WriteAuthority<T> => {
    // A seam, and it exists because the branch below was otherwise UNREACHABLE from any control.
    //
    // `M-AUTH-NO-RECHECK` came back MISSED: the pre-flight above already refuses anything a test
    // can arrange, because it runs after the caller's network round trip. The window this re-check
    // actually guards is between that read and winning the mutation right — microseconds, with no
    // await in it, and nothing could open it on demand. An unreachable safety branch with a green
    // suite over it is the shape this project keeps paying for, so the window is made openable
    // rather than left as an assertion about itself.
    afterRightTaken?.();
    const during = readLock(paths);
    // A lock that vanished is not a failure — nobody owns it, so we continue. Neither is a STALE
    // foreign lock: refusing on that would let one leftover file block every future write, which is
    // a deadlock dressed as caution. Only a LIVE foreign lease is a replacement, and it is tested
    // exactly as the pre-flight tests it.
    if (
      during !== null &&
      !ours(during) &&
      processAlive(during.pid) &&
      !lockIsStale(during, staleAfterMs, nowMs)
    ) {
      return {
        held: false,
        reason:
          "ownership changed while taking the write right " +
          `(now pid ${during.pid}, nonce ${during.nonce})`,
      };
    }
    return { held: true, value: body() };
  });

  return outcome ?? { held: false, reason: "another writer holds the mutation right" };
}

/** Default staleness horizon for the mutation right, in milliseconds. */
const HEARTBEAT_STALE_MS = 45_000;

/**
 * Whether the lock file was created too recently to be judged abandoned.
 *
 * Filesystem mtime, because an unreadable record has no timestamp inside it by definition. One
 * second is far longer than the gap between `wx` creating the entry and the write completing, and
 * far shorter than any staleness horizon, so it separates "mid-write" from "corrupt" without
 * delaying a genuine takeover.
 */
function lockWrittenRecently(lockPath: string, nowMs: number): boolean {
  try {
    const age = nowMs - statSync(lockPath).mtimeMs;
    // Bounded on BOTH sides. Without a lower bound a future mtime gives a negative age, which is
    // also "under a second", so a clock rollback would hold acquisition off until wall time caught
    // up — the same shape as the future-heartbeat bug one function up.
    //
    // The lower bound is a full second rather than zero, and that is not slack for its own sake:
    // `nowMs` comes from an ISO string truncated to milliseconds while `mtimeMs` carries
    // sub-millisecond precision, so a genuinely-just-written file reads as fractionally in the
    // future. A strict `age >= 0` rejected exactly the case this function exists to catch, which
    // its own test caught immediately.
    return age > -1_000 && age < 1_000;
  } catch {
    return false;
  }
}

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
 *
 * **Known residual, stated rather than papered over.** A lease can expire while its holder is
 * paused mid-function, after which a successor legitimately takes the right and both can act. The
 * fencing check narrows the window to the gap between the check and the write; it does not remove
 * it, because check-and-act is two operations and plain files offer no way to make it one.
 *
 * Reaching it needs two watchers racing AND one suspended past the lease mid-operation — and
 * `control-bus:start` refuses while a live lock exists, so it takes deliberate concurrent starts
 * plus a machine suspend. Recorded as IR-075.
 *
 * **The fix this comment used to name is DISPROVEN.** It said: hold the lock file open for the
 * process lifetime, because on Windows an open handle cannot be deleted or renamed by another
 * process. `scripts/probe-open-handle-exclusion.ts` measured it on this machine, and with the
 * handle held open (`openSync(path, "r+")`) another process:
 *
 *     unlink                 SUCCEEDED
 *     exclusive create (wx)  SUCCEEDED, at the same path, immediately after
 *
 * The Win32 behaviour the claim appeals to depends on the SHARE MODE a handle is opened with, and
 * `fs.openSync` gives a caller no way to choose it — libuv opens with delete sharing permitted. So
 * the property is not available through the API any implementation here would use, and a rewrite
 * built on it would have failed late, after its own review cycle.
 *
 * No replacement is named, deliberately. The honest state is that the primitive is unknown: a real
 * OS mutex or an advisory-locking library would each be a new dependency and a cost decision, and
 * naming an unmeasured second candidate is how the first one got here. The next attempt starts by
 * MEASURING a primitive, not by quoting one.
 *
 * The residual therefore stands, with its narrow reachability unchanged, and the probe is committed
 * so the correction cannot be lost the way the original claim was kept.
 * It expires, because a process that dies holding it would wedge the channel — and a deadlock is
 * not an improvement on a race.
 */
function withMutation<T>(
  paths: StorePaths,
  record: LockRecord,
  staleAfterMs: number,
  nowMs: number,
  probe: StartProbe,
  body: () => T,
): T | null {
  const mutationPath = `${paths.lock}.mutate`;
  // Stamped with the CURRENT time, not with `record.startedAt`.
  //
  // That was a real functional bug and not merely a race: a watcher's record is created once at
  // startup and never replaced, so after a few hours `record.startedAt` is hours old. Using it as
  // "now" made every later `.mutate` file look as though it came from the future, so nothing ever
  // expired, and a single orphaned right would have stopped the watcher permanently. Found by the
  // confirmation review as a lease-timestamp issue; the deadlock was the part that mattered.
  const stamp = `${JSON.stringify({
    nonce: record.nonce,
    at: new Date(nowMs).toISOString(),
    owner: record.owner,
  })}\n`;

  if (!createExclusive(mutationPath, stamp)) {
    // Somebody holds it. IR-075, one layer down: expiry USED to be the whole test, so a holder
    // suspended mid-operation lost the right on time alone and two callers could both act. The
    // right is now taken only from an owner PROVEN gone. An expired lease held by a live process
    // is a health complaint, not a vacancy.
    type MutationStamp = { at?: string; owner?: OwnerIdentity };
    let heldStamp: MutationStamp | null = null;
    try {
      heldStamp = JSON.parse(readFileSync(mutationPath, "utf8")) as MutationStamp;
    } catch {
      heldStamp = null;
    }
    // Unreadable is unjudgeable, and time never converts it into a vacancy either.
    if (!heldStamp) return null;
    if (ownerLiveness(heldStamp.owner, probe).state !== "GONE") return null;

    // Elapsed time is still required, so a takeover cannot race a holder that is mid-operation and
    // about to finish. Both conditions, not either: proven gone AND past its lease.
    const heldAt = Date.parse(heldStamp.at ?? "");
    if (!Number.isNaN(heldAt) && nowMs - heldAt <= staleAfterMs) return null;

    removeIfPresent(mutationPath);
    if (!createExclusive(mutationPath, stamp)) return null;
  }

  try {
    return body();
  } finally {
    // Only our own. Without the check, a caller whose lease expired mid-operation would remove the
    // right that a successor legitimately took — the same class of mistake as deleting a lock by
    // pathname, one level up.
    if (readMutationNonce(mutationPath) === record.nonce) removeIfPresent(mutationPath);
  }
}

/** The nonce currently stamped on the mutation right, or null when absent or unreadable. */
function readMutationNonce(mutationPath: string): string | null {
  try {
    return (JSON.parse(readFileSync(mutationPath, "utf8")) as { nonce: string }).nonce;
  } catch {
    return null;
  }
}

/**
 * Whether this caller still holds the mutation right.
 *
 * Fencing. The lease can expire while an operation is in flight — a laptop suspending mid-function
 * is the realistic way — and a successor may then legitimately take it. Re-checking immediately
 * before the destructive step means the loser abandons its write instead of landing it on top of
 * whatever the successor installed.
 *
 * This narrows the window rather than closing it: the check and the write are still two
 * operations. Closing it entirely needs a lease long enough that expiry-mid-operation cannot
 * happen, or a primitive that plain files do not have — and the honest statement is that the
 * remaining exposure requires a process frozen mid-function for longer than the lease.
 */
function stillHoldsMutation(paths: StorePaths, record: LockRecord): boolean {
  return readMutationNonce(`${paths.lock}.mutate`) === record.nonce;
}
