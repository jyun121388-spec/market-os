import { describe, expect, it } from "vitest";
import {
  REQUEST_AUTHORITY_HOLDOUT,
  REQUEST_AUTHORITY_HOLDOUT_KIND,
  REQUEST_AUTHORITY_SHA256,
} from "./fixtures/requestAuthorityHoldout";
import { canonicalCorpusHash, canonicalJson } from "./fixtures/canonicalCorpusHash";

/**
 * The frozen request-authority corpus, checked rather than trusted.
 *
 * `REQUEST_AUTHORITY_SHA256` was computed at generation time, by a script, from the model's raw
 * output — before any of this repository's code touched it. Until now the evaluator printed that
 * constant, which looks like verification and is not: the constant and the 180 cases could drift
 * apart without a single test noticing. These recompute the hash from the cases themselves.
 *
 * A corpus edited by one character makes this fail. The response to that failure is to restore the
 * corpus, never to regenerate the constant — the whole value of a frozen holdout is that its
 * contents were fixed before anyone knew how the implementation would behave on them.
 */
describe("the frozen request-authority corpus is the one that was frozen", () => {
  it("recomputes to the hash taken at generation time", () => {
    expect(canonicalCorpusHash(REQUEST_AUTHORITY_HOLDOUT)).toBe(REQUEST_AUTHORITY_SHA256);
    expect(REQUEST_AUTHORITY_SHA256).toBe(
      "0c9099f3698d6f4d7cd8b26c9b1b356a75f45dac6985a69b6188090fb67ecdc1",
    );
  });

  it("pins the serialization, not only its output", () => {
    // Without this, a future change to `canonicalJson` could be "fixed" by regenerating the
    // constant and the integrity test would still pass while checking a different rule.
    expect(canonicalJson({ b: 1, a: "x" })).toBe('{"a": "x", "b": 1}');
    expect(canonicalJson([true, null, 2])).toBe("[true, null, 2]");
    expect(canonicalJson({ k: "한국" })).toBe('{"k": "한국"}');
    expect(canonicalJson({ k: 'q"\\' })).toBe('{"k": "q\\"\\\\"}');
  });

  it("holds 180 cases in their frozen order", () => {
    expect(REQUEST_AUTHORITY_HOLDOUT).toHaveLength(180);
    expect(REQUEST_AUTHORITY_HOLDOUT[0].id).toBe("RA-001");
    expect(REQUEST_AUTHORITY_HOLDOUT[179].id).toBe("RA-180");
    const ids = REQUEST_AUTHORITY_HOLDOUT.map((c) => c.id);
    expect(new Set(ids).size).toBe(180);
  });

  it("is still labelled as a fresh holdout, and says so", () => {
    // This flips to regression evidence the moment implementation is influenced by it. The kind is
    // an assertion about provenance, so a test guards it rather than a comment.
    expect(REQUEST_AUTHORITY_HOLDOUT_KIND).toBe("FRESH_HOLDOUT");
  });

  it("keeps ANSWERABLE and operation consistent", () => {
    for (const c of REQUEST_AUTHORITY_HOLDOUT) {
      if (c.expected === "ANSWERABLE") expect(c.operation).not.toBe("NONE");
    }
  });

  it("carries both languages in equal measure", () => {
    const en = REQUEST_AUTHORITY_HOLDOUT.filter((c) => c.language === "EN").length;
    expect(en).toBe(90);
    expect(REQUEST_AUTHORITY_HOLDOUT.length - en).toBe(90);
  });
});
