import { describe, expect, it } from "vitest";
import { parseAttestation } from "@/server/release/attestation";

/**
 * The attestation parser, and the reason it stopped reading Markdown.
 *
 * Three review rounds were spent teaching a regex to find fields in prose, and each round produced
 * another way for prose to look like data: `CLEANISH` matching an unanchored verdict, a later
 * `CLEAN` line overriding an earlier `NOT_CLEAN`, a field inside a fenced block read as a field.
 * Stripping fences fixed the third and immediately exposed HTML comments, tilde fences, indented
 * blocks and unterminated fences as the same hole in different syntax.
 *
 * That list has no end, because Markdown draws no boundary a regex can see between content and an
 * illustration of content. The mistake was never a particular pattern; it was parsing a prose
 * document as a data format.
 *
 * **One of the tests here was also vacuous, which is worth recording.** The fence test used
 * `<full sha>` as its example value — invalid on its own — so it passed whether or not fence
 * stripping existed. A test that cannot fail for the reason it names is not evidence, and this file
 * had one sitting directly beneath a docstring claiming full coverage. Every negative case below is
 * now built from a value that WOULD be accepted if the specific check under test were removed.
 */

const shaValue = "b6b4858209cb546db5aa92d8c3988fd8e75aac29";
const valid = JSON.stringify({ reviewedCodeSha: shaValue, verdict: "CLEAN" }, null, 2);

