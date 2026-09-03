import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownerLiveness, processStart, selfIdentity } from "@/server/controlbus/owner";
import type { StartProbe } from "@/server/controlbus/owner";
import {
  acquireLock,
  heartbeat,
  readLock,
  releaseLock,
  storePaths,
  type LockRecord,
} from "@/server/controlbus/store";

/**
 * IR-075: a lease timeout was being used as ownership proof.
 *
 * `acquireLock` refused a holder only when `processAlive(pid) && !lockIsStale(...)`. Once the
 * heartbeat aged past three intervals, a watcher that was STILL RUNNING became replaceable — so a
 * suspended laptop produced watcher A alive inside its critical section, watcher B holding the
 * lock, and two processes writing one cursor. `withMutation` had the same shape one layer down.
 *
 * These are the controls that need a real, separately scheduled process, because the property is
 * about what the OS says rather than about what a stub says. The fixtures WRITE the lock record
 * themselves while the process it names is a genuine child — the record is setup, the liveness
 * answer is real, and the probe is the production one.
 *
 * Deterministic probes stay in `tests/controlBus.test.ts`, which is where the branch coverage
 * belongs; duplicating it here would only make the suite slower.
 */

const STALE_MS = 150;
/** Three missed heartbeats is `lockIsStale`'s threshold, so this is comfortably past eviction. */
const PAST_EVICTION_MS = STALE_MS * 5;

let root: string;
let paths: ReturnType<typeof storePaths>;
const children: ChildProcess[] = [];

/** A real, independently scheduled process that does nothing but exist. */
function spawnIdleChild(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

/**
 * A synchronous sleep with no spawn.
 *
 * The first version shelled out to `node -e setTimeout` between polls, which cost ~80ms of process
 * creation per 25ms of waiting and timed out control F. `Atomics.wait` blocks this thread on a
 * lock nobody will ever notify, which is exactly the primitive wanted here.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitFor(predicate: () => boolean, budgetMs = 15_000): boolean {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    // Deliberately synchronous: these controls are about a filesystem and an OS process table, and
    // a plain loop keeps the ordering obvious rather than hiding it behind a scheduler.
    sleepSync(25);
  }
  return false;
}

/**
 * Read once. On Windows every identity question spawns PowerShell (~450ms measured), and these
 * controls ask about THIS process repeatedly — the answer cannot change within a run.
 */
let cachedSelf: ReturnType<typeof selfIdentity> | undefined;
function me(): ReturnType<typeof selfIdentity> {
  if (cachedSelf === undefined) cachedSelf = selfIdentity();
  return cachedSelf;
}

function recordFor(pid: number, startedAt: string, heartbeatAt: string): LockRecord {
  const start = processStart(pid);
  return {
    pid,
    startedAt: heartbeatAt,
    nonce: `child-${pid}`,
    owner: "startedAt" in start ? { pid, startedAt: start.startedAt } : { pid, startedAt },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "owner-lease-"));
  paths = storePaths(root);
});

afterEach(() => {
  // Only the children this file started, by handle. Never by image name — a broad kill would take
  // the editor, the database and the test runner with it.
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill();
  rmSync(root, { recursive: true, force: true });
});

