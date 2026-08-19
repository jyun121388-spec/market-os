/**
 * Parsing a review attestation, which is the document the release gate believes.
 *
 * **It is JSON, and that is the finding rather than a preference.** Three rounds were spent making
 * a regex read fields out of Markdown, and each round the reviewer found another way for prose to
 * look like data: an unanchored verdict matched `CLEANISH`; a later `CLEAN` line overrode an
 * earlier `NOT_CLEAN`; a field inside a fenced block was read as a field. Stripping fences fixed
 * the third and immediately exposed HTML comments, tilde fences, indented blocks and unterminated
 * fences as the same hole wearing different syntax.
 *
 * There is no end to that list, because Markdown has no boundary between "content" and "an
 * illustration of content" that a regex can see. The mistake was never a particular pattern — it
 * was treating a prose document as a data format. A machine-readable claim belongs in a
 * machine-readable file, and the prose that explains it belongs beside it where nothing parses it.
 *
 * What survives from those rounds, because each was a real defect:
 *
 * - **Exactly one verdict.** JSON cannot express two values for one key, but a hand-edited file
 *   can contain the key twice and `JSON.parse` silently keeps the last — which is precisely the
 *   "append a correction instead of replacing the error" case. Duplicates are detected and refused.
 * - **The verdict is compared, not matched.** Only the enumerated value opens the gate.
 * - **Unreadable is not negative.** A file nobody can parse yields null, which the gate reads as
 *   MISSING. "We could not read it" and "it said no" are different facts and only one is evidence.
 *
 * Pure: no filesystem, no git, no clock. The commit's identity and direction are established by the
 * caller against the commit graph, because a document cannot be evidence for its own scope.
 */

export type AttestationVerdict = "CLEAN" | "NOT_CLEAN";

export interface ParsedAttestation {
  reviewedCodeSha: string;
  verdict: AttestationVerdict;
  /** True only for the exact enumerated clean value. */
  clean: boolean;
}

const SHA = /^[0-9a-f]{7,40}$/;

/**
 * Whether a key appears more than once in the raw text.
 *
 * `JSON.parse` resolves a duplicate key by keeping the last occurrence, silently. For ordinary
 * data that is a curiosity; for a verdict it is the difference between `NOT_CLEAN` and `CLEAN`,
 * decided by which line someone happened to append. Refusing is the only honest answer, because
 * there is no defensible rule for which of two contradictory claims is the real one.
 */
function appearsTwice(raw: string, key: string): boolean {
  const matches = raw.match(new RegExp(`"${key}"\\s*:`, "g"));
  return (matches?.length ?? 0) > 1;
}

export function parseAttestation(raw: string): ParsedAttestation | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  if (appearsTwice(raw, "reviewedCodeSha") || appearsTwice(raw, "verdict")) return null;

  const sha = record.reviewedCodeSha;
  const verdict = record.verdict;
  if (typeof sha !== "string" || !SHA.test(sha)) return null;
  if (verdict !== "CLEAN" && verdict !== "NOT_CLEAN") return null;

  return { reviewedCodeSha: sha, verdict, clean: verdict === "CLEAN" };
}
