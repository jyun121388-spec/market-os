"""M-OUT: can the outbound committer be talked into recording a proof it does not have?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes. That is not a formality here:
the previous unit's scan regex was written through a heredoc, `\\b` collapsed to a backspace, and a
control failed for a reason that had nothing to do with the code under test.

`outbound.ts` is the producer IR-115 said did not exist. Its single property is that A SUCCESSFUL
POST IS NOT EVIDENCE -- only a read-back matching the composed body, on the right issue, in the
right repository, with a real comment id, may write a proof. Every mutant below is a plausible
simplification, and every one of them errs towards CLAIMING transmission.

Expected cardinalities, written before the run:

  M-OUT-NO-SCREEN            publish without screening the body
                             -> 2 red: the refuses-a-rejected-body control and the names-the-finding
                                control. CLAUDE.md says everything outbound passes the screen first
                                and issue #2 is publicly readable; the guarantee used to live in the
                                CLI, which made it a property of one caller rather than of the
                                operation. The clean-body control must stay GREEN under it.

  M-OUT-POST-IS-PROOF        skip the read-back and trust the posted id
                             -> PREDICTED 2, MEASURED 3. The no-read-back control and the mismatch
                                control were foreseen. The third is the happy path, which asserts
                                the EXACT call counts {find:1, post:1, readBack:1} -- with the
                                read-back skipped that becomes readBack:0. Counting the calls turned
                                out to catch more than checking the outcome, which is the argument
                                for asserting them at all. This is the exact invariant CLAUDE.md
                                names: REMOTE_POST_NOT_CONFIRMED => CHATGPT_NOT_YET_NOTIFIED.

  M-OUT-NO-DIGEST-BINDING    stop comparing the body read back with the body composed
                             -> 1 red: the mismatch control, via its edited-body case. A comment id
                                can be attached to the wrong payload, which is why the id alone was
                                rejected as evidence in the first place.

  M-OUT-NO-STATE-WRITE       append the log and never update the authority
                             -> 5 red: happy path, no-read-back, adoption, idempotency and the
                                stale-lock control all read the persisted state. This is the
                                two-independently-mutable-records split arriving from the other
                                side -- a log nobody reads is exactly what IR-115 was.

  M-OUT-NO-LOG-WRITE         update the authority and never append the log
                             -> 1 red: the happy path, which is the only control that reads the
                                log. Narrow on purpose: the log is advisory, and a mutant that
                                proves it is still written earns its place precisely because
                                nothing else would notice.

  M-OUT-NO-ADOPTION          never look for an existing comment; always post
                             -> PREDICTED 1, MEASURED 2, for the same reason: the happy path's call
                                counts see find:0. Without adoption the only crash-safe choices
                                after a POST that never committed are a duplicate comment or a lost
                                proof.

  M-OUT-NO-IDEMPOTENCY       drop the already-proven short circuit
                             -> 1 red: the idempotency control, which then posts a second time and
                                records a second entry for one protocol id.

  M-OUT-IGNORE-LOCK          skip the PRE-FLIGHT lock check
                             -> 2 red: the lock control and the writes-nothing control. Both
                                self-skip if `pid + 1` happens not to be a live process, so a zero
                                here is a skipped control rather than a passing one -- if it comes
                                back MISSED, check that before believing it.

The last three are the SERIALISATION gate, added after review found that the pre-flight check was
the only one: a snapshot taken before a network round trip, with the captured state written back
after it. Both halves of that -- ownership at commit time, and reloading rather than overwriting --
get their own mutant, and the ownership ones live in `store.ts` because the primitive is exposed
there rather than duplicated.

  M-AUTH-NO-RECHECK          never re-check ownership once the write right is taken
                             -> PREDICTED 2, MEASURED 0 on the first run, then 1 after a control was
                                added for it. The prediction was wrong about WHICH check was doing
                                the work: the pre-flight inside the authority runs AFTER the
                                caller's round trip, so it already refuses everything the
                                interleaving fixtures can arrange. The window this branch guards is
                                between that read and winning the mutation right -- microseconds,
                                no await, unopenable from outside. An unreachable safety branch with
                                a green suite over it is the shape this project keeps paying for, so
                                the store grew a seam that fires exactly there, rather than the
                                branch being deleted or left unproven.

  M-AUTH-PID-ONLY            a different lease with the same pid counts as us
                             -> 1 red: the same-pid-different-lease control. `acquireLock` already
                                treats the nonce as the sufficient identity; pids are recycled.

  M-OUT-NO-RELOAD            write back the snapshot captured before the await
                             -> 1 red: the never-regresses control, which advances the cursor and
                                stores an inbound decision while the post is in flight. This is the
                                worse half of the finding: it silently undoes durable work and
                                leaves a green suite behind.

    python scripts/mutation/outbound.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

OUTBOUND = "src/server/controlbus/outbound.ts"
# The write authority lives in the store, exposed rather than duplicated, so the mutants that
# bind ownership live where the primitive does.
STORE = "src/server/controlbus/store.ts"
TEST = "tests/controlBusOutbound.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-OUT-NO-SCREEN the lifecycle publishes without screening",
        OUTBOUND,
        "  const screen = mayPostPublicly(draft.body);\n  if (!screen.allowed) {",
        "  const screen = mayPostPublicly(draft.body);\n  if (false) {",
    ),
    (
        "M-OUT-POST-IS-PROOF a successful POST is treated as a read-back",
        OUTBOUND,
        "    remote = await transport.readBack(posted.commentId);",
        "    remote = {\n"
        "      commentId: posted.commentId,\n"
        "      body: draft.body,\n"
        "      repository: CONTROL_BUS_REPOSITORY,\n"
        "      issueNumber: state.issueNumber,\n"
        "    };",
    ),
    (
        "M-OUT-NO-DIGEST-BINDING the body read back is never compared with the body composed",
        OUTBOUND,
        "  if (bodyDigest(remote.body) !== digest) {\n"
        '    return "the body read back does not match the body composed";\n'
        "  }",
        "",
    ),
    (
        "M-OUT-NO-STATE-WRITE the append-only log is written and the authority is not",
        OUTBOUND,
        "      writeState(paths, fresh);",
        "",
    ),
    (
        "M-OUT-NO-LOG-WRITE the authority is written and the log is not",
        OUTBOUND,
        "      appendOutboxLog(paths, entry);",
        "",
    ),
    (
        "M-OUT-NO-ADOPTION an existing remote comment is never looked for",
        OUTBOUND,
        "  const found = await transport.find(draft.protocolId, digest);",
        "  const found = null;",
    ),
    (
        "M-OUT-NO-IDEMPOTENCY a durable proof does not short-circuit a repeat",
        OUTBOUND,
        '  if (existing) return { status: "ALREADY_PROVEN", entry: existing };',
        "",
    ),
    (
        "M-OUT-IGNORE-LOCK state is written while a live watcher holds the lock",
        OUTBOUND,
        "    !lockIsStale(lock, deps.heartbeatStaleMs, deps.nowMs())\n  ) {",
        "    false\n  ) {",
    ),
    (
        "M-AUTH-NO-RECHECK ownership is never re-checked once the write right is taken",
        STORE,
        "      during !== null &&\n"
        "      !ours(during) &&\n"
        "      processAlive(during.pid) &&\n"
        "      !lockIsStale(during, staleAfterMs, nowMs)\n"
        "    ) {",
        "      false\n    ) {",
    ),
    (
        "M-AUTH-PID-ONLY a different lease with the same pid counts as us",
        STORE,
        "    held === null || (held.pid === claim.pid && held.nonce === claim.nonce);",
        "    held === null || held.pid === claim.pid;",
    ),
    (
        "M-OUT-NO-RELOAD the captured snapshot is written back instead of current state",
        OUTBOUND,
        "      const fresh = loadState(paths, captured.issueNumber);",
        "      const fresh = captured;",
    ),
]

sys.exit(harness([OUTBOUND, STORE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1200))
