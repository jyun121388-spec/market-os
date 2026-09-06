/**
 * WHO owns the lock — as a process identity that can be proved, not as a lease that can expire.
 *
 * IR-075. `acquireLock` refused a holder only when `processAlive(pid) && !lockIsStale(...)`, so a
 * watcher that was **still running** became replaceable the moment its heartbeat aged past three
 * intervals. A suspended laptop is the ordinary way to reach that: A stops writing heartbeats
 * inside its critical section, B takes the lock, A wakes up and carries on. Both then believe they
 * own the channel. `withMutation` had the same shape one layer down, where an expired right was
 * removed and re-created without asking whether its holder was alive.
 *
 * The mistake in one line: **a lease timeout was being used as ownership proof.** Time says
 * something about health. It says nothing about ownership.
 *
 * ## What identity is actually available here, measured before it was designed against
 *
 * The task asked for a measurement rather than a claim, so, on this machine (win32) and for the
 * CI runner (ubuntu-latest):
 *
 *     win32   Get-Process -Id <pid> .StartTime     ~450ms   2026-09-03T06:11:25.1687167Z
 *     win32   Get-CimInstance Win32_Process        ~720ms   distinguishes ABSENT cleanly
 *     win32   wmic process ... get CreationDate    ~510ms   works, deprecated, not used
 *     linux   /proc/<pid>/stat field 22            no spawn, no dependency
 *     any     Date.now() - process.uptime()*1000     ~1ms   REJECTED: off by ~40ms from the OS
 *                                                           value, so the two are not comparable
 *
 * The last row is the reason both sides of every comparison are read from the SAME source. A
 * self-reported start time that disagrees with the OS by tens of milliseconds would make every
 * identity comparison fail, and the failure would look exactly like pid reuse.
 *
 * No new dependency. No native mutex, no advisory-locking package, nothing metered.
 *
 * ## Fail closed
 *
 * Three answers, and only one of them permits a takeover:
 *
 *     ALIVE    the pid is running AND its start time matches the record   -> never replaceable
 *     GONE     the pid is absent, or a DIFFERENT process now holds it     -> replaceable
 *     UNKNOWN  the platform could not say, or the record predates this    -> never replaceable
 *
 * `UNKNOWN` blocking takeover is the deliberate safety-over-availability trade the IR-075 task
 * names. The residual it leaves is stated in `store.ts` where it is felt: a wedged-but-live watcher
 * holds the channel until a person intervenes. That is the direction to fail in — the alternative
 * is two watchers writing one cursor, which loses decisions silently.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * How far a live process's start time must POSTDATE a legacy record's last heartbeat before the
 * process is judged a different one.
 *
 * IR-128. A record written before IR-075 carries no `owner`, so `ownerLiveness` answered UNKNOWN
 * for it unconditionally — and UNKNOWN never permits a takeover. That is right while the question
 * is open, and on 2026-09-06 it stopped being open in a way nobody had considered: a watcher lock
 * abandoned on 2026-08-25 was still on disk when the OS handed pid 12396 to an unrelated process
 * twelve days later. Every canonical write then refused, permanently, because a pid that had been
 * absent all morning became present. Nothing had changed about the dead watcher.
 *
 * The record already holds the evidence. `startedAt` is rewritten by every heartbeat, so it is a
 * moment at which the owner was DEMONSTRABLY RUNNING. A process cannot heartbeat before it exists,
 * so a live process whose OS start time is later than that heartbeat cannot be the one that wrote
 * it. That is a proof, not a lease, and it is the only reasoning here that turns UNKNOWN into GONE.
 *
 * The margin is enormous on purpose, and it is the unsafe direction that sets it. To conclude GONE
 * wrongly, the wall clock would have to have stepped BACKWARDS by more than this between the
 * owner starting and its last heartbeat — then its own heartbeat would predate its own start. NTP
 * corrections are sub-second; a VM resume or a manual change can be larger. A day is beyond any of
 * them, still resolves the case this was found by (twelve days) and every stale-lock-across-a-
 * reboot case, and leaves a same-day pid reuse UNKNOWN — which is a person's question, as it was
 * before.
 */
export const LEGACY_OWNER_PROOF_MARGIN_MS = 24 * 60 * 60 * 1000;

/** A process, and the moment the OS says it started. The pair is the identity; the pid is not. */
export interface OwnerIdentity {
  pid: number;
  /** OS-reported start, compared as an opaque string. Never derived from our own clock. */
  startedAt: string;
}

export type ProcessStart = { startedAt: string } | { gone: true } | { unknown: string };

/** What a liveness question can answer. `UNKNOWN` is a refusal, not a maybe. */
export type OwnerLiveness =
  | { state: "ALIVE"; because: string }
  | { state: "GONE"; because: string }
  | { state: "UNKNOWN"; because: string };

/** Injectable so controls can be deterministic; the default is the real OS probe. */
export type StartProbe = (pid: number) => ProcessStart;

/**
 * The OS's answer for one pid.
 *
 * Absent is a POSITIVE answer — the process is gone — and it is the only thing that unlocks a
 * takeover. Everything the probe cannot establish comes back `unknown`, including an unsupported
 * platform, because "the tool failed" and "the process is dead" must never be the same value.
 */