describe("a well-formed attestation parses", () => {
  it("reads both fields and reports clean", () => {
    const parsed = parseAttestation(valid);
    expect(parsed?.reviewedCodeSha).toBe(shaValue);
    expect(parsed?.verdict).toBe("CLEAN");
    expect(parsed?.clean).toBe(true);
  });

  it("accepts an abbreviated SHA and ignores extra descriptive fields", () => {
    // Extra keys are the normal shape of a real attestation — model, scope, timestamp, findings.
    // They are recorded for humans and carry no weight here.
    const parsed = parseAttestation(
      JSON.stringify({
        reviewedCodeSha: "b6b4858",
        verdict: "CLEAN",
        reviewModel: "gpt-5.6-sol",
        p0Count: 0,
      }),
    );
    expect(parsed?.reviewedCodeSha).toBe("b6b4858");
    expect(parsed?.clean).toBe(true);
  });

  it("parses NOT_CLEAN as a real result rather than a failure to read", () => {
    // The distinction the caller depends on. Null means nobody established anything; NOT_CLEAN
    // means somebody looked and said no. Collapsing them would let an unreadable file stand in
    // for a failed review, or the reverse.
    const parsed = parseAttestation(
      JSON.stringify({ reviewedCodeSha: shaValue, verdict: "NOT_CLEAN" }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.clean).toBe(false);
  });
});

describe("prose cannot masquerade as a claim", () => {
  it.each([
    [
      "markdown with the fields as text",
      `# Attestation\n\nreviewedCodeSha: ${shaValue}\nverdict: CLEAN`,
    ],
    ["a JSON example inside a fenced block", "```json\n" + valid + "\n```"],
    ["an HTML-commented claim", `<!--\n${valid}\n-->`],
    ["a tilde-fenced claim", `~~~\n${valid}\n~~~`],
    ["prose wrapped around valid JSON", `Here is what it would say:\n${valid}\nBut it does not.`],
  ])("rejects %s", (_label, text) => {
    // Every one of these embeds a payload that IS accepted on its own, so each fails for the
    // reason it names rather than incidentally — the property the previous fence test lacked.
    expect(parseAttestation(text)).toBeNull();
  });

  it("still accepts a legitimately indented document", () => {
    // Not every "it looks embedded" case is one. A four-space indent is a Markdown code block and
    // also just whitespace, which JSON permits — this was in the rejection list above until it
    // failed, and the test was wrong rather than the parser. Moving to JSON retired the Markdown
    // concept without retiring the assumption, which is its own small lesson.
    expect(parseAttestation(valid.replace(/^/gm, "    "))).not.toBeNull();
  });

  it("confirms the embedded payload would otherwise be accepted", () => {
    // The control that makes the cases above meaningful. Without it they could all be passing
    // because the payload is invalid, which is exactly how the earlier vacuous test passed.
    expect(parseAttestation(valid)).not.toBeNull();
  });
});

describe("ambiguity is refused, never resolved", () => {
  it("rejects a document naming two verdicts", () => {
    // JSON.parse keeps the last duplicate key silently, which turns "append a correction instead
    // of replacing the error" into a verdict flip nobody can see in a diff of the parsed value.
    const two = `{"reviewedCodeSha":"${shaValue}","verdict":"NOT_CLEAN","verdict":"CLEAN"}`;
    // The payload parses as JSON and would be accepted if duplicates were tolerated.
    expect(JSON.parse(two).verdict).toBe("CLEAN");
    expect(parseAttestation(two)).toBeNull();
  });

  it("rejects a document naming two commits", () => {
    const two = `{"reviewedCodeSha":"${shaValue}","reviewedCodeSha":"b6b4858","verdict":"CLEAN"}`;
    expect(parseAttestation(two)).toBeNull();
  });
});

describe("only the enumerated verdict opens the gate", () => {
  it.each(["CLEANISH", "clean", "CLEAN ", "CLEAN.", "BLOCKED", "PENDING", ""])(
    "rejects the verdict %p",
    (verdict) => {
      expect(parseAttestation(JSON.stringify({ reviewedCodeSha: shaValue, verdict }))).toBeNull();
    },
  );

  it.each([
    ["a non-string verdict", { reviewedCodeSha: shaValue, verdict: true }],
    ["a missing verdict", { reviewedCodeSha: shaValue }],
    ["a missing sha", { verdict: "CLEAN" }],
    // 1234567, not 12345. The reviewer caught this one: with a five-digit number the case passes
    // even if the `typeof sha !== "string"` check is deleted, because SHA.test coerces it to
    // "12345" and rejects it for LENGTH. Seven digits are a valid hex length, so the only thing
    // that can reject them is the type check — which is what the case claims to be testing.
    // Second vacuous test found in this file, by the same question: would it fail if the check
    // it names were removed?
    ["a numeric sha of valid hex length", { reviewedCodeSha: 1234567, verdict: "CLEAN" }],
    ["a short sha", { reviewedCodeSha: "b6b4b", verdict: "CLEAN" }],
    ["an uppercase sha", { reviewedCodeSha: "B6B4858", verdict: "CLEAN" }],
    ["a non-hex sha", { reviewedCodeSha: "zzzzzzz", verdict: "CLEAN" }],
    ["a sha with surrounding space", { reviewedCodeSha: ` ${shaValue} `, verdict: "CLEAN" }],
  ])("rejects %s", (_label, payload) => {
    expect(parseAttestation(JSON.stringify(payload))).toBeNull();
  });
});

describe("keys are read as keys, not as text", () => {
  it("rejects a duplicate key written with a unicode escape", () => {
    // The regex duplicate check searched raw text for `"verdict":`, so a second verdict spelled
    // with an escape was invisible to it while JSON.parse decoded it and kept it — the later
    // value winning silently, which is the exact flip the check exists to prevent.
    const escaped = `{"reviewedCodeSha":"${shaValue}","verdict":"NOT_CLEAN","\u0076erdict":"CLEAN"}`;
    expect(JSON.parse(escaped).verdict, "the payload really does resolve to CLEAN").toBe("CLEAN");
    expect(parseAttestation(escaped)).toBeNull();
  });

  it("accepts a document that merely mentions a field name inside a value", () => {
    // The same regex failed in the other direction too: the word `reviewedCodeSha` inside a notes
    // field counted as a second key and rejected a well-formed document. Both failures have one
    // cause — text-matching a format that contains string literals.
    const withNotes = JSON.stringify({
      reviewedCodeSha: shaValue,
      verdict: "CLEAN",
      notes: 'the template shows "reviewedCodeSha": <sha> as an example',
    });
    expect(parseAttestation(withNotes)?.clean).toBe(true);
  });

  it("does not count a nested key as a top-level one", () => {
    const nested = JSON.stringify({
      reviewedCodeSha: shaValue,
      verdict: "CLEAN",
      previous: { reviewedCodeSha: "b6b4858", verdict: "NOT_CLEAN" },
    });
    expect(parseAttestation(nested)?.clean).toBe(true);
  });

  it("refuses an input larger than any real attestation", () => {
    const huge = `{"reviewedCodeSha":"${shaValue}","verdict":"CLEAN","pad":"${"x".repeat(70000)}"}`;
    expect(parseAttestation(huge)).toBeNull();
  });
});

describe("anything unreadable yields nothing", () => {
  it.each([
    ["empty", ""],
    ["not JSON", "{ not json"],
    ["a JSON array", "[]"],
    ["a JSON string", '"CLEAN"'],
    ["JSON null", "null"],
    ["a number", "42"],
  ])("returns null for %s", (_label, text) => {
    expect(parseAttestation(text)).toBeNull();
  });
});
