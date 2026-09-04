/**
 * Comparing what an inference SAID against what its premises SUPPORT, occurrence by occurrence.
 *
 * Two sides, derived independently, then compared:
 *
 *     text side        parse the prose        -> the assertions a reader would take away
 *     structured side  read the database      -> the quantities the premises establish
 *
 * ## What the second-order review changed (IR-095)
 *
 * The first structured version fixed sign, unit and premise binding, and left three holes that a
 * probe matrix found immediately:
 *
 * - **Occurrence.** `"margin was 2.1 percent, while unemployment was 2.1 percent"` needed one
 *   citation, because coverage compared a de-duplicated SET of numeric tokens and asked whether
 *   each appeared inside some cited surface. Two assertions, one citation, verified.
 * - **Subject.** `subjectId` existed on the atom, was documented as preventing cross-subject
 *   laundering, and was never compared to anything — the citation had no subject to compare it
 *   with. An Apple-margin premise authorised "Unemployment is 5 percent."
 * - **Exactness.** `canonicalValue` was a JS number, so `90000000000000.000001` and
 *   `90000000000000.000002` — two distinct values a `Decimal(20,6)` column holds — became the same
 *   double and compared equal.
 *
 * A citation now names a RANGE in the claim text, a SUBJECT, and an exact decimal string. One
 * citation covers one occurrence, and nothing else.
 *
 * ## Where the unit vocabulary lives, and why it is not the forbidden enumeration
 *
 * Parsing "2.1 percent" needs a few unit words, and the standing rule is not to answer a structural
 * defect by growing a word list. The difference is the direction of failure: an unrecognised shape
 * here is `UNPARSEABLE` and the citation fails, so the list can only ever be too strict — which
 * shows up as a false refusal, never as an unsupported number reaching a reader.
 */

import { sameDecimalValue } from "./observationIngest";
import type { QuantitativeAtom } from "./quantitativeEvidence";

/**
 * A producer's claim that one exact span of its prose is supported by one premise quantity.
 *
 * `assertionStart`/`assertionEnd` are character offsets into `claimText`. They are the whole point
 * of the second-order repair: a citation identifies an OCCURRENCE, not a substring that happens to
 * exist somewhere. Offsets are never trusted — the verifier slices the text and requires the slice
 * to equal `surfaceText`.
 *
 * `subjectId` is what the producer's structured plan says this assertion is ABOUT. See the residual
 * limitation in `./inferenceClaim`: this binds the plan to the evidence, and binding the PROSE to
 * the plan is the renderer's job.
 */
export interface QuantitativeCitation {
  premiseClaimId: string;
  kind: string;
  subjectId: string;
  surfaceText: string;
  assertionStart: number;
  assertionEnd: number;
}

export interface ParsedQuantity {
  sign: 1 | -1;
  /** Exact decimal digits as written, separators stripped. A string, never a number. */
  magnitude: string;
  unit: string;
}

/** Canonical unit tokens, and the surface forms that mean them. Anything absent is UNPARSEABLE. */
const UNIT_FORMS: [RegExp, string][] = [
  [/^%$/, "percent"],
  [/^(percent|percentage|퍼센트)$/i, "percent"],
  [/^(bps|basis\s?points?)$/i, "bps"],
  [/^(usd|dollars?)$/i, "USD"],
  [/^(krw|won|원)$/i, "KRW"],
  [/^(eur|euros?)$/i, "EUR"],
  [/^(jpy|yen|엔)$/i, "JPY"],
  [/^(index\s?points?|points?|pt|pts)$/i, "index points"],
];

const CURRENCY_PREFIX: [string, string][] = [
  ["$", "USD"],
  ["₩", "KRW"],
  ["€", "EUR"],
  ["¥", "JPY"],
];

/**
 * Parses one surface span into a signed exact magnitude and a canonical unit, or refuses.
 *
 * The magnitude stays a string. Converting it to a number here would reintroduce the precision
 * collapse the whole repair exists to close, one line after the value left the database intact.
 */
export function parseQuantity(surfaceText: string): ParsedQuantity | "UNPARSEABLE" {
  const text = surfaceText.trim();

  const numbers = text.match(/-?\d[\d,]*(\.\d+)?/g) ?? [];
  if (numbers.length !== 1) return "UNPARSEABLE";
  const raw = numbers[0];
  const sign: 1 | -1 = raw.startsWith("-") ? -1 : 1;
  const magnitude = raw.replace(/^-/, "").replace(/,/g, "");

  const before = text.slice(0, text.indexOf(raw));
  const after = text.slice(text.indexOf(raw) + raw.length).trim();

  for (const [symbol, unit] of CURRENCY_PREFIX) {
    if (before.includes(symbol)) return { sign, magnitude, unit };
  }

  const afterTokens = after.split(/[\s,.;:)]+/).filter(Boolean);
  if (afterTokens.length === 0) return "UNPARSEABLE";
  const candidates = [afterTokens[0], afterTokens.slice(0, 2).join(" ")];
  for (const candidate of candidates) {
    for (const [pattern, unit] of UNIT_FORMS) {
      if (pattern.test(candidate)) return { sign, magnitude, unit };
    }
  }
  return "UNPARSEABLE";
}

