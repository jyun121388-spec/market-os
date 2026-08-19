/**
 * Parsing a review attestation, which is a small security-relevant parser and was living in a
 * script with no tests.
 *
 * The attestation is the document that says "this exact commit was independently reviewed and
 * found clean". The release gate reads it. A parser that is too generous here does not produce a
 * wrong number on a dashboard — it closes a release on a review that did not happen.
 *
 * Four properties, each of which was a defect first:
 *
 * - **Fenced blocks are not fields.** A field line inside ``` is an example OF the format, and the
 *   parser read it as an instance of it, so a document merely showing what an attestation looks
 *   like was accepted as one. The natural way to document a format is to show it, which makes this
 *   the realistic case rather than a contrived one.
 * - **Exactly one of each field.** `REVIEW_VERDICT: NOT_CLEAN` followed by `REVIEW_VERDICT: CLEAN`
 *   was read as clean, because a per-line match is satisfied by the friendlier line. That is what a
 *   careless edit produces — appending a correction instead of replacing the error. Ambiguity is
 *   refused rather than resolved: there is no defensible rule for which of two contradictory
 *   verdicts is real, so a document stating both states nothing.
 * - **The verdict is compared, not matched.** An unanchored pattern accepted `CLEANISH`.
 * - **Anything unparseable yields nothing at all**, which the gate reads as MISSING rather than as
 *   a negative result. "We could not read it" and "it said no" are different, and only one of them
 *   is evidence about the code.
 *
 * Pure: no filesystem, no git, no clock. Direction and identity of the commit are established by
 * the caller against the commit graph, because a document cannot be evidence for its own scope.
 */

export interface ParsedAttestation {
  reviewedCodeSha: string;
  verdict: string;
  /** True only for the exact enumerated value. Every other verdict, including unknown ones. */
  clean: boolean;
}

/** Removes fenced code blocks, so an illustration of the format is never read as the format. */
function withoutFencedBlocks(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, "");
}

/**
 * Reads the two required fields, or returns null.
 *
 * Null covers every failure — absent, duplicated, malformed, indented, wrong case — deliberately.
 * A caller that could distinguish "malformed" from "says NOT_CLEAN" would be tempted to treat the
 * first as recoverable, and it is not: an attestation nobody can read is not an attestation.
 */
export function parseAttestation(markdown: string): ParsedAttestation | null {
  const prose = withoutFencedBlocks(markdown);

  const shaMatches = [...prose.matchAll(/^REVIEWED_CODE_SHA:\s*`?([0-9a-f]{7,40})`?\s*$/gm)];
  const verdictMatches = [...prose.matchAll(/^REVIEW_VERDICT:\s*`?([A-Z_]+)`?\s*$/gm)];

  if (shaMatches.length !== 1 || verdictMatches.length !== 1) return null;

  const verdict = verdictMatches[0][1];
  return {
    reviewedCodeSha: shaMatches[0][1],
    verdict,
    clean: verdict === "CLEAN",
  };
}
