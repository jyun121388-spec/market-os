/**
 * Parsing a review attestation, which is the document the release gate believes.
 *
 * **It is JSON, and that is a finding rather than a preference.** Three rounds went into teaching a
 * regex to find fields in Markdown, and each round the reviewer found another way for prose to look
 * like data: an unanchored verdict matching `CLEANISH`; a later `CLEAN` line overriding an earlier
 * `NOT_CLEAN`; a field inside a fenced block read as a field. Stripping fences fixed the third and
 * immediately exposed HTML comments, tilde fences, indented blocks and unterminated fences as the
 * same hole in different syntax. That list has no end, because Markdown draws no boundary a regex
 * can see between content and an illustration of content.
 *
 * What survives from those rounds, because each was a real defect:
 *
 * - **Exactly one of each field.** `JSON.parse` resolves a duplicate key by silently keeping the
 *   last, which turns "append a correction instead of replacing the error" into a verdict flip that
 *   is invisible in the parsed value. Refused rather than resolved: there is no defensible rule for
 *   which of two contradictory claims is real.
 * - **The verdict is compared, not matched.** Only the enumerated value opens the gate.
 * - **Unreadable is not negative.** A file nobody can parse yields null, which the gate reads as
 *   MISSING. "We could not read it" and "it said no" are different facts, and only one is evidence.
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
 * A ceiling on input size.
 *
 * The attestation is a handful of fields. Nothing legitimate approaches this, and an unbounded
 * parse of an arbitrarily large file is cost for no purpose.
 */
const MAX_BYTES = 64 * 1024;

/**
 * Top-level keys, in source order, decoded.
 *
 * A scan rather than a regex, and the difference is not fussiness — the regex version failed in
 * both directions at once. `"verdict"` is `verdict` after JSON decodes it, so a second verdict
 * written that way was invisible to a literal-text search while `JSON.parse` happily kept it and
 * discarded the first. And the word `reviewedCodeSha` appearing inside a *notes* field counted as
 * a duplicate, rejecting a document that was perfectly well-formed.
 *
 * Both failures come from the same cause: text-matching a format that has string literals and
 * escapes in it. The scan tracks strings, escapes and depth, so it sees keys as keys.
 */
function topLevelKeys(raw: string): string[] | null {
  const keys: string[] = [];
  let depth = 0;
  let index = 0;

  const skipString = (): string | null => {
    // Caller has positioned `index` on the opening quote.
    let out = "";
    index += 1;
    while (index < raw.length) {
      const ch = raw[index];
      if (ch === "\\") {
        const next = raw[index + 1];
        if (next === "u") {
          const hex = raw.slice(index + 2, index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          out += String.fromCharCode(Number.parseInt(hex, 16));
          index += 6;
          continue;
        }
        const simple: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (next === undefined || !(next in simple)) return null;
        out += simple[next];
        index += 2;
        continue;
      }
      if (ch === '"') {
        index += 1;
        return out;
      }
      out += ch;
      index += 1;
    }
    return null;
  };

  while (index < raw.length) {
    const ch = raw[index];
    if (ch === '"') {
      const start = depth;
      const text = skipString();
      if (text === null) return null;
      // A string at depth 1 is a key only when the next non-space character is a colon.
      let probe = index;
      while (probe < raw.length && /\s/.test(raw[probe])) probe += 1;
      if (start === 1 && raw[probe] === ":") keys.push(text);
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    index += 1;
  }

  return keys;
}

export function parseAttestation(raw: string): ParsedAttestation | null {
  if (raw.length > MAX_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const keys = topLevelKeys(raw);
  if (keys === null) return null;
  for (const required of ["reviewedCodeSha", "verdict"]) {
    if (keys.filter((key) => key === required).length !== 1) return null;
  }

  const sha = record.reviewedCodeSha;
  const verdict = record.verdict;
  if (typeof sha !== "string" || !SHA.test(sha)) return null;
  if (verdict !== "CLEAN" && verdict !== "NOT_CLEAN") return null;

  return { reviewedCodeSha: sha, verdict, clean: verdict === "CLEAN" };
}
