/**
 * Comparing what an inference SAID against what its premises SUPPORT.
 *
 * Two sides, derived independently, then compared. That separation is the whole design:
 *
 *     text side        parse the prose        -> the assertions a reader would take away
 *     structured side  read the database      -> the quantities the premises establish
 *
 * The previous version derived both from prose, which meant it was comparing the model's output
 * with itself and could only ever check that a digit sequence appeared twice. IR-094 has the probe
 * matrix.
 *
 * ## Where the unit vocabulary lives, and why that is not the forbidden enumeration
 *
 * Parsing "2.1 percent" into `{ sign: +, magnitude: 2.1, unit: percent }` needs to know a few unit
 * words, and the standing rule is not to answer a structural defect by growing a word list. The
 * difference is which way the list fails:
 *
 *     the old figuresIn        unrecognised shape -> the number is still supported  (fails open)
 *     this parser              unrecognised shape -> UNPARSEABLE, the citation fails (fails closed)
 *
 * A vocabulary that refuses what it does not recognise cannot be walked past by inventing a new
 * phrasing; it can only be made stricter than intended, which shows up as a false refusal and not
 * as an unsupported number reaching a reader.
 */

import type { QuantitativeAtom } from "./quantitativeEvidence";

/**
 * A producer's claim that one span of its prose is supported by one premise quantity.
 *
 * `surfaceText` is what the prose says; the rest names which atom is supposed to back it. Both are
 * required, because the citation has to be checkable in both directions — the atom must exist, and
 * the words must actually appear in the sentence.
 */
export interface QuantitativeCitation {
  premiseClaimId: string;
  kind: string;
  surfaceText: string;
}

export interface ParsedQuantity {
  sign: 1 | -1;
  magnitude: number;
  unit: string;
}

/**
 * Canonical unit tokens, and the surface forms that mean them.
 *
 * Short on purpose. Anything absent is `UNPARSEABLE`, which fails the citation.
 */
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
 * Parses one surface span into a signed magnitude and a canonical unit, or refuses.
 *
 * Refuses when there is no number, more than one number, or no recognisable unit. A span with no
 * unit at all is refused rather than treated as dimensionless: "Revenue was 1,400" is a quantity
 * whose unit the sentence did not state, and guessing it is exactly the mistake being repaired.
 */
export function parseQuantity(surfaceText: string): ParsedQuantity | "UNPARSEABLE" {
  const text = surfaceText.trim();

  const numbers = text.match(/-?\d[\d,]*(\.\d+)?/g) ?? [];
  if (numbers.length !== 1) return "UNPARSEABLE";
  const raw = numbers[0];
  const magnitude = Math.abs(Number(raw.replace(/,/g, "")));
  if (!Number.isFinite(magnitude)) return "UNPARSEABLE";

  // A leading minus on the number itself, or an explicit "minus"/"down"/"fell" is not inferred —
  // only the sign character counts, because reading direction out of a verb is interpretation.
  const sign: 1 | -1 = raw.trimStart().startsWith("-") ? -1 : 1;

  const before = text.slice(0, text.indexOf(raw));
  const after = text.slice(text.indexOf(raw) + raw.length).trim();

  for (const [symbol, unit] of CURRENCY_PREFIX) {
    if (before.includes(symbol)) return { sign, magnitude, unit };
  }

  // The unit is the token immediately after the number, or the token after a scale word.
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
  | "SURFACE_TEXT_NOT_IN_CLAIM"
  | "ATOM_NOT_FOUND"
  | "UNPARSEABLE_SURFACE"
  | "SIGN_MISMATCH"
  | "UNIT_MISMATCH"
  | "VALUE_MISMATCH";

export interface CitationCheck {
  citation: QuantitativeCitation;
  verdict: CitationVerdict;
  detail: string;
}

/** Floating-point comparison at the precision a rendered figure actually carries. */
function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
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

  if (!claimText.includes(citation.surfaceText)) {
    return fail(
      "SURFACE_TEXT_NOT_IN_CLAIM",
      `The citation quotes "${citation.surfaceText}", which does not appear in the claim text. A ` +
        "citation that does not point at the words it claims to support proves nothing.",
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

  const parsed = parseQuantity(citation.surfaceText);
  if (parsed === "UNPARSEABLE") {
    return fail(
      "UNPARSEABLE_SURFACE",
      `"${citation.surfaceText}" does not parse into a signed magnitude and a known unit. ` +
        "Refused rather than assumed: an unreadable quantity is not a supported one.",
    );
  }

  if (parsed.sign !== Math.sign(atom.canonicalValue) && atom.canonicalValue !== 0) {
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

  if (!sameValue(parsed.magnitude, Math.abs(atom.canonicalValue))) {
    return fail(
      "VALUE_MISMATCH",
      `The text says ${parsed.magnitude} and the evidence says ${Math.abs(atom.canonicalValue)}.`,
    );
  }

  return { citation, verdict: "SUPPORTED", detail: "sign, unit and value all match the evidence" };
}
