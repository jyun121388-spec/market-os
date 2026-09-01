"""M-KIND: can widened ingestion be talked into widening AUTHORITY with it?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and one anchor is a regex.

`[CHATGPT_DECISION][ESC-014]` chose Option B: durably ingest the nine measured inbound kinds, leave
application authority at `CHATGPT_DECISION` alone. The decision is explicit that
`INGESTED != AUTHORITATIVE != APPLIED` must be STRUCTURAL rather than prose, so every mutant below
attacks the structure — either by promoting a kind or by discarding the identity that separates
them. Each errs towards making something startable, because that is the direction that costs.

The nine-kinds control and the parse control must stay GREEN under the promotion mutants: a mutant
that broke ingestion as well would prove only that breaking things breaks things.

Expected cardinalities, written before the run:

  M-KIND-VERIFIED-AUTHORITATIVE  add CHATGPT_VERIFIED to the authority list
                                 -> PREDICTED 3, MEASURED 6. The three foreseen plus the advisory
                                    dedup, ingestion and redelivery controls, which all change
                                    shape once a second kind starts taking the authority path.
                                    Corrected to what was measured. 48 review comments were
                                    on the channel when the decision was taken; this is the mutant
                                    that would turn every one of them into work.

  M-KIND-NO-AUTHORITY-FILTER     schedule on status alone, ignoring the kind on the row
                                 -> 2 red: the one-startable control and the VERIFIED control. The
                                    classifier is untouched, so this is the "identity discarded
                                    before scheduling" case rather than the "kind promoted" one.

  M-KIND-ANY-CHATGPT             every CHATGPT_* kind is authority-bearing, known or not
                                 -> PREDICTED 4, MEASURED 6, for the same reason as the first
                                    mutant: promoting a kind moves it onto the deduplicated path.
                                    Prefix presence is not authority, and the decision says so.

  M-KIND-DROP-ADVISORY           recognise advisory kinds and do not make them durable
                                 -> 4 red: ingests-all-nine, no-advisory-dedup, redelivery and the
                                    VERIFIED control. This is the pre-ESC-014 behaviour, and the
                                    controls should reject going back to it as firmly as they
                                    reject going too far forward.

  M-KIND-SILENT-UNKNOWN          drop an unrecognised tag without reporting it
                                 -> 1 red: the unknown-kind control. Failing closed is required;
                                    failing closed INVISIBLY is what the decision forbids, because
                                    a protocol that has not caught up should be legible.

    python scripts/mutation/esc014kinds.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

TRANSPORT = "src/server/escalation/transport.ts"
STATE = "src/server/controlbus/state.ts"
TEST = "tests/esc014InboundKinds.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-KIND-VERIFIED-AUTHORITATIVE a review comment counts as a decision",
        TRANSPORT,
        'export const AUTHORITATIVE_KINDS = ["CHATGPT_DECISION"] as const;',
        'export const AUTHORITATIVE_KINDS = ["CHATGPT_DECISION", "CHATGPT_VERIFIED"] as const;',
    ),
    (
        "M-KIND-NO-AUTHORITY-FILTER the kind on the row is ignored when scheduling",
        STATE,
        "    (entry) => entry.status === \"RECEIVED_UNVALIDATED\" && isAuthorityBearing(entryKind(entry)),",
        '    (entry) => entry.status === "RECEIVED_UNVALIDATED",',
    ),
    (
        "M-KIND-ANY-CHATGPT the prefix is treated as authority",
        TRANSPORT,
        "  return (AUTHORITATIVE_KINDS as readonly string[]).includes(kind);",
        '  return kind.startsWith("CHATGPT_");',
    ),
    (
        "M-KIND-DROP-ADVISORY recognised advisory traffic is not made durable",
        STATE,
        "    if (!isAuthorityBearing(message.kind)) {\n      seenComments.add(comment.id);\n      admitted.push({",
        "    if (!isAuthorityBearing(message.kind)) {\n      seenComments.add(comment.id);\n      continue;\n      admitted.push({",
    ),
    (
        "M-KIND-SILENT-UNKNOWN an unrecognised tag disappears instead of being reported",
        STATE,
        "      const unsupported = /^\\[([A-Z][A-Z_]*)\\]/.exec(comment.body.trimStart());",
        "      const unsupported = null;",
    ),
]

sys.exit(harness([TRANSPORT, STATE], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=1200))
