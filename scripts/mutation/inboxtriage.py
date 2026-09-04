"""M-TRIAGE: can the inbox triage be talked into clearing a decision it cannot actually judge?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and one anchor is a regex.

The module exists because `CLAUDE.md` states a rule nothing enforced: a decision is not applied on
sight, and a stale one is answered with a refresh request rather than guessed at. Its governing
property is negative -- UNVERIFIABLE must never collapse into CURRENT. An anchor missing from the
local object store may be a branch nobody fetched here, and "I cannot check" reading as "it checks
out" is exactly how a stale decision gets applied.

Every mutant below is a plausible implementation, and each errs in the direction that CLEARS
something. None of them errs towards refusing too much, because that direction costs nothing.

Expected cardinalities, written before the run:

  M-TRIAGE-UNKNOWN-IS-CURRENT   an anchor absent from the object store reads as current
                                -> 1 red: the unresolvable-anchor control.

  M-TRIAGE-DIVERGENT-IS-STALE   an anchor that resolves but is not an ancestor gets a distance
                                -> 1 red: the divergent-line control. `rev-list --count` returns a
                                   number for a divergent commit too, and that number means
                                   something else entirely.

  M-TRIAGE-FIRST-ANCHOR         judge by the first anchor in the prose, not the nearest
                                -> 1 red: the several-anchors control. These packets cite a chain,
                                   so first-in-the-sentence makes staleness depend on wording.

  M-TRIAGE-SHORT-HEX            accept six-character hex runs as commit anchors
                                -> 1 red: the short-hex control. Below seven this matches ordinary
                                   words and every decision arrives carrying imaginary anchors.

  M-TRIAGE-BARE-SLUG            treat any `a/b` as a repository coordinate
                                -> PREDICTED 1, MEASURED 2. The number is corrected here rather
                                   than the prediction reinterpreted.

                                   The predicted red is the path-fragment control: `src/server` and
                                   `docs/ARCHITECTURE.md` are in almost every packet, so this would
                                   route the whole inbox to NOT_THIS_REPOSITORY and look decisive.

                                   The second was not foreseen and is a better catch than the
                                   first. Against `github.com/other-owner/other-repo` the bare
                                   pattern matches `com/other-owner` -- an owner may not contain a
                                   dot, so matching starts after `github.` -- and then it has
                                   consumed past `other-repo`. So the foreign-repository control
                                   fails on its DETAIL: the verdict is still NOT_THIS_REPOSITORY,
                                   and the slug it names is wrong. Asserting the detail rather than
                                   only the verdict is what caught it, and that is the same
                                   consumed-past-the-real-slug bug the prefix-inside-the-pattern
                                   comment in `inbox-triage.ts` records.

The last four are the OPEN-ID half, added after review reproduced the structural gap: the module's
own governing rule names three facts and the first version mechanised two, carrying `protocolId`
from input to output without ever asking whether that id was open. Each control below holds the
BODY AND ANCHORS IDENTICAL and varies only the standing.

  M-TRIAGE-NO-ID-CHECK          the open-id question is never asked
                                -> 3 when first written, 4 NOW MEASURED. The foreign-repository
                                   control stays green, because that anchor verdict is
                                   non-actionable on its own.

  M-TRIAGE-UNKNOWN-IS-OPEN      no canonical record is read as open
                                -> 3 when first written, then 5, now 7 MEASURED. The double-driven controls
                                   are unaffected, which is the point of having both.

  M-TRIAGE-JUDGED-IS-OPEN       a judged id re-enters as open
                                -> 2 when first written, 4 NOW MEASURED. Judged has to BEAT open,
                                   not merely coexist with it.

                                These three rose when the read-back block below was added, because
                                its controls exercise standing too and the older mutants break them
                                as well. The numbers are corrected to what was measured rather than
                                the predictions being reinterpreted; a mutant catching MORE is not
                                a reason to leave a stale figure written down.

  M-TRIAGE-NO-AUTHORITY-OPEN    the fail-closed default admits everything
                                -> 1 red: the no-authority control.

  M-TRIAGE-QUEUED-IS-SENT       a composed escalation counts as a sent one
                                -> 5 red: queued, malformed-id, the binding control, the
                                   no-canonical-issue control and the composed-but-never-confirmed
                                   source line. An outbox row is written locally; a transmission
                                   proof is written only after a read-back, and `CLAUDE.md` says so
                                   in as many words -- REMOTE_POST_NOT_CONFIRMED =>
                                   CHATGPT_NOT_YET_NOTIFIED. The positive read-back control must
                                   stay GREEN under it.

The four M-BIND mutants below live in `state.ts` rather than here, and the reason is the point of
IR-115's repair: the binding is now ONE shared predicate that `health()` and this authority both
call. Mutating the consumer's own copy is not possible any more, because there is no copy. Each
holds everything else constant and bends exactly one clause of the binding.

  M-BIND-NO-REPOSITORY          a proof from another repository is accepted
                                -> 1 red: the binding control, repository case.

  M-BIND-NO-ISSUE               a proof from another issue is accepted
                                -> 1 red: the binding control, issue case.

  M-BIND-NO-DIGEST              a proof is accepted without describing this body
                                -> 1 red: the binding control, digest case. This is the clause that
                                   makes a proof self-checking, and the reason a bare comment id
                                   was rejected as evidence.

  M-BIND-ANY-COMMENT-ID         a malformed comment id counts as a read-back
                                -> 1 red: the malformed-id control.

RETIRED, with reasons rather than deletion:

  M-TRIAGE-ANY-ID-IS-SENT       the local `transmitted()` helper it mutated no longer exists; the
                                four M-BIND mutants cover the same property at the shared predicate
                                and cover more of it.

  M-TRIAGE-SILENT-EMPTY-OUTBOX  the IR-115 disclosure it protected was TRUE and is not any more —
                                `outbound.ts` is now the producer, so an empty outbox means nothing
                                has been transmitted yet rather than that nothing can be. Keeping
                                the mutant would have pinned a sentence that had become false.

    python scripts/mutation/inboxtriage.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

TRIAGE = "scripts/inbox-triage.ts"
# The open-id binding moved into the shared predicate, so the mutants that bind it live here
# too. Mutating the consumer's own copy would have been mutating a copy that no longer exists.
STATE = "src/server/controlbus/state.ts"
TEST = "tests/inboxTriage.test.ts"

BINDING_TESTS = [TEST]
# NOT `tests/stopEvidence.test.ts` any more, and the reason is a real coupling rather than an
# inconvenience: `gatherStopEvidence` now counts through `triageInbox`, so a mutation here
# legitimately breaks it and the harness rightly downgraded four mutants to CAUGHT-BUT-BROAD. A
# suite that depends on the mutated module cannot answer "did this change anything it should not".
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-TRIAGE-UNKNOWN-IS-CURRENT an anchor this repository does not have reads as current",
        TRIAGE,
        '          verdict: "ANCHOR_UNVERIFIABLE",\n'
        "          detail: `${hexRuns.length} commit-shaped run(s), none present in this object store`,",
        '          verdict: "CURRENT",\n'
        "          detail: `${hexRuns.length} commit-shaped run(s), none present in this object store`,",
    ),
    (
        "M-TRIAGE-DIVERGENT-IS-STALE a divergent anchor is given a staleness distance",
        TRIAGE,
        "  if (behind.length === 0) {",
        "  if (false) {",
    ),
    (
        "M-TRIAGE-FIRST-ANCHOR staleness is judged by whichever anchor the prose mentions first",
        TRIAGE,
        "  const nearest = Math.min(...behind.map((a) => a.behindHead!));",
        "  const nearest = behind[0].behindHead!;",
    ),
    (
        "M-TRIAGE-SHORT-HEX six hex characters count as a commit anchor",
        TRIAGE,
        "const SHA_LIKE = /\\b[0-9a-f]{7,40}\\b/g;",
        "const SHA_LIKE = /\\b[0-9a-f]{6,40}\\b/g;",
    ),
    (
        "M-TRIAGE-NO-ID-CHECK the open-id question is never asked",
        TRIAGE,
        '  if (standing !== "OPEN") return "NOT_ACTIONABLE";\n',
        "",
    ),
    (
        "M-TRIAGE-UNKNOWN-IS-OPEN an id with no canonical record is presumed open",
        TRIAGE,
        '      return "STANDING_UNVERIFIABLE";\n    },',
        '      return "OPEN";\n    },',
    ),
    (
        "M-TRIAGE-JUDGED-IS-OPEN a judged id re-enters as open",
        TRIAGE,
        '      if (judged.has(protocolId)) return "ALREADY_JUDGED";\n',
        "",
    ),
    (
        "M-TRIAGE-NO-AUTHORITY-OPEN an unavailable authority is read as open",
        TRIAGE,
        '  source: () => "none — no canonical record of open ids was available",\n'
        '  standing: () => "STANDING_UNVERIFIABLE",',
        '  source: () => "none — no canonical record of open ids was available",\n'
        '  standing: () => "OPEN",',
    ),
    (
        "M-TRIAGE-QUEUED-IS-SENT an escalation that was never read back counts as open",
        TRIAGE,
        "      if (expect !== null && isTransmitted(entry as OutboxEntry, expect))\n        asked.add(entry.protocolId);\n      else queued += 1;",
        "      asked.add(entry.protocolId);",
    ),
    (
        "M-BIND-NO-REPOSITORY a proof from another repository is accepted",
        STATE,
        "  if (proof.repository.toLowerCase() !== expect.repository.toLowerCase()) return false;\n",
        "",
    ),
    (
        "M-BIND-NO-ISSUE a proof from another issue is accepted",
        STATE,
        "  if (proof.issueNumber !== expect.issueNumber) return false;\n",
        "",
    ),
    (
        "M-BIND-NO-DIGEST a proof is accepted without describing this body",
        STATE,
        "  return proof.bodyDigest === digestOf(entry.body);",
        "  return true;",
    ),
    (
        "M-BIND-ANY-COMMENT-ID a malformed comment id counts as a read-back",
        STATE,
        "  if (!Number.isInteger(proof.commentId) || proof.commentId <= 0) return false;\n",
        "",
    ),
    (
        "M-TRIAGE-BARE-SLUG any slash-separated pair counts as a repository",
        TRIAGE,
        "  /(?:github\\.com\\/|\\brepo(?:sitory)?[:\\s]+)([A-Za-z0-9][\\w-]*)\\/([A-Za-z0-9][\\w.-]*)/gi;",
        # Non-capturing, so the owner/repo groups stay at 1 and 2 and the mutant tests the PREFIX
        # requirement rather than accidentally testing group numbering.
        "  /(?:)([A-Za-z0-9][\\w-]*)\\/([A-Za-z0-9][\\w.-]*)/gi;",
    ),
]

sys.exit(harness([TRIAGE, STATE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
