/**
 * The canonical serialization a frozen corpus is hashed under, so integrity can be RECOMPUTED
 * rather than declared.
 *
 * A fixture that carries its own SHA as a constant proves nothing: the constant and the cases can
 * drift apart silently, and printing the constant back reads like verification while checking
 * nothing at all. This module defines the serialization precisely enough that the hash frozen at
 * generation time — by a Python script, before any of this existed — can be reproduced here and
 * compared. If the corpus changes by one character, the test fails; the answer to that failure is
 * never to regenerate the constant.
 *
 * ## The rule
 *
 * Values are emitted as JSON with two deviations from `JSON.stringify`, both chosen to match
 * CPython's `json.dumps(obj, ensure_ascii=False, sort_keys=True)`, which produced the frozen hashes:
 *
 *  - object keys are sorted by code point, and
 *  - separators carry a space: `", "` between items, `": "` between a key and its value.
 *
 * Non-ASCII characters are emitted raw, as `ensure_ascii=False` does — the corpora are half Korean,
 * so escaping them would make the two implementations disagree on every second case. String
 * escaping otherwise follows JSON, where the two agree: `"` and `\` and the short control escapes.
 *
 * The hash is SHA-256 over the UTF-8 bytes of that text.
 */

import { createHash } from "node:crypto";

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}: ${canonicalJson((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(", ")}}`;
  }
  throw new Error(`canonicalJson cannot serialize ${typeof value}`);
}

/** SHA-256 of the canonical serialization of a labelled corpus. */
export function canonicalCorpusHash(corpus: readonly unknown[]): string {
  return createHash("sha256").update(canonicalJson(corpus), "utf8").digest("hex");
}

/** Exported for the test that pins the serialization itself, not only its output. */
export { canonicalJson };
