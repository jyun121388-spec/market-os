import { describe, expect, it } from "vitest";
import {
  claimIsCandidate,
  explanationIsCandidate,
  isEmptyEnvelope,
  type CandidateEnvelope,
} from "@/server/domain/candidateEnvelope";
import { nameOccursIn, normalizeSubject } from "@/server/domain/subjectAuthority";

/**
 * The envelope predicates, tested against envelopes the resolver would never build.
 *
 * Two mutants survived the IR-104 run — the status check in `isEmptyEnvelope` and the operation
 * check in `explanationIsCandidate` — and the investigation found the same cause for both: the
 * resolver never produces an envelope where either could matter. It returns empty id lists for
 * `AMBIGUOUS` and `UNRESOLVED`, and populates only the list matching the operation, so both guards
 * are unreachable through the production path and no integration test could reach them either.
 *
 * They are worth keeping, because these are exported functions and their contract should hold for
 * any envelope, not only for the ones today's resolver happens to emit — a resolver change is
 * exactly when a silent hole would open. So the tests construct the envelopes directly. That makes
 * the guards reachable, testable and mutation-visible, which is the alternative to deleting them.
 *
 * No database: every input here is a literal.
 */

const envelope = (over: Partial<CandidateEnvelope>): CandidateEnvelope => ({
  query: "anything",
  status: "AUTHORIZED",
  operation: "REPORTED_OBSERVATION",
  seriesIds: [],
  causalEdgeIds: [],
  subjects: [],
  detail: "",
  ...over,
});

describe("an envelope is empty unless it is authorized", () => {
  it("treats AMBIGUOUS as empty even when ids are present", () => {
    // The resolver clears the lists on ambiguity. If it ever stopped doing so, this is the guard
    // that keeps a planner from being consulted about a question with two answers.
    expect(isEmptyEnvelope(envelope({ status: "AMBIGUOUS", seriesIds: ["a", "b"] }))).toBe(true);
  });

  it("treats UNRESOLVED as empty even when ids are present", () => {
    expect(isEmptyEnvelope(envelope({ status: "UNRESOLVED", causalEdgeIds: ["edge"] }))).toBe(true);
  });

  it("is empty when authorized but holding nothing", () => {
    expect(isEmptyEnvelope(envelope({}))).toBe(true);
  });

  it("is not empty when authorized and holding something", () => {
    expect(isEmptyEnvelope(envelope({ seriesIds: ["series"] }))).toBe(false);
  });
});

describe("membership requires the operation, not only the id", () => {
  it("refuses an explanation when the frame did not ask for a mechanism", () => {
    const reported = envelope({ operation: "REPORTED_OBSERVATION", causalEdgeIds: ["edge"] });
    expect(explanationIsCandidate("edge", reported)).toBe(false);
  });

  it("accepts an explanation when the frame did ask for one", () => {
    const mechanism = envelope({ operation: "STORED_MECHANISM", causalEdgeIds: ["edge"] });
    expect(explanationIsCandidate("edge", mechanism)).toBe(true);
    expect(explanationIsCandidate("other", mechanism)).toBe(false);
  });

  it("refuses a claim when the frame asked for a mechanism", () => {
    const mechanism = envelope({ operation: "STORED_MECHANISM", seriesIds: ["series"] });
    expect(claimIsCandidate("FACT", { seriesId: "series" }, mechanism)).toBe(false);
  });

  it("refuses a CALCULATION for a reported-fact request", () => {
    const reported = envelope({ seriesIds: ["series"] });
    expect(claimIsCandidate("CALCULATION", { seriesId: "series" }, reported)).toBe(false);
    expect(claimIsCandidate("FACT", { seriesId: "series" }, reported)).toBe(true);
  });

  it("refuses a claim whose evidence names no series", () => {
    const reported = envelope({ seriesIds: ["series"] });
    expect(claimIsCandidate("FACT", { premiseClaimIds: ["x"] }, reported)).toBe(false);
    expect(claimIsCandidate("FACT", null, reported)).toBe(false);
  });
});

describe("normalization is syntactic and nothing more", () => {
  it("folds case, punctuation, hyphens and spacing", () => {
    expect(normalizeSubject("Test-Output  Freight_Index")).toBe(
      normalizeSubject("test output freight index"),
    );
  });

  it("does not join tokens across removed punctuation", () => {
    // "AB" and "A-B" must stay different, or punctuation folding becomes a synonym table.
    expect(normalizeSubject("AB")).not.toBe(normalizeSubject("A-B"));
  });

  it("requires the whole stored name, at token boundaries", () => {
    expect(nameOccursIn("freight index", "the freight index rose")).toBe(true);
    expect(nameOccursIn("freight index", "the core freight index rose")).toBe(true);
    expect(nameOccursIn("core freight index", "the freight index rose")).toBe(false);
    // A partial token is not an occurrence.
    expect(nameOccursIn("freight", "airfreight rose")).toBe(false);
  });
});
