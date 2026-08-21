/**
 * What the review chain actually left open, read from the review record instead of asserted.
 *
 * `scripts/rc-preflight.ts` opens by saying it "gathers evidence rather than assuming it", and
 * three of the numbers it passed in were literals: `openP0: 0`, `openP1: 0`,
 * `unhandledReviewFindings: 0`. Those are the three the release verdict turns on. A constant zero
 * cannot ever become one, so the check could not fail — a gate that is structurally incapable of
 * reporting the thing it exists to report, sitting in the same file as `openP2`, which was derived
 * properly from the debt register the whole time.
 *
 * `reviews/market-os-final-review.json` is machine-readable and already carries a `severity` and a
 * `status` on every finding of every gate, so no prose has to be parsed to answer this. That
 * matters: the sibling counter in `./pendingEscalations` was wrong for eleven days precisely
 * because it read meaning out of how a heading was worded, and the findings document is prose of
 * exactly that kind. The register is the record; the narrative is commentary on it.
 *
 * Three dispositions, because two would force a false choice:
 *
 *  - `RESOLVED` — a code change landed, or the claim did not reproduce.
 *  - `ACCEPTED_AND_RECORDED` — deliberately left open, with a stated reason and a pinning test.
 *    Real residual risk, and not a loose end. The name-collision tail is the standing example.
 *  - `UNHANDLED` — nobody decided anything. This is the only kind that should block a release.
 *
 * Collapsing the middle one into "closed" hides nine real items behind a zero; collapsing it into
 * "open" reports nine blockers that the authorised stop rule explicitly does not treat as blocking.
 * So it is counted, named, and reported in its own field.
 *
 * A status or severity this module has not been taught fails the whole summary to `null`. Not to
 * zero, and not to "unhandled" either: a value nobody has classified is a record this cannot read,
 * and `undefined` is what the preflight turns into EVIDENCE_INSUFFICIENT. The alternative — decide
 * from the spelling, guess that `..._FIXED` means fixed — is the same substring reasoning that
 * produced IR-014's substring collision and the queue counter's plausible wrong number.
 */

const SCHEMA = "market-os/review-evidence/1";

/** What has been done about a finding. Closed set; an unlisted status makes the record unreadable. */
export type Disposition = "RESOLVED" | "ACCEPTED_AND_RECORDED" | "UNHANDLED";

/**
 * Every status the register uses, classified one at a time.
 *
 * Written out rather than derived from a pattern. `PARTLY_FIXED_PARTLY_RECORDED_AS_GAP` and
 * `OPEN_COVERAGE_GAP` both end in a word about gaps and land in different buckets; nothing in the
 * spelling separates them, and only reading the entries does.
 */
const STATUS_DISPOSITION: Record<string, Disposition> = {
  // A code change landed.
  REPRODUCED_AND_FIXED: "RESOLVED",
  PARTLY_REPRODUCED_FIXED: "RESOLVED",
  PARTLY_REPRODUCED_PARTLY_REJECTED_FIXED_WHERE_REAL: "RESOLVED",
  FOUND_BY_SELF_ATTACK_AND_FIXED: "RESOLVED",
  FOUND_BY_SELF_ATTACK_FIRST_AND_FIXED: "RESOLVED",
  FOUND_BY_SELF_ATTACK_FIRST_THEN_CONFIRMED: "RESOLVED",
  CORRECTED: "RESOLVED",

  // The claim did not describe the code at the SHA that was reviewed.
  ALREADY_FIXED_BEFORE_THE_CLAIM_WAS_READ: "RESOLVED",
  DID_NOT_REPRODUCE_ALREADY_FIXED: "RESOLVED",

  // Open, on purpose, with the reason and the pinning test recorded beside it.
  REPRODUCED_ACCEPTED_PRE_LAUNCH: "ACCEPTED_AND_RECORDED",
  REPRODUCED_ACCEPTED_AND_PINNED: "ACCEPTED_AND_RECORDED",
  PARTIALLY_VALID_DEFERRED_WITH_PLAN: "ACCEPTED_AND_RECORDED",
  PARTLY_FIXED_PARTLY_RECORDED_AS_GAP: "ACCEPTED_AND_RECORDED",
  PARTLY_CLOSED_TAIL_RECORDED: "ACCEPTED_AND_RECORDED",
  OPEN_COVERAGE_GAP: "ACCEPTED_AND_RECORDED",

  // Filed, and nothing decided. **No entry in the register currently uses any of these**, which
  // is stated rather than left to be discovered: without them `unresolvedP0` would be a field
  // that no input could ever make non-zero, and a zero that cannot become one is the constant
  // this module was written to remove — reproduced in the replacement. With them the zero is a
  // measurement. They are the states a future gate would file into, and a status outside this
  // whole table still nulls the summary, so a new word cannot arrive already counted as handled.
  OPEN_NOT_ADDRESSED: "UNHANDLED",
  REPRODUCED_NOT_FIXED: "UNHANDLED",
  FILED_NOT_TRIAGED: "UNHANDLED",
  DISPUTED_UNRESOLVED: "UNHANDLED",
};

