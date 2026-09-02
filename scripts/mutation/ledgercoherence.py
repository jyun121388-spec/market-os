"""M-LEDGER: can the engineering ledger go back to contradicting the protocol?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes.

IR-122. A commit of mine recorded that `CHATGPT_VERIFIED` is a kind `ProtocolKind` does not know,
that the durable inbox drops it, and that ESC-014 was still unanswered. Every clause was false
against the tree it was committed to: ESC-014 was answered (issue #2 comment `5498489070`, Option B)
and applied at `4aca09ce`, which is the reason `ADVISORY_INBOUND_KINDS` exists at all. The sentence
was copied out of the operating rules rather than checked against the code, and it read exactly like
evidence.

Two of these mutants restore the stale claims. Two attack the GUARD, because a coherence check that
can quietly stop looking is worth nothing -- the same "a control that can skip itself is vacuous"
problem this branch has hit before, and the reason the guard carries a canary for its detector and
a separate control for its input.

Expected cardinalities, written before the run:

  M-LEDGER-STALE-DROPPED     put back "`ProtocolKind` does not know, so the durable inbox drops it"
                             -> 1 red: the dropped-today control. The canary stays GREEN because it
                                feeds the detector its own text, which is what makes it a canary.

  M-LEDGER-STALE-UNASKED     put back "ESC-014 ... still unanswered"
                             -> 1 red: the unasked control. Note this is the claim the code itself
                                refutes: advisory kinds exist BECAUSE ESC-014 was decided.

  M-LEDGER-HISTORY-EXEMPTS-ALL   widen the historical exemption until every sentence is history
                             -> 1 red: the CANARY, which asserts the detector still catches the two
                                claims it was written for. Both document scans go green under this
                                mutant, which is precisely why the canary has to exist.

  M-LEDGER-NO-DOCS           scan no documents at all
                             -> 1 red: the reads-its-input control. Both scans go green here too,
                                and the canary cannot see it -- the detector is fine, it is being
                                handed nothing. Two different ways to skip, so two controls.

    python scripts/mutation/ledgercoherence.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

LEDGER = "docs/REVIEW_DEBT.md"
TEST = "tests/ledgerProtocolCoherence.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-LEDGER-STALE-DROPPED the ledger says a recognised kind is dropped today",
        LEDGER,
        "**The kind.** `CHATGPT_VERIFIED` is durably ingested",
        "**The kind.** `CHATGPT_VERIFIED` is one of the inbound kinds `ProtocolKind` does not know, "
        "so the durable inbox drops it. It is durably ingested",
    ),
    (
        "M-LEDGER-STALE-UNASKED the ledger says ESC-014 was never answered",
        LEDGER,
        "That is ESC-014's answer, and the answer is in the tree.",
        "That is ESC-014's answer, and the answer is in the tree. ESC-014 is still unanswered.",
    ),
    (
        "M-LEDGER-HISTORY-EXEMPTS-ALL every sentence counts as history, so nothing is checked",
        TEST,
        "  /\\b(was dropped|were dropped|used to|before ESC-014|pre-ESC-014|until ESC-014|then in force said|previously said|formerly said|at the time of this measurement)\\b/i;",
        "  /(?:)/i;",
    ),
    (
        "M-LEDGER-NO-DOCS the guard scans no documents",
        TEST,
        'const DOCS = ["docs/REVIEW_DEBT.md", "CLAUDE.md"];',
        "const DOCS: string[] = [];",
    ),
]

sys.exit(harness([LEDGER, TEST], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1800))