export type CitationVerdict =
  | "SUPPORTED"
  | "RANGE_OUT_OF_BOUNDS"
  | "RANGE_TEXT_MISMATCH"
  | "ATOM_NOT_FOUND"
  | "SUBJECT_MISMATCH"
  | "UNPARSEABLE_SURFACE"
  | "SIGN_MISMATCH"
  | "UNIT_MISMATCH"
  | "VALUE_MISMATCH";

export interface CitationCheck {
  citation: QuantitativeCitation;
  verdict: CitationVerdict;
  detail: string;
}

/**
 * Exact decimal equality, reusing the comparison the ingest path already applies to this column.
 *
 * `sameDecimalValue` scales both operands to millionths the way `Decimal(20,6)` does and compares
 * integers, so it is exact at the column's own precision rather than at the precision a double
 * happens to survive. It throws on an unreadable operand, which is caught and reported as a value
 * mismatch: a comparison that cannot read an operand has not decided anything.
 */
function sameExactValue(a: string, b: string): boolean {
  try {
    return sameDecimalValue(a, b);
  } catch {
    return false;
  }
}

/** Absolute value of an exact decimal string, without going through a number. */
function magnitudeOf(exact: string): string {
  return exact.trim().replace(/^[+-]/, "");
}

function signOf(exact: string): 1 | -1 | 0 {
  const trimmed = exact.trim();
  if (/^[+-]?0*(\.0*)?$/.test(trimmed)) return 0;
  return trimmed.startsWith("-") ? -1 : 1;
}

/**
 * Checks one citation against the atoms its premise establishes and against the prose itself.
 *
 * Every failure is named. A citation that cannot be checked is not a citation that passes.
 */
export function checkCitation(
  citation: QuantitativeCitation,
  claimText: string,
  atoms: QuantitativeAtom[],
): CitationCheck {
  const fail = (verdict: CitationVerdict, detail: string): CitationCheck => ({
    citation,
    verdict,
    detail,
  });

  // Offsets are producer-supplied and therefore not trusted. Bounds first, then the slice.
  const { assertionStart: start, assertionEnd: end } = citation;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > claimText.length ||
    start >= end
  ) {
    return fail(
      "RANGE_OUT_OF_BOUNDS",
      `[${start}, ${end}) is not a valid range within a claim of length ${claimText.length}.`,
    );
  }
  if (claimText.slice(start, end) !== citation.surfaceText) {
    return fail(
      "RANGE_TEXT_MISMATCH",
      `The claim text at [${start}, ${end}) is "${claimText.slice(start, end)}", not ` +
        `"${citation.surfaceText}". A citation that does not point at the words it quotes ` +
        "identifies no occurrence.",
    );
  }

  const atom = atoms.find(
    (a) => a.premiseClaimId === citation.premiseClaimId && a.kind === citation.kind,
  );
  if (!atom) {
    return fail(
      "ATOM_NOT_FOUND",
      `No ${citation.kind} quantity is established by premise ${citation.premiseClaimId}.`,
    );
  }

  // Subject before value, because the interesting failure is the one where the numbers agree.
  if (citation.subjectId !== atom.subjectId) {
    return fail(
      "SUBJECT_MISMATCH",
      `The assertion is about ${citation.subjectId} and the evidence is about ${atom.subjectId}. ` +
        "The same number measured on a different subject is a different fact.",
    );
  }

  const parsed = parseQuantity(citation.surfaceText);
  if (parsed === "UNPARSEABLE") {
    return fail(
      "UNPARSEABLE_SURFACE",
      `"${citation.surfaceText}" does not parse into a signed magnitude and a known unit. ` +
        "Refused rather than assumed.",
    );
  }

  const atomSign = signOf(atom.canonicalValue);
  if (atomSign !== 0 && parsed.sign !== atomSign) {
    return fail(
      "SIGN_MISMATCH",
      `The text says ${parsed.sign < 0 ? "a fall" : "a rise"} and the evidence says the opposite ` +
        `(${atom.canonicalValue}). A sign is part of a financial quantity.`,
    );
  }

  if (parsed.unit !== atom.unit) {
    return fail(
      "UNIT_MISMATCH",
      `The text is in ${parsed.unit} and the evidence is in ${atom.unit}. The same number in two ` +
        "units is two different facts.",
    );
  }

  if (!sameExactValue(parsed.magnitude, magnitudeOf(atom.canonicalValue))) {
    return fail(
      "VALUE_MISMATCH",
      `The text says ${parsed.magnitude} and the evidence says ${magnitudeOf(atom.canonicalValue)}.`,
    );
  }

  return {
    citation,
    verdict: "SUPPORTED",
    detail: "range, subject, sign, unit and exact value all match the evidence",
  };
}
