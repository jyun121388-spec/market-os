/**
 * What a premise actually establishes, as structure rather than as prose.
 *
 * The first version of INFERENCE verification took a premise's `claimText`, pulled every numeric
 * token out of it with a regex, and treated that set as the supported figures. A probe matrix
 * (IR-094) showed what that authorises:
 *
 *     premise "growth was -2.1%"              supports  "growth was 2.1%"
 *     premise "The index was 1,400"           supports  "Revenue was $1,400"
 *     premise "growth was 2.1 percent"        supports  "the spread was 2.1 USD"
 *     premise "Apple revenue was 2.1 billion" supports  "Unemployment slowed to 2.1"
 *     premise "observed on 2026-08-14"        supports  "Revenue reached 2026"
 *
 * Every one of those was accepted. The check was never "traces to a premise" — it was "this digit
 * sequence occurs somewhere nearby", which loses the sign, the unit, the subject and the
 * difference between a date and a price.
 *
 * The repair is not a better regex. Growing the token pattern to understand minus signs, currency
 * symbols and unit words would be the same phrase-enumeration failure already measured in the
 * request guardrail, one layer down. **Prose stops being the authority.**
 *
 *     text side        WHAT DID THE OUTPUT SAY?          -> assertions to be checked
 *     structured side  WHAT DOES THE EVIDENCE SUPPORT?   -> atoms derived from the database
 *                      then compare
 *
 * This module is the structured side. Every atom is derived from a premise's own evidence rows —
 * the observation value, the recomputed change — never from the sentence a producer wrote about
 * them. `claimText` is still checked for exact consistency with its structured evidence by
 * `verifyClaim`; that is a different job and it stays where it is.
 *
 * ## Why these kinds and no others
 *
 * They are what the two real producers actually emit. `createFactClaimFromObservation` writes one
 * observation value; `computeSeriesChange` writes an absolute, a percent and a bps change. Nothing
 * speculative is modelled, because a contract shaped around an imagined producer is how the first
 * version went wrong.
 *
 * **A date is not a quantity and is deliberately absent.** `2026-08-14` contributing `2026`, `08`
 * and `14` to a supported set is how "Revenue reached 2026" got authorised, and no amount of unit
 * checking fixes it if dates are atoms at all.
 */

/** The quantity kinds the existing producers emit. Closed; an unlisted kind supports nothing. */
export type QuantitativeKind =
  "OBSERVATION_VALUE" | "ABSOLUTE_CHANGE" | "PERCENT_CHANGE" | "BPS_CHANGE";

/**
 * One quantity a premise establishes, with everything needed to tell it from a coincidence.
 *
 * `subjectId` is the series the quantity is ABOUT. Without it, any premise's 2.1 supports any
 * other assertion's 2.1, which is the laundering case and the most dangerous of the five.
 */
export interface QuantitativeAtom {
  premiseClaimId: string;
  kind: QuantitativeKind;
  /** Signed. `-2.1` and `2.1` are different quantities and a sign is part of a financial fact. */
  canonicalValue: number;
  /** Canonical unit token: a series unit verbatim, or `percent` / `bps` for the change kinds. */
  unit: string;
  /** The series the quantity describes. */
  subjectId: string;
}

/** A premise row, in the shape the verifier already loads. */
export interface PremiseRow {
  id: string;
  claimType: string;
  evidence: unknown;
}

/** The database facts a premise's atoms are derived from, fetched by the caller. */
export interface PremiseEvidenceRows {
  observation?: { id: string; seriesId: string; value: { toString(): string } } | null;
  seriesUnit?: string | null;
}

/**
 * Derives the atoms a FACT premise establishes.
 *
 * One atom: the observation's own value, in the series' unit, about that series. The claim text
 * also names a date and a source name; neither is a quantity and neither becomes an atom.
 */
export function factAtoms(premise: PremiseRow, rows: PremiseEvidenceRows): QuantitativeAtom[] {
  const observation = rows.observation;
  const unit = rows.seriesUnit;
  if (!observation || !unit) return [];
  const canonicalValue = Number(observation.value.toString());
  if (!Number.isFinite(canonicalValue)) return [];
  return [
    {
      premiseClaimId: premise.id,
      kind: "OBSERVATION_VALUE",
      canonicalValue,
      unit,
      subjectId: observation.seriesId,
    },
  ];
}

/**
 * Derives the atoms a CALCULATION premise establishes.
 *
 * Three: the absolute change in the series' unit, the percent change, and the bps change. Taken
 * from the evidence the producer recorded, which `verifyCalculationClaim` independently recomputes
 * and compares before this is ever consulted — so a tampered number fails there, not here.
 */
export function calculationAtoms(
  premise: PremiseRow,
  rows: PremiseEvidenceRows,
): QuantitativeAtom[] {
  const evidence = premise.evidence as {
    seriesId?: unknown;
    absoluteChange?: unknown;
    percentChange?: unknown;
    bpsChange?: unknown;
  } | null;
  const subjectId = typeof evidence?.seriesId === "string" ? evidence.seriesId : null;
  if (!subjectId) return [];

  const pairs: [QuantitativeKind, unknown, string][] = [
    ["ABSOLUTE_CHANGE", evidence?.absoluteChange, rows.seriesUnit ?? ""],
    ["PERCENT_CHANGE", evidence?.percentChange, "percent"],
    ["BPS_CHANGE", evidence?.bpsChange, "bps"],
  ];

  return pairs
    .filter(([, value, unit]) => typeof value === "number" && Number.isFinite(value) && unit !== "")
    .map(([kind, value, unit]) => ({
      premiseClaimId: premise.id,
      kind,
      canonicalValue: value as number,
      unit,
      subjectId,
    }));
}