describe("IR-075: a live owner is never evicted by a lapsed lease", () => {
  it("A: refuses B while A is alive and A's heartbeat has been silent past eviction", () => {
    const a = spawnIdleChild();
    expect(a.pid, "the contender must actually have started").toBeGreaterThan(0);
    expect(
      waitFor(() => "startedAt" in processStart(a.pid!)),
      "A must be visible to the OS",
    ).toBe(true);

    // A's last heartbeat is far in the past: this is the evicted-by-lease case, deliberately set up
    // so the refusal below cannot be explained by a still-current lease.
    const silentSince = new Date(Date.now() - PAST_EVICTION_MS).toISOString();
    const held = recordFor(a.pid!, silentSince, silentSince);
    writeFileSync(paths.lock, JSON.stringify(held, null, 2), "utf8");
    const before = readFileSync(paths.lock, "utf8");

    const b: LockRecord = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      nonce: "contender-b",
      owner: me() ?? undefined,
    };
    const outcome = acquireLock(paths, b, STALE_MS);

    expect(outcome.acquired, "B must not take the lock from a living owner").toBe(false);
    expect(outcome.acquired === false && outcome.reason).toMatch(/still running/);
    // The WITNESS, not only the return code: the protected state must be untouched. A contender
    // that crashed before writing would otherwise satisfy the assertion above for the wrong reason.
    expect(readFileSync(paths.lock, "utf8")).toBe(before);
    expect(readLock(paths)?.nonce).toBe(held.nonce);
  }, 60_000);

  it("B: acquires once A is PROVEN gone, so an ordinary crash is not a deadlock", () => {
    const a = spawnIdleChild();
    expect(waitFor(() => "startedAt" in processStart(a.pid!))).toBe(true);

    const silentSince = new Date(Date.now() - PAST_EVICTION_MS).toISOString();
    writeFileSync(
      paths.lock,
      JSON.stringify(recordFor(a.pid!, silentSince, silentSince), null, 2),
      "utf8",
    );

    a.kill();
    expect(
      waitFor(() => "gone" in processStart(a.pid!)),
      "A must actually be gone",
    ).toBe(true);

    const b: LockRecord = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      nonce: "contender-b",
      owner: me() ?? undefined,
    };
    const outcome = acquireLock(paths, b, STALE_MS);

    expect(outcome.acquired, "refusing a live owner must not become refusing forever").toBe(true);
    expect(readLock(paths)?.nonce).toBe("contender-b");
  }, 60_000);

  it("C: refuses the mutation right to a contender while its live holder still has it", () => {
    // The same defect one layer down. A real child creates the right itself and keeps running; the
    // stamp is deliberately older than the lease, which used to be the whole test for stealing it.
    const holder = spawnIdleChild();
    expect(waitFor(() => "startedAt" in processStart(holder.pid!))).toBe(true);
    const holderStart = processStart(holder.pid!);
    if (!("startedAt" in holderStart)) throw new Error("the OS could not describe the holder");

    const mutationPath = `${paths.lock}.mutate`;
    writeFileSync(
      mutationPath,
      `${JSON.stringify({
        nonce: `child-${holder.pid}`,
        at: new Date(Date.now() - PAST_EVICTION_MS).toISOString(),
        owner: { pid: holder.pid, startedAt: holderStart.startedAt },
      })}\n`,
      "utf8",
    );
    const rightBefore = readFileSync(mutationPath, "utf8");

    // A lock whose owner IS gone, so acquisition genuinely reaches the mutation right rather than
    // stopping at the ownership check above it.
    const deadPid = 2_147_483_647;
    expect(processStart(deadPid), "the fixture premise").toEqual({ gone: true });
    writeFileSync(
      paths.lock,
      JSON.stringify({
        pid: deadPid,
        startedAt: new Date(Date.now() - PAST_EVICTION_MS).toISOString(),
        nonce: "dead-holder",
        owner: { pid: deadPid, startedAt: "whenever" },
      }),
      "utf8",
    );

    const outcome = acquireLock(
      paths,
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        nonce: "contender-b",
        owner: me() ?? undefined,
      },
      STALE_MS,
    );

    expect(outcome.acquired).toBe(false);
    expect(outcome.acquired === false && outcome.reason).toMatch(/mutation right/);
    // WHY it was refused, not merely that it was. The first version asserted only the refusal, and
    // a defect in the call — the bare identity passed where a record was expected — made every live
    // right-holder answer UNKNOWN instead of ALIVE. UNKNOWN blocks too, so the control stayed green
    // over a dead comparison. The mutant found it; this line is what would have.
    expect(
      ownerLiveness({
        pid: holder.pid!,
        owner: { pid: holder.pid!, startedAt: holderStart.startedAt },
      }).state,
      "the right's holder must be ALIVE, not merely unjudgeable",
    ).toBe("ALIVE");
    // Two authorities never existed: the right still belongs to the live child, byte for byte.
    expect(readFileSync(mutationPath, "utf8")).toBe(rightBefore);
    expect(readLock(paths)?.nonce, "and the lock was not replaced either").toBe("dead-holder");
  }, 60_000);

  it("D: a reused pid with a different start identity is not the old owner", () => {
    // The real probe, against this very process: same pid, a start time that is not ours. If
    // identity were pid-only this would answer ALIVE and a successor could never reclaim after
    // recycling; if it ignored the pid it would answer GONE for a living owner.
    const reused = ownerLiveness({
      pid: process.pid,
      owner: { pid: process.pid, startedAt: "1970-01-01T00:00:00.000Z" },
    });
    expect(reused.state).toBe("GONE");
    expect(reused.because).toMatch(/reused/);

    const mine = me();
    expect(mine, "this platform must be able to describe its own process").not.toBeNull();
    expect(ownerLiveness({ pid: process.pid, owner: mine ?? undefined }).state).toBe("ALIVE");

    /**
     * The two LEGACY cases, and they differ — found by running the repair against the real control
     * bus, where the first outbound post was refused by a nine-day-old record for a pid that had
     * been absent the whole time.
     *
     * An absent pid is proof of abandonment on its own: a recycled id cannot make a missing process
     * present, so a start time would add nothing. A LIVE pid with no recorded identity is the case
     * that genuinely cannot be decided, and only that one blocks.
     */
    expect(ownerLiveness({ pid: 2_147_483_647 }).state, "absent pid, no identity").toBe("GONE");
    const live = ownerLiveness({ pid: process.pid });
    expect(live.state, "live pid, no identity").toBe("UNKNOWN");
    expect(live.because).toMatch(/same id/);
  }, 60_000);

  it("E: an unreadable mutation right is never stolen on elapsed time", () => {
    const mutationPath = `${paths.lock}.mutate`;
    writeFileSync(mutationPath, "{ not json", "utf8");
    const before = readFileSync(mutationPath, "utf8");

    const deadPid = 2_147_483_647;
    writeFileSync(
      paths.lock,
      JSON.stringify({
        pid: deadPid,
        startedAt: new Date(Date.now() - PAST_EVICTION_MS).toISOString(),
        nonce: "dead-holder",
        owner: { pid: deadPid, startedAt: "whenever" },
      }),
      "utf8",
    );

    const outcome = acquireLock(
      paths,
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        nonce: "contender-b",
        owner: me() ?? undefined,
      },
      STALE_MS,
    );

    expect(outcome.acquired).toBe(false);
    expect(outcome.acquired === false && outcome.reason).toMatch(/mutation right/);
    expect(readFileSync(mutationPath, "utf8"), "no shared-state write").toBe(before);
  }, 60_000);

  it("F: an unrelated process is never disturbed by any of this", () => {
    // The negative control for the prohibition on broad kills. It is spawned, it is uninvolved, and
    // it is still alive after a full refuse-then-acquire sequence.
    const bystander = spawnIdleChild();
    expect(waitFor(() => "startedAt" in processStart(bystander.pid!))).toBe(true);

    const a = spawnIdleChild();
    expect(waitFor(() => "startedAt" in processStart(a.pid!))).toBe(true);
    const silentSince = new Date(Date.now() - PAST_EVICTION_MS).toISOString();
    writeFileSync(
      paths.lock,
      JSON.stringify(recordFor(a.pid!, silentSince, silentSince), null, 2),
      "utf8",
    );
    const mine: LockRecord = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      nonce: "contender-b",
      owner: me() ?? undefined,
    };
    expect(acquireLock(paths, mine, STALE_MS).acquired).toBe(false);
    a.kill();
    expect(waitFor(() => "gone" in processStart(a.pid!))).toBe(true);
    expect(acquireLock(paths, mine, STALE_MS).acquired).toBe(true);

    expect("startedAt" in processStart(bystander.pid!), "the bystander must be untouched").toBe(
      true,
    );
  }, 60_000);

  it("G: ordinary acquire, heartbeat and release still work end to end", () => {
    const mine: LockRecord = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      nonce: "ordinary",
      owner: me() ?? undefined,
    };
    expect(acquireLock(paths, mine, STALE_MS).acquired).toBe(true);

    const later = new Date(Date.now() + 10).toISOString();
    expect(heartbeat(paths, mine, later)).toBe(true);
    expect(readLock(paths)?.startedAt).toBe(later);

    releaseLock(paths, mine);
    expect(existsSync(paths.lock)).toBe(false);
  }, 60_000);

  it("treats an unusable probe as UNKNOWN, which blocks rather than permits", () => {
    // The fail-closed direction, stated as a control because it is the one an optimisation would
    // quietly reverse: a probe that cannot answer must never read as a vacancy.
    const cannotSay: StartProbe = () => ({ unknown: "the probe is unavailable here" });
    const deadPid = 2_147_483_647;
    writeFileSync(
      paths.lock,
      JSON.stringify({
        pid: deadPid,
        startedAt: new Date(Date.now() - PAST_EVICTION_MS).toISOString(),
        nonce: "unjudgeable",
        owner: { pid: deadPid, startedAt: "whenever" },
      }),
      "utf8",
    );
    const outcome = acquireLock(
      paths,
      { pid: process.pid, startedAt: new Date().toISOString(), nonce: "b" },
      STALE_MS,
      cannotSay,
    );
    expect(outcome.acquired).toBe(false);
    expect(outcome.acquired === false && outcome.reason).toMatch(/cannot prove the holder is gone/);
  }, 60_000);
});
