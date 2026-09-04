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

  ---- IR-125: authority BEFORE the POST ------------------------------------------------------

  The lifecycle used to take the canonical write authority only at commit, after the network.
  A foreign watcher arriving during the POST left a comment with no local record, and the CLI --
  truthfully describing the local store -- printed "nothing written". The order is now
  BEGIN under authority (durable intent) -> find -> POST -> read back -> COMMIT fenced by nonce.

  M-OUT-POST-BEFORE-AUTHORITY  ignore BEGIN's refusal and carry on to the transport
                             -> PREDICTED 5, MEASURED 6: exactly-once A (foreign live lock at
                                start: POST called), the refuses-while-a-live-watcher-holds-the-
                                lock control (same shape), H (a foreign live intent: POST called),
                                J (both attempts proceed: two POSTs), C (no ALREADY_PROVEN
                                short-circuit: the transport is touched) -- and C's older twin,
                                "is idempotent once a proof is durable", which the prediction
                                simply forgot. The ALREADY_PROVEN answer is delivered THROUGH
                                BEGIN's refusal path, so ignoring refusals ignores idempotency.

  M-OUT-NO-INFLIGHT-GUARD     a live foreign intent does not block a second attempt
                             -> 2 red: H and J.

  M-OUT-NO-FENCE              the commit replaces whichever intent is there, not only its own
                             -> 1 red: the superseded-attempt control. Nothing else reaches a
                                commit whose intent has changed hands, which is why that control
                                had to be written.

  M-OUT-AMBIGUOUS-IS-NONE     a transport error after the POST is reported as no side effect
                             -> 1 red: E. "The tool failed" and "nothing was sent" must never be
                                the same value -- the incident was that sentence.

  M-OUT-REFUSED-SAYS-NONE     a refused commit after a read-back is reported as no side effect
                             -> PREDICTED 2, MEASURED 3: I, the ownership-taken-during-the-await
                                control, and the commit-fence control -- which asserts
                                POSTED_UNRECORDED after a superseded commit and was written AFTER
                                this prediction. Recorded as a miss rather than re-predicted.

  M-OUT-INTENT-NOT-DURABLE    BEGIN takes the authority but writes nothing down
                             -> broad by construction, PREDICTED 14, MEASURED 27 of 37. The
                                prediction listed the controls that READ the intent back; it
                                missed that every commit is now fenced on the intent's nonce, so
                                with no intent on disk NO commit can succeed and every positive
                                path in both files goes red as well. Still ISOLATED -- the
                                unrelated file stays green -- and the breadth is the point: the
                                intent is now load-bearing for every successful publication, not
                                only for the crash windows it was written for.

  The pre-IR-125 mutants were re-measured against the widened binding set and grew for the same
  reason: M-OUT-NO-ADOPTION 14 (every crash/ambiguity/race control adopts), M-OUT-NO-RELOAD 21
  (BEGIN and COMMIT both reload; writing the captured snapshot back erases the intent BEGIN just
  wrote, so nearly everything fails), M-AUTH-PID-ONLY 10, M-OUT-NO-STATE-WRITE 11,
  M-OUT-POST-IS-PROOF 9, M-AUTH-NO-RECHECK 3, M-OUT-NO-IDEMPOTENCY 2. Their original predictions
  in the section above were made against one file and are kept as history, not corrected.

  RETIRED, with reasons:

  M-OUT-IGNORE-LOCK           the pre-flight snapshot it mutated no longer exists; ownership is
                              decided at BEGIN under the authority itself. Its property is
                              M-OUT-POST-BEFORE-AUTHORITY.
  M-AUTH-NO-RECHECK (old)     re-anchored on the IR-075 recheck (`foreign.state !== "GONE"`).

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
EXACTLY_ONCE = "tests/outboundExactlyOnce.test.ts"

BINDING_TESTS = [TEST, EXACTLY_ONCE]
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
        "      remote = await transport.readBack(posted.commentId);",
        "      remote = {\n"
        "        commentId: posted.commentId,\n"
        "        body: draft.body,\n"
        "        repository: CONTROL_BUS_REPOSITORY,\n"
        "        issueNumber: state.issueNumber,\n"
        "      };",
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
        "M-OUT-NO-STATE-WRITE the proof is logged and the authority is not written",
        OUTBOUND,
        "      fresh.outbox[at] = proven;\n      writeState(paths, fresh);",
        "      fresh.outbox[at] = proven;",
    ),
    (
        "M-OUT-NO-LOG-WRITE the authority is written and the proof is not logged",
        OUTBOUND,
        "      appendOutboxLog(paths, proven);",
        "",
    ),
    (
        "M-OUT-NO-ADOPTION an existing remote comment is never looked for",
        OUTBOUND,
        "    const found = await transport.find(draft.protocolId, digest);",
        "    const found = null;",
    ),
    (
        "M-OUT-NO-IDEMPOTENCY a durable proof does not short-circuit a repeat",
        OUTBOUND,
        '      if (proven) return { ok: false, reason: "already proven", alreadyProven: proven };',
        "",
    ),
    (
        "M-AUTH-NO-RECHECK ownership is never re-checked once the write right is taken",
        STORE,
        '    if (during !== null && foreign && foreign.state !== "GONE") {',
        "    if (false) {",
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
        "      // RELOAD. `captured` is a photograph of the state before the await; `fresh` is what is\n"
        "      // actually on disk now, cursor and inbox included.\n"
        "      const fresh = loadState(paths, captured.issueNumber);",
        "      const fresh = captured;",
    ),
    (
        "M-OUT-POST-BEFORE-AUTHORITY BEGIN's refusal is ignored and the transport is reached",
        OUTBOUND,
        "  if (!begun.ok) {\n"
        '    if (begun.alreadyProven) return { status: "ALREADY_PROVEN", entry: begun.alreadyProven };',
        "  if (false) {\n"
        '    if (begun.alreadyProven) return { status: "ALREADY_PROVEN", entry: begun.alreadyProven };',
    ),
    (
        "M-OUT-NO-INFLIGHT-GUARD a live foreign intent does not block a second attempt",
        OUTBOUND,
        "      if (inFlight) {",
        "      if (false) {",
    ),
    (
        "M-OUT-NO-FENCE the commit replaces whichever intent is present",
        OUTBOUND,
        "        (e) => sameUnit(e, entry, digest) && e.publication?.attemptNonce === attemptNonce,",
        "        (e) => sameUnit(e, entry, digest) && e.publication !== undefined,",
    ),
    (
        "M-OUT-AMBIGUOUS-IS-NONE a transport error after the POST reports no side effect",
        OUTBOUND,
        '      remoteSideEffect: posted === null && !transportReachedPost(error) ? "NONE" : "UNKNOWN",',
        '      remoteSideEffect: "NONE",',
    ),
    (
        "M-OUT-REFUSED-SAYS-NONE a refused commit after a read-back reports no side effect",
        OUTBOUND,
        '      remoteSideEffect: "POSTED_UNRECORDED",',
        '      remoteSideEffect: "NONE",',
    ),
    (
        "M-OUT-INTENT-NOT-DURABLE BEGIN takes the authority and writes nothing down",
        OUTBOUND,
        "      appendOutboxLog(paths, mine);\n      writeState(paths, fresh);\n      return { ok: true };",
        "      return { ok: true };",
    ),
]

sys.exit(harness([OUTBOUND, STORE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=3600))
