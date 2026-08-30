import { describe, expect, it } from "vitest";
import { resolveRequestAuthority, OPERATION_CONTRACTS } from "@/server/domain/requestAuthority";

/**
 * A definitional request is one term asked about as a term, with no other operation's operand.
 *
 * MARKET-DEFINITION-GRAMMAR-001. `CONSTRUCTIONS` carried four DEFINITION rows and recognised 9 of
 * the corpus's 60 definitional requests. `What is real GDP?` failed on a missing article, which is
 * not a distinction anyone asking the question is making.
 *
 * These are the invariants, not a list of the strings that happened to be in the corpus. The
 * negative half is the important half: the first version of this grammar recognised five more
 * definitions AND coerced seven rows that are not definitions, four of them negative controls the
 * corpus says must be refused. A count of the intended gains could not have shown that; the
 * whole-corpus transition matrix did.
 */

const operationOf = (query: string) => {
  const a = resolveRequestAuthority(query);
  return a.status === "AUTHORIZED" ? a.operation : a.status;
};

describe("what makes a request definitional", () => {
  it("recognises a bare term, with or without an article", () => {
    // The article was the whole difference between these two before this unit.
    expect(operationOf("What is a Eurodollar?")).toBe("DEFINITION");
    expect(operationOf("What is real GDP?")).toBe("DEFINITION");
    expect(operationOf("What is the Herfindahl-Hirschman Index?")).toBe("DEFINITION");
  });

  it("recognises a metalinguistic head taking the term as its complement", () => {
    // `the meaning of X` and `meant by X` cite X AS a term. They are the only heads allowed a
    // prepositional complement, because that is exactly what a definitional request looks like.
    expect(operationOf("What is meant by 'basis risk'?")).toBe("DEFINITION");
    expect(operationOf("What is the meaning of 'carry trade'?")).toBe("DEFINITION");
  });

  it("recognises an intransitive predicate over one named thing", () => {
    // What a term IS, phrased as what it DOES. One subject and no relation, so there is nothing
    // for a mechanism to be between.
    expect(operationOf("How does a repurchase agreement work?")).toBe("DEFINITION");
  });
});

describe("what must NOT become a definition", () => {
  it("refuses a head noun that takes the term as a complement", () => {
    // THE DISCRIMINATOR, and every one of these was coerced by the first version of the grammar.
    // `the level OF x` asks what x is at; `real GDP` IS x.
    expect(operationOf("What's the going level of the VIX?")).not.toBe("DEFINITION");
    expect(operationOf("What is the published view on Brent crude?")).not.toBe("DEFINITION");
    expect(operationOf("What is the reported figure for global oil demand?")).not.toBe(
      "DEFINITION",
    );
    expect(operationOf("What is the weather in Seoul tomorrow?")).not.toBe("DEFINITION");
  });

  it("refuses an under-specified mechanism question", () => {
    // Corpus negative control. Names one endpoint and asks for "the mechanism", which does not say
    // a mechanism between what and what.
    expect(operationOf("What is the mechanism for the policy rate?")).not.toBe("DEFINITION");
  });

  it("refuses a second term hiding in the predicate's tail", () => {
    // Corpus negative control, and the reason the tail is tested with the same rule as the head:
    // taking the subject before `work` and discarding `with inflation` turned a refusal into an
    // authorized definition of the first term.
    expect(operationOf("How does the unemployment rate work with inflation?")).not.toBe(
      "DEFINITION",
    );
  });

  it("refuses a calculation over two named things", () => {
    // REVIEW FINDING, and a real regression this unit introduced: `What is EBITDA minus capex?`
    // became a definition of something. It asks for a result computed from two subjects, which is
    // neither a definition nor an operation this product performs.
    expect(operationOf("What is EBITDA minus capex?")).not.toBe("DEFINITION");
    expect(operationOf("What is revenue plus other income?")).not.toBe("DEFINITION");
  });

  it("leaves every other operation to its own construction", () => {
    // Definitional recognition is last-resort: it runs only when nothing else recognised the span,
    // so it cannot outrank an operation or make a request ambiguous.
    expect(operationOf("What is the current US headline CPI?")).toBe("CURRENT_OBSERVATION");
    expect(operationOf("Explain how oil prices affect headline CPI.")).toBe("STORED_MECHANISM");
    expect(operationOf("What did analysts publish about US nonfarm payrolls?")).toBe(
      "ATTRIBUTED_REPORTED_OBSERVATION",
    );
  });

  it("does not rescue a prohibited request that mentions a term", () => {
    // PROHIBITED-PURPOSE PRECEDENCE. A definitional wrapper must not launder a personalized
    // directive, an allocation request, a prediction demand or a guarantee.
    for (const query of [
      "What is a covered call and should I sell one on my Apple position?",
      "What is dollar cost averaging? Tell me how much to put in each month.",
      "What is a stop loss and where exactly should I set mine?",
      "What is the S&P 500 going to close at tomorrow?",
    ]) {
      expect(operationOf(query), query).not.toBe("DEFINITION");
    }
  });
});

describe("a definition never reaches a planner", () => {
  it("declares DEFINITION planner-forbidden in the contract", () => {
    // Success for this unit is canonical recognition with ZERO planner calls, and the authority for
    // that is the contract rather than anything the grammar asserts. Preserving a legacy planner
    // call for a deterministic operation would not be capability.
    expect(OPERATION_CONTRACTS.DEFINITION.plannerPermitted).toBe(false);
  });
});

describe("declared limitations of this grammar", () => {
  it.fails("PENDING: a lexicalized term that contains a preposition", () => {
    // OPEN, PRE-EXISTING, and NOT closed by this unit. Named by review as P1 and reproduced.
    //
    // `return on equity`, `proof of stake` and `cash flow from operations` are single financial
    // terms that happen to contain a preposition, and the discriminator that keeps `the level OF
    // the VIX` out cannot tell them apart from it. Membership in a preposition set says nothing
    // about whether the word is a complement or part of a name; separating the two needs a term
    // lexicon, which is a different unit.
    //
    // Not a regression. The previous grammar recognised DEFINITION through four literals --
    // ` definition of `, ` what is a `, ` what is an `, ` what does … mean ` -- and matched none of
    // these either, so they were UNSUPPORTED before this change and remain so.
    //
    // The set is also a SUBSET of the prepositions, so the behaviour is inconsistent rather than
    // uniformly strict: `What is value at risk?` and `What is earnings per share?` are recognised
    // because `at` and `per` are absent from it. Pinned executable so the inconsistency is visible
    // rather than described.
    expect(operationOf("What is return on equity?")).toBe("DEFINITION");
  });

  it("is inconsistent in a way worth seeing, not hiding", () => {
    // The other half of the same limitation, asserted as it actually behaves.
    expect(operationOf("What is value at risk?")).toBe("DEFINITION");
    expect(operationOf("What is earnings per share?")).toBe("DEFINITION");
  });

  it.fails("PENDING: definitional constructions this family does not yet cover", () => {
    // Review's answer 1, reproduced. The frames are finite, so a construction outside them is
    // UNSUPPORTED rather than guessed at -- which is the safe direction, and still a gap.
    expect(operationOf("Could you define convexity?")).toBe("DEFINITION");
  });
});
