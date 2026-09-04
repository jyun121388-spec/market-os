import { describe, expect, it } from "vitest";
import {
  consumeRequestHeader,
  determinerOnlyFraming,
  regionIsExactlyFramingAndIdentity,
  relationSyntax,
} from "@/server/domain/subjectAuthority";

/**
 * Framing is a position in a construction, not membership in a bag.
 *
 * IR-107. `FRAMING_TOKENS` is position-insensitive, so
 * `regionIsExactlyFramingAndIdentity(region, name)` accepted ANY all-framing prefix -- an
 * existential over splits. `Explain how process A affects B.` therefore had two readings the grammar
 * could not choose between, and the repository chose. Measured at 57d242c against real PostgreSQL:
 * with only `A -> B` stored the sentence answered about `A`; with only `Process A -> B` stored, the
 * SAME sentence answered about `Process A`.
 *
 * The repair is ordered: the parser matches a request header at the START of the clause region and
 * consumes it, so the role that survives has no split left to choose. These tests are the parser
 * half. `tests/integration/framing-positional-authority.test.ts` holds the inventory-independence
 * property against a real repository, which is where the defect actually showed.
 *
 * ## What was rejected, and why it is recorded here
 *
 * The first design licensed kind nouns positionally: `process` counts as framing only after a
 * wh-determiner (`what process`), not after a complementizer (`explain how process`). The read-only
 * architect refuted it by construction and the refutation reproduces -- `What process affects B?`
 * makes `process` the interrogative subject, and that rule would have stripped it, leaving an empty
 * cause role. A test for it is at the bottom of this file so the rejected design cannot quietly
 * return.
 */

describe("consumeRequestHeader", () => {
  it("consumes the header only at the start of the region", () => {
    expect(consumeRequestHeader(" explain how process alpha ")).toEqual({
      header: "explain how",
      rest: " process alpha ",
    });
    // The same word later in the region is not a header. This is the positional half: without it,
    // a bag-based rule strips `explain` wherever it appears.
    expect(consumeRequestHeader(" alpha explain how ")).toEqual({
      header: "",
      rest: " alpha explain how ",
    });
  });

  it("prefers the longest header", () => {
    // `explain` alone would leave ` how alpha `, which no identity covers, so the request would
    // refuse for the wrong reason.
    expect(consumeRequestHeader(" explain how alpha ").header).toBe("explain how");
    expect(consumeRequestHeader(" how does alpha ").header).toBe("how does");
  });

  it("leaves an unrecognised opener in the role", () => {
    // Fail-closed, deliberately. An opener this table does not know is not silently discarded; it
    // stays in the role and fails to be covered, which refuses rather than guessing.
    expect(consumeRequestHeader(" kindly clarify how alpha ").header).toBe("");
  });

  it("does not consume a determiner", () => {
    // A stored name may begin with one. With `the` consumed, a repository holding `The Fed` would
    // stop matching a request that named it; left in the role, both `The Fed` and `Fed` are covered.
    expect(consumeRequestHeader(" explain how the fed ").rest).toBe(" the fed ");
  });
});

describe("determinerOnlyFraming", () => {
  it("accepts determiners and nothing else", () => {
    expect(determinerOnlyFraming(" the ")).toBe(true);
    expect(determinerOnlyFraming("")).toBe(true);
    // THE DEFECT, at the unit boundary. These three are in `FRAMING_TOKENS` and can each head an
    // identity: `Process A` is a different subject from `A`, and treating the word as discardable
    // is what let inventory pick between them.
    for (const kind of ["process", "mechanism", "procedure"]) {
      expect(determinerOnlyFraming(` ${kind} `), kind).toBe(false);
    }
  });

  it("covers a role behind a determiner but not behind a kind noun", () => {
    expect(
      regionIsExactlyFramingAndIdentity(" the policy rate ", "policy rate", determinerOnlyFraming),
    ).toBe(true);
    expect(
      regionIsExactlyFramingAndIdentity(" process alpha ", "alpha", determinerOnlyFraming),
    ).toBe(false);
    // And the identity that DOES account for the whole role is still covered.
    expect(
      regionIsExactlyFramingAndIdentity(" process alpha ", "process alpha", determinerOnlyFraming),
    ).toBe(true);
  });
});

describe("relation clause regions are header-free", () => {
  const causeOf = (query: string) => {
    const syntax = relationSyntax(query);
    return syntax.status === "ONE" ? syntax.clause.cause : `status=${syntax.status}`;
  };
  const headerOf = (query: string) => {
    const syntax = relationSyntax(query);
    return syntax.status === "ONE" ? syntax.clause.requestHeader : "-";
  };

  it.each([
    ["Explain how alpha affects beta.", " alpha ", "explain how"],
    ["Explain how process alpha affects beta.", " process alpha ", "explain how"],
    ["Explain how mechanism alpha affects beta.", " mechanism alpha ", "explain how"],
    ["Explain how procedure alpha affects beta.", " procedure alpha ", "explain how"],
    ["How does alpha affect beta?", " alpha ", "how does"],
    ["How do alpha affect beta?", " alpha ", "how do"],
    ["Explain how the policy rate affects beta.", " the policy rate ", "explain how"],
  ])("%s", (query, cause, header) => {
    expect(causeOf(query)).toBe(cause);
    expect(headerOf(query)).toBe(header);
  });

  it("keeps the prefix-marker construction placing the cause after its marker", () => {
    // The positive control the framing allowlist existed FOR. `what process` is consumed here by
    // the construction's own marker, structurally, and always was -- this repair must not disturb
    // it. If it broke, one wrong answer would have been traded for another.
    expect(causeOf("What process connects alpha to beta?")).toBe(" alpha ");
    expect(causeOf("What mechanism connects alpha to beta?")).toBe(" alpha ");
  });

  it("REJECTED DESIGN: a kind noun after a wh-determiner is the subject, not framing", () => {
    // The architect's refuting construction, reproduced. An earlier design licensed `process` as
    // framing whenever a wh-determiner preceded it, which would have emptied this cause role
    // entirely. `process` here is what is being ASKED ABOUT.
    expect(causeOf("What process affects beta?")).toBe(" what process ");
    expect(causeOf("What rate affects beta?")).toBe(" what rate ");
    // And neither is covered by an identity called `beta`, so both refuse rather than publishing.
    expect(
      regionIsExactlyFramingAndIdentity(" what process ", "process", determinerOnlyFraming),
    ).toBe(false);
  });

  it("still denies a qualified relation", () => {
    // The anchor Terra warned about. Consuming the header must not cost the evidence that something
    // qualifies the verb: the residue is still in the role, so cover still refuses.
    for (const query of [
      "Explain how alpha may affect beta.",
      "Explain how alpha does not affect beta.",
      "Explain how alpha never affects beta.",
    ]) {
      const syntax = relationSyntax(query);
      const denied =
        syntax.status !== "ONE" ||
        syntax.clause.polarity === "NEGATED" ||
        !regionIsExactlyFramingAndIdentity(syntax.clause.cause, "alpha", determinerOnlyFraming);
      expect(denied, query).toBe(true);
    }
  });

  it("still reads a negated noun-phrase construction as negated", () => {
    const syntax = relationSyntax("There is not an impact of alpha on beta.");
    expect(syntax.status).toBe("ONE");
    expect(syntax.status === "ONE" && syntax.clause.polarity).toBe("NEGATED");
  });
});
