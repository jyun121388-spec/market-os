"""M-OWN: can a lease timeout be talked back into standing for ownership?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

IR-075. `acquireLock` refused a holder only when `processAlive(pid) && !lockIsStale(...)`, so once
the heartbeat aged past three intervals a watcher that was STILL RUNNING became replaceable. The
ordinary way to reach it is a suspended laptop: A stops heartbeating inside its critical section, B
takes the lock, A wakes up, and two processes write one cursor. `withMutation` had the same shape
one layer down, where an expired right was removed and re-created without asking whether its holder
was alive; and an unreadable record became "abandoned" purely because time had passed.

The repair binds ownership to OS-reported process identity -- pid AND start time, read from the
same source on both sides -- and lets only a PROVEN-GONE owner be replaced. `UNKNOWN` blocks.

Expected cardinalities, written before the run:

  M-OWN-LEASE-EVICTS-LIVE    restore `alive && !stale` as the only refusal
                             -> 4 red: ownerLease A (live owner, lapsed heartbeat), ownerLease F
                                (which performs the same refuse-then-acquire sequence around its
                                bystander), and in controlBus both the lapsed-heartbeat control and
                                the unjudgeable-identity control, whose legacy record names a live
                                pid with an ancient timestamp.

                                NOT the "refuses a second watcher while the first is running"
                                control: there the heartbeat is current, so the old condition and
                                the new one agree. A control that cannot distinguish the two is not
                                evidence about either.

  M-OWN-RIGHT-TIME-STEAL     let an expired mutation right be taken from a LIVE holder
                             -> 1 red: ownerLease C. The unreadable-right control stays green
                                because this mutant removes only the liveness test, not the
                                unreadable guard above it.

  M-OWN-CORRUPT-IS-ABANDONED an unreadable lock becomes takeable once it is old enough
                             -> 1 red: the never-takes-over-an-unreadable-lock control. The
                                written-moments-ago control stays green, which is the point: the
                                mutant restores exactly the old two-branch behaviour, so only the
                                branch that changed can catch it.

  M-OWN-PID-ONLY-IDENTITY    ownership is the pid, ignoring the recorded start time
                             -> 1 red: ownerLease D. Windows recycles pids quickly, so this is the
                                mutant that would look harmless in review and lose a real takeover
                                after a crash-and-restart.

  M-OWN-LEGACY-LIVE-IS-GONE  a LIVE pid with no recorded identity counts as abandoned
                             -> PREDICTED 2, MEASURED 3, then 2 once the defect it exposed was
                                fixed. The two predicted are ownerLease D's legacy half and the
                                controlBus unjudgeable-identity control. The third was ownerLease C,
                                and it should not have been reachable: `withMutation` passed the
                                bare `OwnerIdentity` where a `{ pid, owner }` record was expected,
                                so every live right-holder took the NO-IDENTITY branch and answered
                                UNKNOWN instead of ALIVE. It type-checked -- an `OwnerIdentity` is
                                structurally `{ pid, startedAt }` and excess-property checking does
                                not apply to a variable -- and C stayed green because UNKNOWN blocks
                                too. A dead comparison behind a passing control, found by a mutant
                                aimed at something else. C now asserts ALIVE explicitly.

                                The distinction itself came from running the repair against the real
                                bus: an ABSENT pid is proof of abandonment with or without a start
                                time, while a LIVE one without it cannot be told from an unrelated
                                process that was handed the same number.

                                MEASURED 7 once `controlBusOutbound` joined the binding set, and all
                                five extras are the same shape: every fixture with a live pid and no
                                recorded identity flips from a refusal to a continuation. They are
                                listed rather than summarised because the count alone would look
                                like a broad mutant, and it is not — it is one rule reached from
                                seven directions:
                                  ownership-during-the-await, same-pid-different-lease,
                                  adopt-after-refused-commit, fails-closed-and-writes-nothing,
                                  post-right UNKNOWN, ownerLease D, controlBus unjudgeable.

  M-OWN-DURING-LEASE-RECHECK restore the pre-IR075 conjunction in the POST-RIGHT recheck
                             -> PREDICTED 2, MEASURED 1, then 2 after the control it exposed was
                                strengthened. Only the post-right ALIVE control went red. The
                                UNKNOWN control stayed green because its fixture stamped a CURRENT
                                heartbeat: under the old conjunction a current heartbeat refuses
                                too, so the two rules agreed there and the control could not tell
                                them apart. Its heartbeat is now deliberately lapsed.

                                The same lesson as M-OWN-LEASE-EVICTS-LIVE's green control, learned
                                a second time one layer down: a control that cannot distinguish the
                                rule from its defect is not evidence about either.

                                Found by independent review rather than by this suite:
                                `withCanonicalWriteAuthority` asks about ownership twice, and only
                                the pre-flight had been migrated. One function, two definitions of
                                ownership, decided by which side of the mutex you were on.

    python scripts/mutation/ownerlease.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

STORE = "src/server/controlbus/store.ts"
OWNER = "src/server/controlbus/owner.ts"

BINDING_TESTS = [
    "tests/ownerLease.test.ts",
    "tests/controlBus.test.ts",
    "tests/controlBusOutbound.test.ts",
]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-OWN-LEASE-EVICTS-LIVE a lapsed heartbeat evicts a living owner again",
        STORE,
        "  const liveness = ownerLiveness(held, probe);\n  if (liveness.state !== \"GONE\") {",
        "  const liveness = ownerLiveness(held, probe);\n"
        "  if (processAlive(held.pid) && !lockIsStale(held, staleAfterMs, nowMs)) {",
    ),
    (
        "M-OWN-RIGHT-TIME-STEAL an expired mutation right is taken from a live holder",
        STORE,
        """    if (ownerLiveness({ pid: rightOwner.pid, owner: rightOwner }, probe).state !== "GONE") {
      return null;
    }""",
        "    void probe;",
    ),
    (
        "M-OWN-CORRUPT-IS-ABANDONED an unreadable lock is abandoned once it is old enough",
        STORE,
        """  if (!held) {
    return {
      acquired: false,
      heldBy: record,
      reason: lockWrittenRecently(paths.lock, nowMs)
        ? "the lock file was created moments ago and is still being written"
        : `the lock at ${paths.lock} cannot be read, so its owner cannot be proved gone; ` +
          "remove it by hand once you have confirmed no watcher is running",
    };
  }""",
        """  if (!held && lockWrittenRecently(paths.lock, nowMs)) {
    return {
      acquired: false,
      heldBy: record,
      reason: "the lock file was created moments ago and is still being written",
    };
  }
  if (!held) {
    return (
      withMutation(paths, record, staleAfterMs, nowMs, probe, (): LockOutcome => {
        removeIfPresent(paths.lock);
        if (createExclusive(paths.lock, serialised)) return { acquired: true, record };
        return { acquired: false, heldBy: record, reason: "the lock reappeared" };
      }) ?? {
        acquired: false,
        heldBy: record,
        reason: "another watcher holds the mutation right",
      }
    );
  }""",
    ),
    (
        "M-OWN-PID-ONLY-IDENTITY the recorded start time is ignored, so a pid is an identity",
        OWNER,
        "  if (start.startedAt !== record.owner.startedAt) {",
        "  if (false) {",
    ),
    (
        "M-OWN-DURING-LEASE-RECHECK the post-right recheck goes back to the lease conjunction",
        STORE,
        """    const foreign = during !== null && !ours(during) ? ownerLiveness(during, probe) : null;
    if (during !== null && foreign && foreign.state !== "GONE") {""",
        """    const foreign = during !== null && !ours(during) ? ownerLiveness(during, probe) : null;
    void foreign;
    if (
      during !== null &&
      !ours(during) &&
      processAlive(during.pid) &&
      !lockIsStale(during, staleAfterMs, nowMs)
    ) {""",
    ),
    (
        "M-OWN-LEGACY-LIVE-IS-GONE a live pid with no recorded identity counts as abandoned",
        OWNER,
        """  if (!record.owner) {
    return {
      state: "UNKNOWN",""",
        """  if (!record.owner) {
    return {
      state: "GONE",""",
    ),
]

sys.exit(harness([STORE, OWNER], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=3600))