/**
 * One line of `/proc/<pid>/stat`, judged. Exported because it is where the platform's surprises are.
 *
 * The comm field can contain spaces AND parentheses, so parsing starts after the LAST ')'. After
 * that, field 3 overall (index 0 here) is the process STATE and field 22 (index 19) is the start
 * time in clock ticks since boot.
 *
 * **A ZOMBIE IS GONE, and this cost a red CI run to learn.** Controls B and F passed on Windows and
 * failed on ubuntu: after `child.kill()` the child becomes a zombie until its parent reaps it, and
 * `/proc/<pid>/stat` still exists for a zombie. The test's synchronous wait blocked Node's event
 * loop, so SIGCHLD was never processed, the child was never reaped, and the pid never disappeared.
 * Windows has no zombie state, so nothing local could show it.
 *
 * Reporting `gone` here is not a workaround for that test. A zombie holds no lock, polls no issue
 * and writes no cursor — it is a dead process whose exit status has not been collected. Treating it
 * as a live owner would wedge the channel behind a corpse, which is exactly the availability
 * failure the UNKNOWN rule was carefully scoped to avoid.
 */
export function parseProcStat(raw: string, pid: number): ProcessStart {
  const after = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
  const state = after[0];
  if (state === "Z" || state === "X" || state === "x") {
    return { gone: true };
  }
  const ticks = after[19];
  if (!ticks || !/^\d+$/.test(ticks)) return { unknown: `/proc/${pid}/stat had no start time` };
  return { startedAt: ticks };
}

export function processStart(pid: number): ProcessStart {
  if (!Number.isInteger(pid) || pid <= 0) return { unknown: `pid ${pid} is not a process id` };

  if (process.platform === "linux") {
    let raw: string;
    try {
      raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { gone: true };
      return { unknown: `cannot read /proc/${pid}/stat (${code ?? "unknown error"})` };
    }
    return parseProcStat(raw, pid);
  }

  const command =
    process.platform === "win32"
      ? {
          file: "powershell",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
              `if ($null -eq $p) { "GONE" } else { $p.StartTime.ToUniversalTime().ToString("o") }`,
          ],
        }
      : { file: "ps", args: ["-o", "lstart=", "-p", String(pid)] };

  let out: string;
  try {
    out = execFileSync(command.file, command.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // `ps` exits non-zero for an unknown pid; on Windows the branch above already prints GONE, so
    // a throw there means the probe itself failed and must not be read as a death.
    if (process.platform !== "win32") return { gone: true };
    return { unknown: `the start-time probe for pid ${pid} could not be run` };
  }

  if (!out || out === "GONE") return process.platform === "win32" ? { gone: true } : { gone: true };
  return { startedAt: out };
}

/** This process's identity, read from the SAME source used to judge everyone else's. */
export function selfIdentity(probe: StartProbe = processStart): OwnerIdentity | null {
  const start = probe(process.pid);
  return "startedAt" in start ? { pid: process.pid, startedAt: start.startedAt } : null;
}

/**
 * Does the recorded holder still hold the machine it claimed?
 *
 * Takes the whole record, not just `owner`, and the reason came out of running this against the
 * live bus. The first version asked only about `owner`, so a record written before IR-075 — no
 * identity field at all — answered `UNKNOWN` and blocked, even when its pid had been absent for
 * nine days. That wedged the real control bus on the first outbound post after the repair.
 *
 * An ABSENT pid is positive proof of abandonment on its own: a recycled id cannot make a missing
 * process present, so there is nothing a start time would add. The start time earns its keep only
 * when the pid IS present, where it separates "our process" from "someone else's, same number".
 *
 * So the unjudgeable case is narrower than it first looked, and it is the one that genuinely cannot
 * be decided: a LIVE pid with no recorded identity. There, "some process has this pid" is not
 * ownership — it is the reuse hazard the nonce was already written to avoid — and it blocks.
 */
export function ownerLiveness(
  record: { pid: number; startedAt?: string; owner?: OwnerIdentity } | undefined,
  probe: StartProbe = processStart,
): OwnerLiveness {
  if (!record) return { state: "UNKNOWN", because: "there is no record to judge" };
  const pid = record.owner?.pid ?? record.pid;
  const start = probe(pid);

  if ("gone" in start) return { state: "GONE", because: `pid ${pid} is no longer running` };
  if ("unknown" in start) return { state: "UNKNOWN", because: start.unknown };

  if (!record.owner) {
    // A legacy record still carries ONE piece of ownership evidence: the moment its owner was last
    // demonstrably running. See `LEGACY_OWNER_PROOF_MARGIN_MS`.
    const lastAlive = record.startedAt === undefined ? NaN : Date.parse(record.startedAt);
    const nowRunningSince = Date.parse(start.startedAt);
    if (
      !Number.isNaN(lastAlive) &&
      !Number.isNaN(nowRunningSince) &&
      nowRunningSince - lastAlive > LEGACY_OWNER_PROOF_MARGIN_MS
    ) {
      return {
        state: "GONE",
        because:
          `pid ${pid} is running but only since ${start.startedAt}, long after this record was ` +
          `last refreshed at ${record.startedAt} — a process cannot have written a heartbeat ` +
          "before it existed, so the id was reused and the owner is gone",
      };
    }
    return {
      state: "UNKNOWN",
      because:
        `pid ${pid} is running, but the record carries no process identity — this may be the ` +
        "original owner or an unrelated process that was given the same id",
    };
  }
  if (start.startedAt !== record.owner.startedAt) {
    return {
      state: "GONE",
      because:
        `pid ${pid} is running but started at ${start.startedAt}, not ${record.owner.startedAt} — ` +
        "the id was reused and this is a different process",
    };
  }
  return { state: "ALIVE", because: `pid ${pid} is the same process that took the lock` };
}
