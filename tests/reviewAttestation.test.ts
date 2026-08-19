import { describe, expect, it } from "vitest";
import { parseAttestation } from "@/server/release/attestation";

/**
 * The attestation parser, with every case an adversarial review raised.
 *
 * This parser decides whether the release gate believes a review happened. It spent several
 * rounds inside a script with no tests, which is how a security-relevant parser accumulates three
 * separate fail-open defects without anyone noticing: an unanchored verdict pattern that accepted
 * `CLEANISH`, per-line matching that let a later `CLEAN` override an earlier `NOT_CLEAN`, and
 * fenced examples read as real fields.
 *
 * The last one is the most instructive. The natural way to document a format is to show it, so a
 * document explaining what an attestation should contain was itself accepted as one. Nothing about
 * that is contrived — it is what writing the documentation produces.
 */

const valid = [
  "# Review attestation",
  "",
  "REVIEWED_CODE_SHA: 0f9caeb561a5455977d14540ea44da303565d74f",
  "REVIEW_VERDICT: CLEAN",
  "",
  "Some prose about the review.",
].join("\n");

describe("a well-formed attestation parses", () => {
  it("reads both fields and reports clean", () => {
    const parsed = parseAttestation(valid);
    expect(parsed?.reviewedCodeSha).toBe("0f9caeb561a5455977d14540ea44da303565d74f");
    expect(parsed?.verdict).toBe("CLEAN");
    expect(parsed?.clean).toBe(true);
  });

  it("accepts a 7-character abbreviated SHA and backticked values", () => {
    const parsed = parseAttestation("REVIEWED_CODE_SHA: `0f9caeb`\nREVIEW_VERDICT: `CLEAN`");
    expect(parsed?.reviewedCodeSha).toBe("0f9caeb");
    expect(parsed?.clean).toBe(true);
  });

  it("survives CRLF line endings", () => {
    expect(parseAttestation(valid.split("\n").join("\r\n"))?.clean).toBe(true);
  });
});

describe("a verdict other than CLEAN is not clean", () => {
  it.each(["NOT_CLEAN", "CLEANISH", "BLOCKED", "PENDING", "UNKNOWN"])("%s", (verdict) => {
    const parsed = parseAttestation(`REVIEWED_CODE_SHA: 0f9caeb\nREVIEW_VERDICT: ${verdict}`);
    // Parsed successfully — the document is well-formed and says something other than clean, which
    // is a different fact from being unreadable.
    expect(parsed?.verdict).toBe(verdict);
    expect(parsed?.clean).toBe(false);
  });

  it("does not accept CLEAN with a trailing period", () => {
    // The value is compared, not pattern-matched, and `CLEAN.` is not the enumerated value. It
    // fails to parse at all rather than parsing as clean.
    expect(parseAttestation("REVIEWED_CODE_SHA: 0f9caeb\nREVIEW_VERDICT: CLEAN.")).toBeNull();
  });
});

describe("an example of the format is not an instance of it", () => {
  it("ignores fields inside a fenced code block", () => {
    // The fail-open case, and the realistic one: a template showing what to write was read as
    // what had been written.
    const template = [
      "# How to write an attestation",
      "",
      "```",
      "REVIEWED_CODE_SHA: <full sha>",
      "REVIEW_VERDICT: CLEAN",
      "```",
      "",
      "No attestation has actually been recorded yet.",
    ].join("\n");
    expect(parseAttestation(template)).toBeNull();
  });

  it("reads the real fields when a fenced template sits alongside them", () => {
    // The false-negative the exactly-one rule introduced before fences were stripped: a real
    // attestation next to its own template counted as two and rejected the document.
    const both = [
      "```",
      "REVIEWED_CODE_SHA: <sha>",
      "REVIEW_VERDICT: CLEAN",
      "```",
      "",
      valid,
    ].join("\n");
    expect(parseAttestation(both)?.reviewedCodeSha).toBe(
      "0f9caeb561a5455977d14540ea44da303565d74f",
    );
  });
});

describe("ambiguity is refused, never resolved", () => {
  it("rejects a document stating two verdicts", () => {
    // What a careless edit produces: appending a correction instead of replacing the error. There
    // is no defensible rule for which of two contradictory verdicts is the real one.
    const two = [
      "REVIEWED_CODE_SHA: 0f9caeb",
      "REVIEW_VERDICT: NOT_CLEAN",
      "",
      "on reflection:",
      "REVIEW_VERDICT: CLEAN",
    ].join("\n");
    expect(parseAttestation(two)).toBeNull();
  });

  it("rejects a document naming two commits", () => {
    const two = [
      "REVIEWED_CODE_SHA: 0f9caeb",
      "REVIEWED_CODE_SHA: 8c7ccb1",
      "REVIEW_VERDICT: CLEAN",
    ].join("\n");
    expect(parseAttestation(two)).toBeNull();
  });
});

describe("anything unreadable yields nothing", () => {
  it.each([
    ["empty", ""],
    ["no fields", "# Notes\n\nnothing structured here"],
    ["only a sha", "REVIEWED_CODE_SHA: 0f9caeb"],
    ["only a verdict", "REVIEW_VERDICT: CLEAN"],
    ["indented field", "  REVIEWED_CODE_SHA: 0f9caeb\n  REVIEW_VERDICT: CLEAN"],
    ["quoted field", "> REVIEWED_CODE_SHA: 0f9caeb\n> REVIEW_VERDICT: CLEAN"],
    ["table row", "| REVIEWED_CODE_SHA: 0f9caeb | REVIEW_VERDICT: CLEAN |"],
    ["lowercase names", "reviewed_code_sha: 0f9caeb\nreview_verdict: CLEAN"],
    ["uppercase sha", "REVIEWED_CODE_SHA: 0F9CAEB\nREVIEW_VERDICT: CLEAN"],
    ["short sha", "REVIEWED_CODE_SHA: 0f9ca\nREVIEW_VERDICT: CLEAN"],
    ["non-hex sha", "REVIEWED_CODE_SHA: zzzzzzz\nREVIEW_VERDICT: CLEAN"],
  ])("returns null for %s", (_label, markdown) => {
    expect(parseAttestation(markdown)).toBeNull();
  });

  it("distinguishes unreadable from negative", () => {
    // The distinction the caller depends on. Null means MISSING — nobody established anything —
    // whereas a parsed NOT_CLEAN is a real result. Collapsing them would let an unreadable file
    // stand in for a failed review, or worse, the reverse.
    expect(parseAttestation("garbage")).toBeNull();
    expect(
      parseAttestation("REVIEWED_CODE_SHA: 0f9caeb\nREVIEW_VERDICT: NOT_CLEAN"),
    ).not.toBeNull();
  });
});
