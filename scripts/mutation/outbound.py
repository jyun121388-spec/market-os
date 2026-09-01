"""M-OUT: can the outbound committer be talked into recording a proof it does not have?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes. That is not a formality here:
the previous unit's scan regex was written through a heredoc, `\\b` collapsed to a backspace, and a
control failed for a reason that had nothing to do with the code under test.

`outbound.ts` is the producer IR-115 said did not exist. Its single property is that A SUCCESSFUL
POST IS NOT EVIDENCE -- only a read-back matching the composed body, on the right issue, in the
right repository, with a real comment id, may write a proof. Every mutant below is a plausible
simplification, and every one of them errs towards CLAIMING transmission.

Expected cardinalities, written before the run:

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

  M-OUT-IGNORE-LOCK          write state even while a live watcher holds the lock
                             -> 2 red: the lock control and the writes-nothing control. Both
                                self-skip if `pid + 1` happens not to be a live process, so a zero
                                here is a skipped control rather than a passing one -- if it comes
                                back MISSED, check that before believing it.

    python scripts/mutation/outbound.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

OUTBOUND = "src/server/controlbus/outbound.ts"
TEST = "tests/controlBusOutbound.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
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
        "  writeState(paths, state);",
        "",
    ),
    (
        "M-OUT-NO-LOG-WRITE the authority is written and the log is not",
        OUTBOUND,
        "  appendOutboxLog(paths, entry);",
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
        "    if (!lockIsStale(lock, deps.heartbeatStaleMs, deps.nowMs())) {",
        "    if (false) {",
    ),
]

sys.exit(harness([OUTBOUND], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1200))
