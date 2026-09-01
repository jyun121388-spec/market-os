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
                                -> 3 when first written, 5 NOW MEASURED. The double-driven controls
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
                                -> 3 red: the queued control, the malformed-id control, and the
                                   composed-but-never-confirmed source line. An outbox row is
                                   written locally; `transmittedCommentId` is set only after a
                                   read-back, never on a successful POST, and `CLAUDE.md` says so
                                   in as many words -- REMOTE_POST_NOT_CONFIRMED =>
                                   CHATGPT_NOT_YET_NOTIFIED. The positive read-back control must
                                   stay GREEN under it.

  M-TRIAGE-ANY-ID-IS-SENT       any truthy transmission field counts as a read-back
                                -> 1 red: the malformed-id control alone, since a real comment id
                                   passes either way. That is the narrowest possible catch and the
                                   reason the malformed shapes are enumerated rather than implied.

  M-TRIAGE-SILENT-EMPTY-OUTBOX  drop the IR-115 disclosure from the reported source
                                -> 1 red: the silence-not-evidence control. An empty outbox is
                                   ambiguous — either nothing was ever posted, or nothing records
                                   what is posted — and on this repository it is the second.

    python scripts/mutation/inboxtriage.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

TRIAGE = "scripts/inbox-triage.ts"
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
        "      if (transmitted(entry)) asked.add(entry.protocolId);\n      else queued += 1;",
        "      asked.add(entry.protocolId);",
    ),
    (
        "M-TRIAGE-ANY-ID-IS-SENT any truthy transmission field counts as a read-back",
        TRIAGE,
        "  return typeof id === \"number\" && Number.isInteger(id) && id > 0;",
        "  return Boolean(id);",
    ),
    (
        "M-TRIAGE-SILENT-EMPTY-OUTBOX an empty outbox is reported without its disclosure",
        TRIAGE,
        '      (asked.size + queued === 0\n'
        '        ? " — and no production code writes that record (IR-115), so an empty outbox '
        'is silence rather than evidence"\n'
        '        : ""),',
        '      "",',
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

sys.exit(harness([TRIAGE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