/**
 * Severities, mapped to the buckets the stop rule is written in.
 *
 * `P1_AS_FILED` is what the filer called it, kept as P1 so a downgrade cannot happen by renaming.
 * `DOCUMENTATION` is a correction to the record rather than to the product, and counting it as a
 * code severity would let a fixed sentence look like a fixed defect.
 */
const SEVERITY_BUCKET: Record<string, "P0" | "P1" | "P2" | "P3" | "NON_CODE"> = {
  P0: "P0",
  P1: "P1",
  P1_AS_FILED: "P1",
  P2: "P2",
  P3: "P3",
  DOCUMENTATION: "NON_CODE",
};

export interface ReviewFindingsSummary {
  /** Gate entries read. Zero is a real answer — a record with no gates has no findings. */
  gates: number;
  findings: number;
  /** Severity P0 with no recorded disposition. The release blocker. */
  unresolvedP0: number;
  /** Severity P1 with no recorded disposition. Also a release blocker. */
  unresolvedP1: number;
  /** Any severity with no recorded disposition. */
  unhandled: number;
  /** Deliberately open, reason recorded. Reported, never folded into the zeros above. */
  acceptedDebt: number;
  resolved: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Summarises the review register, or returns `null` when it cannot be read.
 *
 * `null` covers a missing file, a schema this does not know, a gate that is not an object, a
 * finding missing either field, and any severity or status not in the tables above. Every one of
 * those is "I could not tell", and the caller must pass it on as absent rather than as clean.
 */
export function summariseReviewFindings(record: unknown): ReviewFindingsSummary | null {
  if (!isRecord(record)) return null;
  if (record.schema !== SCHEMA) return null;
  const gates = record.gates;
  if (!Array.isArray(gates)) return null;

  const summary: ReviewFindingsSummary = {
    gates: gates.length,
    findings: 0,
    unresolvedP0: 0,
    unresolvedP1: 0,
    unhandled: 0,
    acceptedDebt: 0,
    resolved: 0,
  };

  for (const gate of gates) {
    if (!isRecord(gate)) return null;
    // A gate with no `findings` key is not a gate that found nothing — the closing gate is
    // recorded in the attestation, not here, and every entry in this file exists because it
    // produced fixes. An absent list is a record this cannot read.
    const findings = gate.findings;
    if (!Array.isArray(findings)) return null;

    for (const finding of findings) {
      if (!isRecord(finding)) return null;
      const severity = finding.severity;
      const status = finding.status;
      if (typeof severity !== "string" || typeof status !== "string") return null;

      const bucket = SEVERITY_BUCKET[severity];
      const disposition = STATUS_DISPOSITION[status];
      if (bucket === undefined || disposition === undefined) return null;

      summary.findings += 1;
      if (disposition === "RESOLVED") summary.resolved += 1;
      if (disposition === "ACCEPTED_AND_RECORDED") summary.acceptedDebt += 1;
      if (disposition === "UNHANDLED") {
        summary.unhandled += 1;
        if (bucket === "P0") summary.unresolvedP0 += 1;
        if (bucket === "P1") summary.unresolvedP1 += 1;
      }
    }
  }

  return summary;
}

/**
 * Parses JSON text and summarises it, or `null`.
 *
 * Separate from the function above so the parse failure and the shape failure are the same answer
 * to the caller while staying distinguishable in a test.
 */
export function summariseReviewFindingsJson(text: string): ReviewFindingsSummary | null {
  try {
    return summariseReviewFindings(JSON.parse(text));
  } catch {
    return null;
  }
}
