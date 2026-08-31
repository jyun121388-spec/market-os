import { describe, expect, it } from "vitest";
import {
  OPERATION_CONTRACTS,
  REQUEST_OPERATIONS,
  resolveRequestAuthority,
  __resetSpanEvaluationsForTest,
  __spanEvaluationsForTest,
} from "@/server/domain/requestAuthority";

/**
 * Positive request authority: what kind of answer is being asked for, decided before anything is
 * looked up.
 *
 * IR-107 measured the gate this replaces — 1 of 104 answerable requests admitted, both labels
 * wrong at once. These hold the contract that replaces it, and the property that matters most is
 * the one that is easiest to lose: **absence of a prohibition authorizes nothing.**
 *
 * No database and no model. Recognition is a fact about the sentence, and inventory must never
 * decide what a sentence meant.
 */

const authorize = (query: string) => resolveRequestAuthority(query);

/**
 * REPOINTED by ESC-015 item 4: prohibited authority dominates the whole request, so there is no
 * informational constituent to inspect any more. The helper now proves the stronger property --
 * the request is refused and NOTHING is carried alongside the refusal.
 *
 * The cases below were written to check that a constituent was clean. They are kept because each
 * one is a reproduced P1, and "no payload exists" subsumes "the payload is clean".
 */
const servesNothing = (query: string) => {
  const a = authorize(query);
  expect(a.status, query).toBe("PROHIBITED");
  expect(Object.keys(a), query).toEqual(["status", "detail"]);
  return undefined as undefined;
};

describe("the operation set is closed", () => {
  it("names exactly five operations", () => {
    expect([...REQUEST_OPERATIONS]).toEqual([
      "CURRENT_OBSERVATION",
      "OBSERVED_CHANGE",
      "STORED_MECHANISM",
      "ATTRIBUTED_REPORTED_OBSERVATION",
      "DEFINITION",
    ]);
  });

  it("gives every operation a contract that declares what it needs", () => {
    for (const operation of REQUEST_OPERATIONS) {
      const contract = OPERATION_CONTRACTS[operation];
      expect(contract.operation).toBe(operation);
      expect([1, 2]).toContain(contract.subjectCardinality);
      expect(contract.recordClass).toBeTruthy();
      expect(["LATEST", "INTERVAL", "NONE"]).toContain(contract.temporalOperands);
      expect(typeof contract.requiresAttribution).toBe("boolean");
      expect(typeof contract.deterministic).toBe("boolean");
      expect(typeof contract.plannerPermitted).toBe("boolean");
    }
  });

  it("permits no planner for the operations repository code can answer alone", () => {
    // Capability does not imply a model is needed. A current level and a computed change are
    // deterministic repository output, and the safest version of them consults no sink at all.
    expect(OPERATION_CONTRACTS.CURRENT_OBSERVATION.plannerPermitted).toBe(false);
    expect(OPERATION_CONTRACTS.OBSERVED_CHANGE.plannerPermitted).toBe(false);
    expect(OPERATION_CONTRACTS.DEFINITION.plannerPermitted).toBe(false);
    expect(OPERATION_CONTRACTS.CURRENT_OBSERVATION.deterministic).toBe(true);
    expect(OPERATION_CONTRACTS.OBSERVED_CHANGE.deterministic).toBe(true);
  });
});

describe("recognition is required, not assumed", () => {
  it("authorizes a request that names one operation and its subject", () => {
    const a = authorize("What is the current US headline CPI?");
    expect(a.status).toBe("AUTHORIZED");
    if (a.status === "AUTHORIZED") {
      expect(a.operation).toBe("CURRENT_OBSERVATION");
      expect(a.subjectRegion).toContain("us headline cpi");
    }
  });

  it("refuses a request that names no operation at all", () => {
    // A bare subject says which thing, never which question about it. This is a real capability
    // loss — the /ask box used to answer a bare topic with a factor list — and it is the direct
    // cost of requiring the request to say what it wants.
    expect(authorize("US headline CPI").status).toBe("UNSUPPORTED");
    expect(authorize("Widget Price Index").status).toBe("UNSUPPORTED");
  });

  it("refuses a request whose shape it has never seen", () => {
    expect(authorize("Why did the market do that yesterday?").status).toBe("UNSUPPORTED");
    expect(authorize("Rank every European economy by growth.").status).toBe("UNSUPPORTED");
  });

  it("is ambiguous when a request reads as two operations", () => {
    const a = authorize("What is the current change in US headline CPI this year?");
    expect(a.status).toBe("AMBIGUOUS");
  });

  /**
   * Two readings of the SAME operation are still two readings.
   *
   * The collapse keyed on operation alone and then took the first match, so a second question could
   * hide inside the first's trailing subject region:
   *
   *     "What is the current Acme? What about latest Beta?"
   *     -> AUTHORIZED, CURRENT_OBSERVATION, subject "acme what about latest beta"
   *
   * ` current ` and ` latest ` are both CURRENT_OBSERVATION constructions, so the operation set had
   * one element and nothing objected. This is `there are no halves` failing where both halves are
   * the same kind of half: the coordinator list catches `and latest Beta`, and nothing caught
   * `? What about`. Found through the constituent path, but it was never confined to it -- this is
   * the ordinary parser answering a two-question request as one.
   *
   * The Korean path has always keyed on operation AND subject. This is that rule where it was
   * missing.
   */
  it("is ambiguous when a request reads as two of the SAME operation", () => {
    const a = authorize("What is the current Acme? What about latest Beta?");
    expect(a.status).toBe("AMBIGUOUS");
  });

  /**
   * CORRECTED. This asserted that `What is the current latest Acme?` is AMBIGUOUS, and I called
   * that "defensible and fail-closed" without checking whether it was a request a person would
   * write. Review called it an availability defect and was right: two markers of ONE operation
   * describing one subject is redundancy, not a second question.
   *
   * Review's repair -- canonicalise the subject before serving it -- is NOT what is implemented,
   * and the reason is measured. `What is the current current account balance?` authorizes today
   * with the subject `current account balance`, which is the stored name. Canonicalising the served
   * subject would cut it to `account balance` and delete a word the reader wrote. The two inputs
   * are structurally identical -- a marker, then a span beginning with another marker word -- so a
   * rule that fixes one by rewriting the subject breaks the other.
   *
   * So canonicalisation is used ONLY as the comparison key, and the subject served stays the raw
   * region of the first match. Both requests authorize; neither subject is rewritten.
   */
  it("authorizes when two markers of one operation describe the same subject", () => {
    const a = authorize("What is the current latest Acme?");
    expect(a.status).toBe("AUTHORIZED");
  });

  it("keeps a marker word that belongs to the stored name", () => {
    const a = authorize("What is the current current account balance?");
    expect(a.status).toBe("AUTHORIZED");
    expect(a.status === "AUTHORIZED" && a.subjectRegion).toContain("current account balance");
  });

  it("is ambiguous when the SAME construction introduces two different subjects", () => {
    // The case the previous repair missed entirely: two different constructions produced two
    // readings and were caught, while the same construction twice produced one reading, because
    // recognition found only its FIRST occurrence.
    const a = authorize("What is the current Acme? What is the current Beta?");
    expect(a.status).toBe("AMBIGUOUS");
  });
});

describe("there are no halves", () => {
  /**
   * The structural answer to "a factual clause must never rescue a personalized directive". Rather
   * than detect the directive — detection is what failed here three times — the whole request must
   * parse as one operation. A second clause is unread text, and unread text refuses.
   */
  it("refuses a factual request with a directive attached, without reading the directive", () => {
    for (const query of [
      "Tell me the current gold price, then decide how many ounces I should buy.",
      "What is the current unemployment rate and tell me which sectors to short?",
      "What is the current US headline CPI and rebalance my portfolio?",
    ]) {
      const a = authorize(query);
      expect(a.status).not.toBe("AUTHORIZED");
    }
  });

  it("names the unread content rather than ignoring it", () => {
    // This asked about "the current gold price and my mortgage decision", which the pronoun rule
    // refuses as PROHIBITED before unread residue is ever computed -- so the detail assertion,
    // guarded on UNSUPPORTED, never ran and the test passed with its own subject deleted.
    // Adversarial review found it. A pronoun-free residue, and the assertion is unconditional.
    const a = authorize("Urgently, what is the current gold price?");
    expect(a.status).toBe("UNSUPPORTED");
    expect(a.status === "UNSUPPORTED" && a.detail).toContain("beyond the operation");
  });
});

describe("prohibited purpose has precedence", () => {
  it("refuses a personalized decision request", () => {
    for (const query of [
      "Should I buy Samsung right now?",
      "How much of my savings should go into bonds?",
      "Where should I set my stop-loss?",
    ]) {
      expect(authorize(query).status).toBe("PROHIBITED");
    }
  });

  it("does not let a recognised operation rescue a prohibited request", () => {
    // A request can be perfectly well formed as a current-level lookup and still be asking to be
    // told what to do. Two independent rules refuse this one, the advice screen and the pronoun in
    // the subject, and mutation showed the pronoun rule is what actually decides it -- so the
    // precedence claim is proven separately, below, rather than assumed here.
    const a = authorize("What is the current price of the stock I should buy?");
    expect(a.status).toBe("PROHIBITED");
  });

  /**
   * The constituent must be the clause the reader wrote, not a prefix of it.
   *
   * A prohibited request carries the one informational operation it also named, so that a redirect
   * can answer THAT rather than searching the raw string. Which substring becomes the constituent
   * is therefore a claim about what was asked, and it has to be exact.
   *
   * The clause splitter treated `.` as a sentence terminator, so `... Acme Inc. revenue?` was cut
   * after the company suffix. Review reported the symptom as "nothing is published"; measured, that
   * is not what happens and the truth is worse to detect: the leading fragment
   * `What is the current Acme Inc.` PARSES ON ITS OWN, so a constituent attaches and publishes --
   * with a subject the reader did not ask about. Same company, same rows, different question.
   *
   * That is why this is asserted on the SUBJECT REGION and not on published records. An integration
   * test comparing figures cannot see it, because both subjects resolve to the same company; it was
   * written that way first and a mutation restoring the period boundary survived it.
   */
  const constituentOf = servesNothing;

  /**
   * Punctuation inside a NAME must not end the clause, and no punctuation set gets this right.
   *
   * Two boundary sets were tried and both were refuted by a real input. `[.?!;]` cut
   * `... Acme Inc. revenue?` after the company suffix. Narrowing to `[?!;]` fixed that and came
   * with the claim that those three "end a sentence and end nothing else" -- refuted by
   * `Yahoo! Finance` and `Smith; Jones`. Any character that can end a sentence can also sit inside
   * a name, so the boundaries are now CANDIDATES and the recogniser considers every contiguous run
   * of them, keeping only maximal runs that authorize.
   *
   * Each case below is a fragment that authorizes ON ITS OWN with a SHORTER subject, which is what
   * makes them dangerous: the request is answered, plausibly, about something else. The assertion
   * is therefore on the subject region and not on any published record.
   */
  it.each([
    ["company suffix", "Should I buy stock? What is the current Acme Inc. revenue?", "revenue"],
    [
      "exclamation in a name",
      "Should I buy stock? What is the definition of Yahoo! Finance?",
      "finance",
    ],
    [
      "semicolon in a name",
      "Should I buy stock? What is the current Smith; Jones revenue?",
      "jones",
    ],
  ])("publishes nothing for a directive alongside %s", (_label, query) => {
    // Was: the informational constituent must carry the whole name across the punctuation. The
    // name-boundary property these inputs were built for is now tested on the NEUTRAL forms in
    // "still authorizes"; here the directive dominates and nothing is served at all.
    servesNothing(query);
  });

  it("still fails closed when two informational clauses are named", () => {
    // Maximality resolves over-splitting, not genuine ambiguity: these are two separate maximal
    // runs, neither containing the other, and choosing would invent which was meant.
    expect(
      constituentOf("Should I buy X? What is the current Acme? What is the definition of Acme?"),
    ).toBeUndefined();
  });

  it("carries nothing for a bare directive", () => {
    expect(constituentOf("Should I buy Acme?")).toBeUndefined();
  });

  /**
   * Two requests of the SAME operation must not be joined into one.
   *
   * Reuniting an over-split name means preferring a longer run, and that preference cannot be
   * unconditional. Here both clauses authorize alone AND the joined run authorizes too -- as one
   * `CURRENT_OBSERVATION` whose subject has swallowed the second construction. Preferring the
   * longer run answered neither question and invented a third.
   *
   * The ambiguity test above missed this because it used two DIFFERENT operations, which the
   * grammar rejects as ambiguous on its own -- so it passed without the rule it was meant to check.
   * Same operation is the case that needed the rule.
   */
  it("fails closed on two requests of the same operation rather than joining them", () => {
    expect(
      constituentOf("Should I buy stock? What is the current Acme? What is the current Beta?"),
    ).toBeUndefined();
  });

  /**
   * A constituent must account for EVERY informational construction in the request.
   *
   * Disjointness rejects a compound whose clauses each authorize alone. It cannot see one whose
   * second clause does NOT authorize alone, and that is the gap review found:
   *
   *     "Should I buy stock? What is the current Acme? What about latest Beta?"
   *
   * `What about latest Beta?` is not a complete operation -- `about` is unread -- so it never enters
   * the authorizing set, and the first question was attached while the second vanished. Answering
   * one of two questions is choosing which was meant.
   *
   * So the text outside the chosen run is checked for construction MARKERS rather than for
   * authorizations: a marker out there means another request is present, complete or not.
   */
  it.each([
    [
      "a second clause that does not authorize alone",
      "Should I buy stock? What is the current Acme? What about latest Beta?",
    ],
    [
      "three constructions, one complete",
      "Should I buy stock? What is the current Acme? What about latest Beta? What about most recent Gamma?",
    ],
  ])("publishes nothing when a construction sits outside the constituent (%s)", (_l, query) => {
    expect(constituentOf(query)).toBeUndefined();
  });

  /**
   * Two MAXIMAL runs that partially overlap, which is the only case the exactly-one-run count
   * decides alone.
   *
   * This mutant (M-CON-2) survived the whole suite and I twice reasoned about it instead of
   * measuring: first "the outside-construction check makes the count redundant", then "I cannot
   * construct an overlap, so keep the guard as untested". Review rejected both -- absence of a
   * hand-built example is not evidence -- and required a generated property. `scripts/
   * search-overlapping-runs.ts` enumerates every ordered fragment combination from a pool and looks
   * for the three conditions that make the count load-bearing at once:
   *
   *   1. the WHOLE query does not authorize   (or recognition returns it and never reaches runs)
   *   2. two maximal runs partially overlap    ([0..1] and [1..2], neither containing the other)
   *   3. the outside-construction check would not catch the survivor
   *
   * 120 such cases exist. Condition 1 is the one hand analysis kept missing: the first overlap the
   * search produced was decided by the early return, because the attribution parser claimed the
   * entire string.
   *
   * Why the outside check is blind here: both runs are MECHANISMS, and relations are recognised by
   * `relationSyntax`, not by a `CONSTRUCTIONS` marker. There is nothing for a marker scan to find.
   */
  it("publishes nothing when two maximal runs partially overlap", () => {
    expect(
      constituentOf(
        "Should I buy stock? Explain how Alpha affects Beta? Zeta? Explain how Alpha affects Beta?",
      ),
    ).toBeUndefined();
  });

  it("refuses to enumerate an unbounded number of candidate fragments", () => {
    // Run enumeration is quadratic in fragments and parses every run, and nothing upstream bounds
    // the query. Past the cap the answer is "no constituent", which is the same answer any
    // unreadable request gets -- fail closed rather than expensive. Asserted behaviourally: this
    // input contains exactly ONE recognisable clause and would otherwise attach it.
    const many = `Should I buy stock? ${"A. ".repeat(20)}What is the current Acme?`;
    expect(constituentOf(many)).toBeUndefined();
  });
});

describe("an imperative is not a decision request", () => {
  /**
   * `REQUEST_DIRECTIVE` fires on imperative phrasing, and asking politely is imperative. IR-107
   * measured eleven ordinary requests refused as directives. A complete operation parse is positive
   * evidence that information was wanted, which is exactly the proof of purpose that the absence of
   * a prohibition cannot supply — so the directive frame refuses only what does not parse.
   */
  it("admits a polite imperative that parses as one operation", () => {
    const a = authorize("Show me the current UK policy rate.");
    expect(a.status).toBe("AUTHORIZED");
    if (a.status === "AUTHORIZED") expect(a.operation).toBe("CURRENT_OBSERVATION");
  });

  it("still refuses a directive that does not parse as an operation", () => {
    // Refused as UNSUPPORTED rather than PROHIBITED: neither the advice detector nor the directive
    // frame recognises this shape, so what stops it is that it parses as no operation. Still
    // refused, and the wrong-reason half is IR-107 axis 2, recorded and not yet closed.
    const a = authorize("Build me a low-risk portfolio that cannot lose money.");
    expect(a.status).not.toBe("AUTHORIZED");
    expect(a.status).toBe("UNSUPPORTED");
  });
});

describe("operands are required, not guessed", () => {
  it("refuses a change request that does not say over what period", () => {
    const a = authorize("How much has US headline CPI changed?");
    expect(a.status).toBe("AMBIGUOUS");
    if (a.status === "AMBIGUOUS") expect(a.detail).toContain("over what period");
  });

  it("accepts a change request that supplies an interval", () => {
    const a = authorize("How much has US headline CPI changed this year?");
    expect(a.status).toBe("AUTHORIZED");
    if (a.status === "AUTHORIZED") expect(a.operation).toBe("OBSERVED_CHANGE");
  });

  it("refuses an attributed report that does not say whose report it is", () => {
    // The source binds as tightly as the subject: a question about what analysts said must not be
    // answered from an observation nobody attributed to them.
    const a = authorize("What was published about US headline CPI?");
    expect(a.status).not.toBe("AUTHORIZED");
  });

  it("accepts an attributed report that names the source", () => {
    const a = authorize("What did analysts publish about US headline CPI?");
    expect(a.status).toBe("AUTHORIZED");
    if (a.status === "AUTHORIZED") {
      expect(a.operation).toBe("ATTRIBUTED_REPORTED_OBSERVATION");
      expect(a.contract.requiresAttribution).toBe(true);
    }
  });
});

describe("the mechanism operation is delegated, not re-derived", () => {
  it("recognises a relation request through the relation parser", () => {
    // `subjectAuthority.relationSyntax` already reads direction, polarity and cardinality, proven
    // across IR-105 and IR-106. A second grammar for the same sentences would be a second answer
    // to one question — and the first version of this asked the narrow frame classifier instead,
    // which is exactly the pattern list this unit exists to stop depending on.
    const a = authorize("Explain how alpha affects beta.");
    expect(a.status).toBe("AUTHORIZED");
    if (a.status === "AUTHORIZED") expect(a.operation).toBe("STORED_MECHANISM");
  });

  it("refuses a relation whose direction the parser cannot establish", () => {
    const a = authorize("Explain how alpha and beta are related.");
    expect(a.status).not.toBe("AUTHORIZED");
  });

  it("refuses a denied relation", () => {
    const a = authorize("Explain how alpha does not affect beta.");
    expect(a.status).not.toBe("AUTHORIZED");
  });
});

describe("no operation is exempt from the whole-request discipline", () => {
  /**
   * Adversarial review, P0. The mechanism branch returned an AUTHORIZED verdict the moment
   * `relationSyntax` found one affirmed clause -- before the pronoun rule, the coordinator bound
   * and the unread check. Delegation was right; returning past the shared discipline was not.
   *
   * Recognising a relation says the request has a relation in it. It does not say the relation is
   * the whole request, and every other operation already has to prove that.
   */
  it("refuses a relation request whose effect region is about the reader", () => {
    expect(
      authorize("Explain how inflation affects the right investment for my retirement.").status,
    ).toBe("PROHIBITED");
    expect(authorize("Explain how inflation affects how much I should hold in bonds.").status).toBe(
      "PROHIBITED",
    );
  });

  it("refuses a relation request with a directive coordinated onto it", () => {
    expect(
      authorize("Explain how the policy rate affects mortgage costs, then pick my lender.").status,
    ).not.toBe("AUTHORIZED");
  });

  it("still authorizes a relation request that is only a relation request", () => {
    // The repair must not cost the capability. Both of these are what the operation is for.
    expect(authorize("Explain how alpha affects beta.").status).toBe("AUTHORIZED");
    expect(
      authorize("What mechanism connects the freight index to the shipping cost?").status,
    ).toBe("AUTHORIZED");
  });
});

describe("inventory never decides what a sentence meant", () => {
  it("resolves the same way whatever the repository happens to hold", () => {
    // No database is consulted here at all, which is the strongest form of the property: a request
    // that names no operation is unsupported whether or not a perfect record exists for it.
    expect(authorize("Widget Price Index").status).toBe("UNSUPPORTED");
    expect(authorize("What is the current Widget Price Index?").status).toBe("AUTHORIZED");
  });
});

describe("each refusing layer decides something no other layer decides", () => {
  /**
   * Every test below exists because a mutation survived. Six of eleven mutants died against the
   * suite above; five lived, and all five lived the same way — two layers happened to agree on
   * every query anyone had written, so removing either changed no result. Agreement is not
   * redundancy proof, it is the absence of a discriminating case.
   */

  it("prohibits an advice request that carries no personal pronoun", () => {
    // Killed nothing before: "Should I buy Samsung?" is caught by the pronoun rule as well, so the
    // advice screen could be deleted outright and the prohibited tests still passed. These name no
    // reader at all, and without the screen they would be merely UNSUPPORTED — refused, but for a
    // reason that would let a later capability admit them.
    expect(authorize("Buy gold now.").status).toBe("PROHIBITED");
    expect(authorize("Sell the whole position today.").status).toBe("PROHIBITED");
  });

  it("lets the advice screen outrank a complete operation parse", () => {
    // The precedence claim, isolated: the second clause is a textbook CURRENT_OBSERVATION, and the
    // verdict is still PROHIBITED rather than the UNSUPPORTED that unread content would give.
    expect(authorize("Buy gold now. What is the current gold price?").status).toBe("PROHIBITED");
  });

  /**
   * AMENDED 2026-08-27, input only -- the property is unchanged and still proven.
   *
   * This used `Rebalance the portfolio. What is the current gold price?`, which the PERIOD makes two
   * fragments. Once a confirmed clause boundary blocks the joined run, no complete tiling exists and
   * the request is refused by the tiling layer before the unread-residue layer is ever consulted:
   * still UNSUPPORTED, but with the generic message instead of one naming the unread words.
   *
   * The residue layer is NOT dead, and that was measured before touching this test: the comma form
   * below is one fragment, reaches the residue check, and names `rebalance`, `portfolio`. So the
   * input moves and the assertion stays exactly as strong. The two-fragment form is kept
   * immediately after, asserting refusal, so the behaviour is pinned in both layers.
   */
  it("refuses a directive standing in front of a valid operation, without detecting the directive", () => {
    // Unread residue alone, with no coordinator in the subject and no advice vocabulary matched.
    // This is the property IR-107 was built for: what stops the request is that nothing read it.
    const a = authorize("Rebalance the portfolio, what is the current gold price?");
    expect(a.status).toBe("UNSUPPORTED");
    expect(a.status === "UNSUPPORTED" && a.detail).toContain("beyond the operation");
  });

  it("also refuses that directive when punctuation splits it into two fragments", () => {
    // Same request, refused by a different layer. Only the status is asserted: which layer owns a
    // refusal is an implementation fact, and pinning the message here would make the test fail for
    // a reason that is not about safety.
    expect(authorize("Rebalance the portfolio. What is the current gold price?").status).not.toBe(
      "AUTHORIZED",
    );
  });

  it("refuses an unread modifier that is not a directive at all", () => {
    const a = authorize("Quickly, what is the current gold price?");
    expect(a.status).toBe("UNSUPPORTED");
    expect(a.status === "UNSUPPORTED" && a.detail).toContain("quickly");
  });

  /**
   * The coordinator bound and the two-readings rule catch the same SHAPE by different evidence, and
   * this pair keeps both honest about which decides what.
   *
   * This test used to use `What is the current US headline CPI, and also the current UK policy
   * rate?` to prove the coordinator was the only layer that could see it. That stopped being true:
   * two ` current ` markers make two readings, and the readings rule now refuses it first with a
   * message that names the actual problem. The coordinator layer is NOT thereby dead -- measured,
   * a single-reading coordination still reaches only it -- so the input moved rather than the test
   * being deleted.
   */
  it("refuses a coordinated second subject that produces only ONE reading", () => {
    // One ` current `, so the readings rule sees a single reading and says nothing. The subject
    // region runs to end-of-sentence and swallows "the silver price", leaving no unread text. Only
    // the coordinator bound can refuse this, which is what makes it load-bearing.
    const a = authorize("What is the current gold price and the silver price?");
    expect(a.status).toBe("UNSUPPORTED");
    expect(a.status === "UNSUPPORTED" && a.detail).toContain("another clause");
  });

  it("refuses two coordinated operations as AMBIGUOUS once both are readable", () => {
    const a = authorize(
      "What is the current US headline CPI, and also the current UK policy rate?",
    );
    expect(a.status).toBe("AMBIGUOUS");
    expect(a.status === "AMBIGUOUS" && a.detail).toContain("more than one");
  });
});

describe("an operand is a constituent, not a substring", () => {
  /**
   * Architecture review, IR-107 Unit 2. The interval was found by searching the whole request, so
   * a temporal word inside the subject's own NAME satisfied the requirement that a period be
   * stated. The request stated no period and was authorized as though it had.
   *
   * The bound is positional and adds no vocabulary: an adjunct sits at an edge of the clause. With
   * subject material on both sides of it, it is part of a name.
   */
  it("refuses a change request whose only temporal words are inside the subject's name", () => {
    const a = authorize("What is the change in Last Year Holdings?");
    expect(a.status).not.toBe("AUTHORIZED");
    expect(a.status).toBe("AMBIGUOUS");
  });

  it("accepts a trailing interval and does not leave it inside the subject", () => {
    const a = authorize("What is the change in US GDP last year?");
    expect(a.status).toBe("AUTHORIZED");
    if (a.status === "AUTHORIZED") {
      expect(a.operation).toBe("OBSERVED_CHANGE");
      // One piece of the request cannot be two constituents at once.
      expect(a.subjectRegion.trim()).toBe("us gdp");
    }
  });
});

describe("request mood is not evidence of prohibited purpose", () => {
  /**
   * The development corpus measured 44 legitimate requests accused of asking for personalized
   * advice, across all five operations, for one reason: nothing was recognised and the phrasing was
   * imperative. Asking politely is imperative. Conflating mood with purpose is the same
   * substitution, one level up, that this unit exists to remove — and it is now 5.
   */
  it("calls an unrecognised imperative unsupported, not prohibited", () => {
    const a = authorize("Give me the figure for Korea's headline consumer price index.");
    expect(a.status).toBe("UNSUPPORTED");
  });

  it("prohibits a request about something the reader owns, even with nothing recognised", () => {
    // The other direction of the same taxonomy error: refused as UNSUPPORTED, which says "not yet"
    // about something that must never be. A possessive determiner attaches to a noun phrase and
    // makes that noun the reader's.
    expect(authorize("What is my average cost basis on Apple?").status).toBe("PROHIBITED");
    expect(authorize("How much cash is sitting in my brokerage account?").status).toBe(
      "PROHIBITED",
    );
  });

  it("does not treat being spoken to as owning something", () => {
    // "me" is who is being told, not whose CPI it is. Accusative and dative first person say
    // nothing about possession, and scanning pronouns without that distinction would refuse every
    // polite request in the corpus.
    expect(authorize("Show me CPI").status).not.toBe("PROHIBITED");
    expect(authorize("Show me the current gold price.").status).toBe("AUTHORIZED");
  });
});

describe("attribution is three bound roles, not eight constructions", () => {
  /**
   * IR-107 Unit 2. This operation had eight construction rows — publish/report crossed with
   * about/for — and a six-name source list searched anywhere in the request. The ninth row was
   * always going to be "said about", and the live hole was exactly that sentence.
   *
   * SOURCE and SUBJECT are open classes; no closed set contains every organisation or every series.
   * So the grammar binds them by POSITION and reads whatever is there, which DELETED the source
   * list rather than extending it. The reporting ACT stays a declared lexicon, deliberately,
   * because it is the one role where being wrong authorizes something.
   */
  it("authorizes the shape that used to reach a planner with no operation", () => {
    const a = authorize("What did analysts say about the Test Output freight index?");
    expect(a.status).toBe("AUTHORIZED");
    if (a.status === "AUTHORIZED") {
      expect(a.operation).toBe("ATTRIBUTED_REPORTED_OBSERVATION");
      expect(a.subjectRegion.trim()).toBe("the test output freight index");
    }
  });

  it("reads a source it has never been told about", () => {
    // The point of a slot: no vocabulary was added for either of these.
    expect(authorize("What did Goldman Sachs say about US inflation?").status).toBe("AUTHORIZED");
    expect(authorize("What did the Bank of Korea publish about household debt?").status).toBe(
      "AUTHORIZED",
    );
  });

  it("refuses a reporting act with no source in front of it", () => {
    // Nothing but framing before the act, so nothing binds. Same answer as the old list gave, for
    // a reason that does not depend on which names are in it.
    expect(authorize("What was published about US headline CPI?").status).not.toBe("AUTHORIZED");
    expect(authorize("What has been said about US inflation?").status).not.toBe("AUTHORIZED");
  });

  it("refuses a pronoun in the source slot, which names no source", () => {
    // "they" refers to a source established somewhere this request does not contain.
    expect(authorize("What did they say about the US labour market?").status).not.toBe(
      "AUTHORIZED",
    );
    // And asking the product for its own forecast is asking for a prediction.
    expect(authorize("Give me your forecast for the USD/KRW rate.").status).not.toBe("AUTHORIZED");
  });

  it("refuses a source slot that has swallowed a second question", () => {
    // The slot is bounded by clause boundaries and by a second reporting act. Unbounded, this
    // authorized the second question with the whole first one bound as the name of a source.
    const a = authorize(
      "What has the IMF published on global growth, and what did the OECD say about Korea?",
    );
    expect(a.status).not.toBe("AUTHORIZED");
  });

  it("refuses a non-reporting verb between a real source and a real subject", () => {
    // Both open roles bind perfectly here. The act is why it refuses, which is the reason the act
    // is a declared capability lexicon and the other two roles are not.
    expect(authorize("What did Goldman Sachs buy for the pension fund?").status).not.toBe(
      "AUTHORIZED",
    );
  });
});

/**
 * The cost of the cover model, asserted as a COUNT rather than a clock.
 *
 * Making recognition enumerate intervals composed badly with the constituent layer, which already
 * enumerated intervals and called recognition on each. Twelve fragments meant 78 outer runs each
 * re-parsing up to 78 inner spans with four recognizers at every leaf -- thousands of parses for a
 * request somebody could type. The bound was enforced at each level and never on their product.
 *
 * Both boundaries ask about the SAME substrings, so a per-request span cache collapses the
 * composition without restructuring either. The invariant is therefore countable: no interval is
 * ever offered to the recognizer union twice.
 *
 * Wall-clock would be the wrong gate. It passes on a fast machine while the composition is still
 * quadratic-on-quadratic, and it fails on a loaded one while the code is correct -- this session
 * has already had one full suite invalidated by exactly that kind of machine contention.
 */
describe("interval recognition is evaluated once per interval", () => {
  const compound = (fragments: number) =>
    "Should I buy stock? " +
    Array.from({ length: fragments - 1 }, (_, i) => `What is the current S${i}?`).join(" ");

  it.each([2, 4, 8, 12])("evaluates at most n(n+1)/2 spans for %i fragments", (n) => {
    __resetSpanEvaluationsForTest();
    authorize(compound(n));
    expect(__spanEvaluationsForTest()).toBeLessThanOrEqual((n * (n + 1)) / 2);
  });

  it("evaluates every interval exactly once, neither twice nor skipped", () => {
    // Tighter than the bound above and it is the real property: equality means the cache is
    // covering the composition completely, and that nothing silently stopped being analysed.
    __resetSpanEvaluationsForTest();
    authorize(compound(12));
    expect(__spanEvaluationsForTest()).toBe((12 * 13) / 2);
  });

  it("refuses a request with more fragments than it will analyse, without partial analysis", () => {
    // Fail closed and whole. Reading the first twelve sentences of a twenty-sentence request would
    // be choosing which parts of it to answer.
    const overBound = "Should I buy stock? " + "A. ".repeat(30) + "What is the current Acme?";
    const a = authorize(overBound);
    expect(a.status).not.toBe("AUTHORIZED");
  });
});

/**
 * Behaviour the unification CHANGED, recorded so the change is visible rather than discovered.
 *
 * Codex is unavailable until 2026-09-01 (usage limit, and an expired token -- both HUMAN GATES,
 * neither worked around). These are pinned at their MEASURED values so the exact-tree review can
 * judge them when it can run. They are not asserted to be correct; they are asserted to be what
 * this tree does, so that any later drift is deliberate.
 */
describe("recorded consequences of unifying the recognizers", () => {
  it("lets a Korean fragment become a constituent, which it could not before", () => {
    // NEW REACHABLE CAPABILITY, and not from new morphology or vocabulary -- the generic cover
    // engine granted it. Korean used to be consulted only for the WHOLE query, so the constituent
    // path never saw a Korean reading. OPEN for review.
    // The Korean constituent used to be served alongside the refusal. It is not any more, and
    // the neutral form `기준금리는 얼마인가요?` still authorizes on its own -- that control lives
    // in the Korean suite, so this one is free to assert only the domination.
    servesNothing("Should I buy stock? 기준금리는 얼마인가요?");
  });

  it("refuses two Korean questions and a mixed-script pair", () => {
    expect(authorize("기준금리는 얼마인가요? CPI는 무엇인가요?").status).not.toBe("AUTHORIZED");
    expect(authorize("What is the current CPI? 기준금리는 얼마인가요?").status).not.toBe(
      "AUTHORIZED",
    );
  });

  it("still refuses single-fragment compounds, now by span multiplicity", () => {
    // These carry no sentence punctuation, so cover ambiguity cannot protect them: one fragment
    // means one span. They still refuse, but the deciding rule moved from the coordinator/unread
    // guards to two readings in one span. Those guards are therefore NOT deleted -- twice in this
    // unit a guard that looked redundant was the only thing covering a case, and proving mechanical
    // replacement needs the architect that is currently gated.
    for (const query of [
      "Explain how Alpha affects Beta then what is the current Gamma",
      "What did Reuters publish about Alpha and what is the current Gamma",
      "What is the current Alpha and what is the definition of Beta",
    ]) {
      expect(authorize(query).status, query).not.toBe("AUTHORIZED");
    }
  });

  it("treats the same question asked twice as more than one question", () => {
    expect(authorize("What is the current Acme? What is the current Acme?").status).not.toBe(
      "AUTHORIZED",
    );
  });
});

/**
 * The unification's own invariants, which the mutation set caught me not having pinned.
 *
 * Five mutants survived the first run -- restore mechanism precedence, restore attribution
 * precedence, take the first of several interpretations, and two identity collapses -- because
 * every one of these behaviours had been established by PROBE and never written down as a test.
 * Measuring something and pinning it are different acts, and the score is what said so.
 */
describe("no recognizer may silence another", () => {
  it("refuses a relation followed by a separate question", () => {
    // U1. Was AUTHORIZED as one STORED_MECHANISM whose subject had eaten the second question,
    // because mechanism recognition pre-empted the construction branch entirely.
    expect(authorize("Explain how Alpha affects Beta. What is the current Gamma?").status).not.toBe(
      "AUTHORIZED",
    );
  });

  it("refuses an attribution followed by a separate question", () => {
    // U2. `attributionMatch` takes its subject to the END of the span, so the reading covered the
    // whole request and no residue rule could see the tail.
    expect(
      authorize("What did Reuters publish about Alpha? What is the current Gamma?").status,
    ).not.toBe("AUTHORIZED");
  });

  it("attaches no constituent when a redirect carries two questions", () => {
    const a = authorize(
      "Should I buy stock? What did Reuters publish about Alpha? What is the current Gamma?",
    );
    expect(a.status).toBe("PROHIBITED");
    expect(Object.keys(a)).toEqual(["status", "detail"]);
  });

  it.each([
    ["two relations", "Explain how Alpha affects Beta? Explain how Gamma affects Delta?"],
    ["two attributions", "What did Reuters publish about Alpha? What did OECD publish about Beta?"],
    [
      "relation and attribution",
      "Explain how Alpha affects Beta? What did Reuters publish about Gamma?",
    ],
    [
      "attribution and observation",
      "What did Reuters publish about Alpha? What is the current Beta?",
    ],
    ["relation and definition", "Explain how Alpha affects Beta? What is the definition of Gamma?"],
  ])("refuses %s in one request", (_label, query) => {
    // Cross-parser multiplicity. Under precedence the first recognizer answered and the second
    // question vanished; the union means both opinions exist and neither is unique.
    expect(authorize(query).status, query).not.toBe("AUTHORIZED");
  });

  it("still authorizes each of those requests on its own", () => {
    // The control that stops the five above from passing because everything refuses.
    for (const query of [
      "Explain how Alpha affects Beta.",
      "What did Reuters publish about Alpha?",
      "What is the current Beta?",
      "What is the definition of Gamma?",
    ]) {
      expect(authorize(query).status, query).toBe("AUTHORIZED");
    }
  });
});

/**
 * Precedence removal IS observable, and the generated search is what showed it.
 *
 * U-PRE-1 and U-PRE-2 survived the suite, and I could not tell from the survival whether the tests
 * were thin or the removal was semantically inert. `scratchpad/diff_precedence.py` compares the
 * full authority -- status, operation, subject, source, cause, effect, and the informational
 * constituent -- across the union and each precedence variant over a generated corpus. 400 queries:
 * 16 divergences for mechanism-first, 10 for attribution-first.
 *
 * THE QUALIFICATION MATTERS. Every divergence is AMBIGUOUS versus UNSUPPORTED. Both REFUSE, so
 * precedence changes how a refusal is described and not whether anything is authorized. Under
 * precedence the surviving recognizer's reading leaves unread text and the request is refused as
 * unreadable; under the union the span genuinely carries two readings and is refused as ambiguous,
 * which is the truer description of `X and Y`.
 *
 * So this pins a diagnostic property, not a safety one, and the mutants become discriminated
 * without anyone claiming precedence removal is what closed U1/U2. It was not -- the cover model
 * was, and that is recorded in the commit.
 */
describe("a recognizer union describes a two-reading request as ambiguous", () => {
  it("reports a relation coordinated with an observation as AMBIGUOUS, not merely unread", () => {
    expect(authorize("Explain how Alpha affects Beta and What is the current Alpha?").status).toBe(
      "AMBIGUOUS",
    );
  });

  it("reports an attribution coordinated with an observation as AMBIGUOUS", () => {
    expect(
      authorize("What did Reuters publish about Delta and What is the current Alpha?").status,
    ).toBe("AMBIGUOUS");
  });

  it("still refuses both under either description", () => {
    // The point of the pair above is the CATEGORY. Neither may ever authorize, whatever rule wins.
    for (const query of [
      "Explain how Alpha affects Beta and What is the current Alpha?",
      "What did Reuters publish about Delta and What is the current Alpha?",
    ]) {
      expect(authorize(query).status, query).not.toBe("AUTHORIZED");
    }
  });
});

/**
 * A candidate boundary is confirmed as a clause boundary by WHAT FOLLOWS IT.
 *
 * The cover model refuses a swallowing reading only by producing a rival tiling, and a rival needs
 * the swallowed tail to authorize ALONE. When the tail is not a complete request, no rival exists,
 * the joined run is the sole interpretation, and it authorized with the second question buried in an
 * open-class region -- subject, source, cause or effect -- where no residue check can see it.
 *
 * Every swallowing test written before this one chose a tail that authorizes alone. That is exactly
 * the precondition for the defense to work, so the suite only ever exercised the half of the space
 * where the mechanism cannot fail. These are the other half.
 *
 * Two rules were tried and refuted by measurement before this one. Bounding role spans at the
 * boundary outright refuses `Yahoo! Finance` and `Acme Inc. revenue` -- the whole class provisional
 * punctuation exists to reunite. Scanning the tail for ANY framing token refuses
 * `the U.S. Bureau of Labor Statistics` (`of` is framing) AND misses a Hangul tail entirely.
 */
/**
 * ESC-015 items 3, 6 and 7: a relation role that names more than one thing refuses, and repository
 * inventory never gets a say in it.
 *
 * The acceptance case the decision subsumed from the stale-anchored guidance. `Explain how A affects
 * B and C` was authorizing stored `A -> B` and silently discarding `C` whenever `C` was not an
 * endpoint of any discovered edge -- publication authority inferred from inventory coverage, which
 * is backwards. A missing row is evidence about the repository and never evidence about what the
 * request meant.
 *
 * These are asserted HERE, at the parser, and that placement is the point: this layer consults no
 * repository at all, so a refusal here cannot be confused with a lookup that found nothing. An
 * integration test could not tell those apart.
 *
 * `and` and `or` were already refused by `CLAUSE_CONNECTIVES`. The three that were not, and which
 * a mutation run then showed had no test of their own, were the comma and the two comparators.
 *
 * The COMMA has since left this block. It was never connective vocabulary -- it was read from the
 * raw query, because normalization deletes punctuation before a region exists, and it could not
 * tell `Beta, Gamma` from `Alpha, Inc.`. Both refused, and the second was pinned as an open
 * availability defect. Endpoint roles are now covered against stored identities in `askMarket`,
 * which answers directly what the comma inferred from punctuation, so both comma shapes moved to
 * `tests/integration/relation-role-cover.test.ts` and `Alpha, Inc.` is served.
 *
 * The five that remain are decided by closed vocabulary with no lookup, which is why the argument
 * above still holds for them.
 */
describe("a relation role may not name two things", () => {
  it.each([
    ["and", "Explain how Alpha affects Beta and Gamma."],
    ["or", "Explain how Alpha affects Beta or Gamma."],
    ["versus", "Explain how Alpha affects Beta versus Gamma."],
    ["compared with", "Explain how Alpha affects Beta compared with Gamma."],
    ["a conjoined cause", "Explain how Alpha and Gamma affect Beta."],
  ])("refuses a second object introduced by %s", (_label, query) => {
    expect(authorize(query).status, query).not.toBe("AUTHORIZED");
  });

  it("still authorizes the single-pair form", () => {
    // Non-vacuity. Without this the block above passes if the mechanism path is simply broken.
    const a = authorize("Explain how Alpha affects Beta.");
    expect(a.status).toBe("AUTHORIZED");
    expect(a.status === "AUTHORIZED" && a.operation).toBe("STORED_MECHANISM");
    expect(a.status === "AUTHORIZED" && a.causeRegion).toContain("alpha");
    expect(a.status === "AUTHORIZED" && a.effectRegion).toContain("beta");
  });

  it("refuses whether or not the second object could ever be known", () => {
    // A coined second object that no repository could hold, refused exactly as a plausible one is.
    // Kept at the parser for the CONNECTIVE shapes, where a closed vocabulary decides it and no
    // lookup happens; the comma pair now proves the same invariant in
    // `tests/integration/relation-role-cover.test.ts`, where the repository is what refuses.
    const known = authorize("Explain how Alpha affects Beta and Gamma.");
    const coined = authorize("Explain how Alpha affects Beta and Zorbulate.");
    expect(known.status).not.toBe("AUTHORIZED");
    expect(coined.status).not.toBe("AUTHORIZED");
    expect(coined.status).toBe(known.status);
  });

  it("leaves a cardinality-one subject alone", () => {
    // The cost this rule deliberately does NOT pay. A comma inside the subject of a one-endpoint
    // operation belongs to the name -- `Smith; Jones` and `Smith, Jones` are one issuer -- and the
    // guard is keyed to relation roles for exactly that reason.
    const a = authorize("What is the current Smith, Jones revenue?");
    expect(a.status).toBe("AUTHORIZED");
    expect(a.status === "AUTHORIZED" && a.subjectRegion).toContain("jones");
  });
});

describe("a second question may not hide inside an open-class region", () => {
  it.each([
    [
      "attribution subject eats an unreadable tail",
      "What did Reuters publish about Alpha? What about the Gamma level?",
    ],
    [
      "source slot eats the first question",
      "What did Reuters publish about Alpha? What did they say about Gamma?",
    ],
    [
      "mechanism effect eats the tail",
      "Explain how Alpha affects Beta. What about the Gamma level?",
    ],
    [
      "english subject eats a korean question",
      "What is the current Gamma? 현재 기준금리는 얼마인가요?",
    ],
    [
      "determiner opens the swallowed clause",
      "What did Reuters publish about Alpha? The Gamma level too?",
    ],
    [
      "clause opener sits mid-fragment",
      "What did Reuters publish about Alpha? The Gamma level, did it rise?",
    ],
    [
      "a clean third fragment launders the boundary",
      "What did Reuters publish about Alpha? What about the Gamma. level?",
    ],
    // The next three come from a generated differential, not from reading the code. Mutant B-M3
    // -- scan only the tail's FIRST token instead of all of them -- survived the entire binding
    // suite, and every case above explains why: each swallowed tail either opens with a
    // determiner, or already has its clause-opening word in first position, so first-token
    // scanning catches it too. What no test carried was a tail whose clause opener sits behind a
    // PREPOSITION. `scripts/mutation/differential.py` ran 42,840 generated requests through both
    // rules under the same write/restore transaction: 2,532 differ, 1,204 of them are requests the
    // mutant AUTHORIZES with the second question buried in the subject region -- subject
    // ` alpha in 2024 what was the cpi `, source `reuters` -- and 0 are requests the current rule
    // refuses wrongly. That is the P1 itself, so scanning all tokens is load-bearing.
    [
      "the clause opener sits behind a preposition",
      "What did Reuters publish about Alpha. In 2024 what was the CPI?",
    ],
    [
      "the clause opener sits behind a prepositional phrase",
      "What did Reuters publish about Alpha. As of March did Reuters publish anything?",
    ],
    [
      "the clause opener sits behind a fronted adjunct",
      "What did Reuters publish about Alpha. For Korea what is the policy rate?",
    ],
    // P1 review found `who` and `why` absent from CLAUSE_OPENING_TOKENS. Reproducing it found four
    // more, so the finding was wider than reported and every instance was one missing word. These
    // seven are the reproduction; the added tokens are measured to close 2,876 swallows across the
    // generated corpus and to introduce zero wrong refusals in it.
    //
    // The METHOD stays open and is recorded as such: a mutant can show the set is load-bearing and
    // cannot show it is complete. Adding these seven does not make the next omission findable.
    ["the tail opens with who", "What did Reuters publish about Alpha? Who published Gamma?"],
    ["the tail opens with why", "What did Reuters publish about Alpha? Why the Gamma decline?"],
    ["the tail is a who-question", "What did Reuters publish about Alpha? Who said that?"],
    [
      "the tail is an imperative compare",
      "What did Reuters publish about Alpha? Compare it to Gamma.",
    ],
    [
      "the tail is an imperative list",
      "What did Reuters publish about Alpha? List the Gamma figures.",
    ],
    ["the tail opens with any", "What did Reuters publish about Alpha? Any Gamma figures?"],
    ["the tail opens with same", "What did Reuters publish about Alpha? Same for Gamma?"],
    // A terse follow-up after a `?`. These carry NO clause-opening evidence at all -- the tail is a
    // bare name -- so no lexical rule can reach them, which is the point: the terminator itself is
    // the evidence. `?` is the one that never occurs inside a name here, while `.`, `!` and `;`
    // demonstrably do, and the "still authorizes" cases below are what would break if that were
    // extended to the others.
    // The SAME requests with the boundary changed from `?` to `.`, and they are here because
    // adding the terminator rule turned five mutants from ISOLATED to MISSED at once -- the Korean
    // clause rule, the determiner rule, and all three groups of clause-opening tokens.
    //
    // One cause for all five, and it is this unit's recurring one: every case above uses `?`, `?`
    // now confirms on its own, so nothing above reaches the lexical rules any more. The tests had
    // again picked the half of the space where the mechanism cannot fail -- exactly what B-M3 was.
    // A rule that only matters at `.`, `!` and `;` has to be tested at `.`, `!` and `;`.
    ["who follows a period", "What did Reuters publish about Alpha. Who published Gamma?"],
    ["why follows a period", "What did Reuters publish about Alpha. Why the Gamma decline?"],
    ["compare follows a period", "What did Reuters publish about Alpha. Compare it to Gamma."],
    ["list follows a period", "What did Reuters publish about Alpha. List the Gamma figures."],
    ["the follows a period", "What did Reuters publish about Alpha. The Gamma level too?"],
    ["any follows a period", "What did Reuters publish about Alpha. Any Gamma figures?"],
    ["same follows a period", "What did Reuters publish about Alpha. Same for Gamma?"],
    ["a korean clause follows a period", "What is the current Gamma. 현재 기준금리는 얼마인가요?"],
    [
      "a korean clause follows an attribution and a period",
      "What did Reuters publish about Alpha. 현재 기준금리는 얼마인가요?",
    ],
    // ESC-015 Option B. These carry NO clause-opening evidence of any kind -- the tails are bare
    // nouns, coined words, digits and imperatives nobody enumerated -- so no word list can reach
    // them. What refuses them is the SHAPE of the terminator: a period after an ordinary word ends
    // a sentence, a period after an abbreviation does not.
    //
    // One per tail shape from the 38-case matrix that measured the class. All 28 of its swallows
    // close; the full set lives in `scripts/probe-option-b.ts` because pinning 28 near-identical
    // strings here would obscure which shapes are actually distinct.
    // The regression guard for a mistake this repair actually made. The first version REPLACED the
    // tail evidence instead of joining it, and `!` never being a sentence end then opened 1,032 new
    // swallows across the corpus before it was caught. `Yahoo!` needs `!` to stay provisional; this
    // needs the tail evidence to still be consulted when it is.
    ["a clause after an exclamation", "What did Reuters publish about Alpha! What is the CPI?"],
    // Where the LEXICAL rules still do all the work. Option B decides `.` and `?` by terminator
    // shape, so eight mutants went ISOLATED -> MISSED the moment it landed: every discriminator
    // above sits at a `.` and never reaches a word list any more. That is the fifth time in this
    // unit that the tests have drifted to the half of the space where the mechanism cannot fail.
    //
    // `!` and `;` stay provisional -- `Yahoo!` is a brand, `Smith; Jones` is a partnership -- so
    // they are exactly where the clause-opening set, the determiners and the Korean predicate rule
    // are load-bearing. Each of these was measured to refuse before it was written down here.
    ["who after an exclamation", "What did Reuters publish about Alpha! Who published Gamma?"],
    ["who after a semicolon", "What did Reuters publish about Alpha; Who published Gamma?"],
    ["compare after an exclamation", "What did Reuters publish about Alpha! Compare it to Gamma."],
    ["list after a semicolon", "What did Reuters publish about Alpha; List the Gamma figures."],
    ["the after an exclamation", "What did Reuters publish about Alpha! The Gamma level too?"],
    ["any after a semicolon", "What did Reuters publish about Alpha; Any Gamma figures?"],
    ["same after an exclamation", "What did Reuters publish about Alpha! Same for Gamma?"],
    [
      "a korean clause after an exclamation",
      "What did Reuters publish about Alpha! 현재 기준금리는 얼마인가요?",
    ],
    [
      "a korean clause after a semicolon",
      "What did Reuters publish about Alpha; 현재 기준금리는 얼마인가요?",
    ],
    [
      "an opener behind a preposition, after an exclamation",
      "What did Reuters publish about Alpha! In 2024 what was the CPI?",
    ],
    // Accumulation, at the only boundary pair that can still test it: a CONFIRMED `?` followed by
    // a PROVISIONAL `!` whose tail is a measure noun. If confirmation reset instead of
    // accumulating, the second boundary would launder the first and the whole span would tile.
    [
      "a provisional boundary launders a confirmed one",
      "What did Reuters publish about Alpha? What about the Gamma! level?",
    ],
  ])("refuses when %s", (_label, query) => {
    expect(authorize(query).status, query).not.toBe("AUTHORIZED");
  });

  /**
   * OPEN AND PINNED, not closed. ESC-015 item 2 removed delimiter-local classification as the
   * authority mechanism, and these ten are what that cost.
   *
   * They were closed by terminator SHAPE -- a period after an ordinary word ends a sentence, after
   * an abbreviation it does not. That rule refused 10 of 31 ordinary entity abbreviations and no
   * threshold could fix it, so it is gone and this class came back with it.
   *
   * They are NOT closed by the exact-cover work either, and the reason is structural rather than
   * unfinished: each tail carries no coordinator, no clause-opening token, no Hangul predicate and
   * no directive, so every closed grammar available here is blind to it. Separating a name
   * continuation from a new clause needs a POS or name model, which ESC-015 defers.
   *
   * What HAS changed is what they can DO, and it is now the same for all ten: nothing is published
   * for any of them. A prohibited request publishes no payload at all, and for the rest the
   * full-role cover refuses to materialize a stored record whose name merely occurs inside a role
   * it cannot explain. `Purchase Gamma shares.` is in this list rather than in a pin of its own for
   * exactly that reason -- it used to serve Alpha's figures under a subject carrying a trading
   * instruction, and `tests/integration/full-role-cover.test.ts` now holds, against a real
   * repository, that it serves nothing and answers REQUEST_NOT_SUPPORTED.
   *
   * So what remains open here is over-authorization at the GRAMMAR, with publication authority
   * closed underneath it. That is a smaller defect than the one first recorded, and it is still a
   * defect: a request the parser cannot account for should not reach a lookup at all.
   */
  it.fails.each([
    ["a bare name follows a question mark", "What is the current US headline CPI? Korea?"],
    ["a bare subject follows a question mark", "What did Reuters publish about Alpha? Gamma?"],
    ["a company name follows a question mark", "What is the current Acme Inc. revenue? Gamma?"],
    ["an unenumerated imperative", "What did Reuters publish about Alpha. Summarize Gamma."],
    ["a trading imperative", "What is the current Alpha. Purchase Gamma shares."],
    ["a bare noun", "What did Reuters publish about Alpha. Revenue."],
    ["a proper-name-shaped tail", "What did Reuters publish about Alpha. Gamma Corp."],
    ["a coined token", "What did Reuters publish about Alpha. Zorbulate Gamma."],
    ["digits", "What did Reuters publish about Alpha. Q3 Gamma."],
    ["bare hangul after a period", "What did Reuters publish about Alpha. 감마."],
  ])("REOPENED by removing delimiter authority: %s", (_label, query) => {
    expect(authorize(query).status, query).not.toBe("AUTHORIZED");
  });

  it("keeps a who-question out of the served informational region", () => {
    // The publication shape of the P1 review finding, and the one that matters most: the outer
    // refusal was already correct, so only the informational payload showed the defect. It carried
    // subject ` alpha who published gamma ` -- a composite of two questions, offered as the thing
    // the system would answer.
    // This one reproduced a polluted source region. There is no source region to pollute now.
    servesNothing("Should I buy stock? What did Reuters publish about Alpha? Who published Gamma?");
  });

  it("does not bury a prepositionally-fronted second question in the subject region", () => {
    // The status assertion above kills the mutant; this says what went wrong when it fails. Under
    // first-token-only scanning the request came back AUTHORIZED with the entire second question
    // absorbed into the subject slot, which is the exact shape of the P1 rather than a near miss.
    const a = authorize("What did Reuters publish about Alpha. In 2024 what was the CPI?");
    expect(a.status).not.toBe("AUTHORIZED");
    const served = a.status === "AUTHORIZED" ? `${a.subjectRegion} ${a.sourceRegion ?? ""}` : "";
    expect(served).not.toContain("cpi");
  });

  it("keeps the directive out of a served source region", () => {
    // The worst instance, and the reason this is a P1 rather than a tidiness defect: the whole
    // three-fragment span parsed as ONE attribution whose source slot had absorbed the advice
    // directive, so a redirect would have published under source "should i buy stock what did
    // reuters". The constituent must be the clean question or nothing.
    servesNothing(
      "Should I buy stock? What did Reuters publish about Alpha? What about the Gamma level?",
    );
  });

  /**
   * The other side of the rule, and the reason the tested class is narrow.
   *
   * These names carry internal terminator punctuation, so their tails sit after a candidate
   * boundary. Prepositions, determiners and measure nouns continue a noun phrase; only words that
   * can stand clause-initially are evidence that a sentence ended. Refusing these would trade a
   * swallowing bug for a refusal bug.
   */
  it.each([
    [
      "institutional name with of",
      "What did the U.S. Bureau of Labor Statistics publish about nonfarm payrolls?",
      "bureau",
    ],
    ["abbreviation then measure noun", "What is the current U.S. rate of inflation?", "inflation"],
    ["company suffix then measure noun", "What is the current Acme Inc. rate?", "acme inc rate"],
    ["numbered name then measure noun", "What is the current No. 10 index level?", "index level"],
    ["exclamation inside a name", "What is the definition of Yahoo! Finance?", "yahoo finance"],
    ["company suffix then noun", "What is the current Acme Inc. revenue?", "acme inc revenue"],
    // Both of these were REFUSED by the one-sided rule and are the reason for the head condition.
    // A Hangul tail confirms a boundary unconditionally, and `<English legal name> Co. <Hangul
    // name>` is an ordinary way to write a Korean issuer, so the repair was refusing the product's
    // own market. `Mr. Show` is the same shape in English: `Show` is a clause-opening token and
    // also half a name. Neither was constructed -- architect review named the second and the
    // measurement found the first.
    [
      "mixed-script issuer name after an abbreviation",
      "What did Samsung Electronics Co. 삼성전자 report about revenue?",
      "samsung electronics co 삼성전자",
    ],
    [
      "title abbreviation whose name is a clause-opening token",
      "What did Mr. Show report about Alpha?",
      "mr show",
    ],
    // The head condition did not reach this one: `What is the definition of Samsung Electronics
    // Co` genuinely does read alone, as a definition request for the shorter name, so both halves
    // of the bilateral rule held and the name was still split. Script change was never clause
    // evidence -- a Korean CLAUSE is -- and the grammar could already tell them apart.
    [
      "mixed-script issuer name as the subject of a definition",
      "What is the definition of Samsung Electronics Co. 삼성전자?",
      "samsung electronics co 삼성전자",
    ],
    // A dotted abbreviation LONGER than the length test allows. `N.Y.S.E` is four letters, so only
    // the internal-period half of the abbreviation shape saves it -- and this is a name from the
    // product's own domain rather than a constructed one. Without that half the exchange splits at
    // its own last period.
    ["a long dotted abbreviation", "What is the current N.Y.S.E. volume?", "n y s e volume"],
    // `;` and `!` inside names, which is why neither terminator may decide anything on shape alone.
    ["a partnership name with a semicolon", "What is the current Smith; Jones revenue?", "jones"],
    // A bare Korean NAME after a provisional boundary still joins: the Korean rule confirms a
    // CLAUSE, and a nominal is not one.
    [
      "a bare korean name after an exclamation",
      "What did Reuters publish about Alpha! 삼성전자?",
      "삼성전자",
    ],
  ])("still authorizes %s", (_label, query, expected) => {
    const a = authorize(query);
    expect(a.status, query).toBe("AUTHORIZED");
    const served = a.status === "AUTHORIZED" ? `${a.subjectRegion} ${a.sourceRegion ?? ""}` : "";
    expect(served, query).toContain(expected);
  });

  /**
   * KNOWN AND ACCEPTED, pinned as a failure rather than described in a comment.
   *
   * The `?` rule was implemented on the belief that `?` never occurs inside a name in this domain.
   * The belief was false: Companies House company 09804638 is registered as
   * `CAN I USE A QUESTION MARK IN A COMPANY NAME? LTD`. The architect reviewer had warned in
   * writing, before the rule was written, that "no counterexample currently known" is a reason to
   * measure rather than a proof, and the counterexample was found by a reviewer who went and
   * looked rather than reasoning about it.
   *
   * Kept anyway, and the reason is a weighing rather than a measurement: 258 swallows closed and 0
   * wrongly admitted across 99,072 requests, including ordinary terse follow-ups like `What is the
   * current US headline CPI? Korea?`, against one false refusal of a novelty registration. The
   * architect ruled KEEP on that evidence and required the exception be pinned.
   *
   * `it.fails` and not a comment, so that the day a continuation-aware rule subsumes `?` this test
   * starts failing and forces the exception to be revisited instead of quietly outliving its
   * justification.
   */
  it("authorizes a relation whose endpoint name contains a comma", () => {
    // WAS PINNED. `Alpha, Inc.` is ordinary US style, and the raw comma test refused the whole
    // relation before it was even recognised -- a capability loss kept only because nothing else
    // could refuse `Explain how Alpha affects Beta, Gamma.` Something else can now, one layer down,
    // so the guard is retired and the name is authorized here and served in
    // `tests/integration/relation-role-cover.test.ts`.
    const a = authorize("Explain how Alpha, Inc. affects Beta.");
    expect(a.status).toBe("AUTHORIZED");
  });

  it.fails("authorizes an issuer name that itself contains a question mark", () => {
    const a = authorize(
      "What is the definition of Can I Use A Question Mark In A Company Name? Ltd?",
    );
    expect(a.status).toBe("AUTHORIZED");
  });

  /**
   * KNOWN AND OPEN, and the reason ESC-015's step 5 condition has triggered.
   *
   * The abbreviation-shape test asks whether the token before a period is 3 or fewer alphanumerics,
   * or already contains a period. Structural review called the threshold fitted rather than
   * principled, and measuring the suffix population agreed: 10 of 31 ordinary legal-entity and
   * title abbreviations are refused, `Corp.` among them
   * (`scripts/probe-abbreviation-length.ts`).
   *
   *     refused at 4+ letters   Corp  GmbH  Dept  Prof  Assn  Bros  Univ  Corpn  Assoc  Sched
   *     joined at <= 3          Inc  Ltd  LLC  PLC  Co  LP  SA  AG  and the rest
   *
   * Raising the threshold does not fix it, which is the part that matters. Ordinary THREE-letter
   * subjects are already treated as abbreviations and swallowed -- `What did Reuters publish about
   * Oil. Summarize Gamma.` serves ` oil summarize gamma `, likewise `CPI.`. So `Inc` must join at
   * three and `CPI` must split at three, and length cannot separate them at any threshold.
   *
   * Not patched with a suffix list: ESC-015 forbids patching entity names, and a suffix list is a
   * vocabulary of exactly the kind that rejected the previous approach. Returned to ESC-015 with
   * the numbers instead.
   */
  it("authorizes a four-letter issuer suffix", () => {
    // WAS `it.fails`. ESC-015 item 2 removed the delimiter-shape rule that refused this, along with
    // `GmbH.`, `Dept.`, `Prof.`, `Assn.`, `Bros.`, `Univ.`, `Corpn.`, `Assoc.` and `Sched.` -- 10 of
    // 31 ordinary entity and title abbreviations. No threshold could have kept them: `Inc` must
    // join at three letters and `CPI` must split at three.
    const a = authorize("What is the current Acme Corp. revenue?");
    expect(a.status).toBe("AUTHORIZED");
    expect(a.status === "AUTHORIZED" && a.subjectRegion).toContain("acme corp revenue");
  });

  /**
   * KNOWN AND OPEN. The residual at `!` and `;`, and it is worse than I told the reviewer.
   *
   * I claimed to the publication-authority review that the residual publishes a composite SUBJECT
   * and never a polluted SOURCE. The reviewer refuted it by construction, and this is that input:
   * the request stays PROHIBITED, but the informational payload carries the advice directive
   * itself as the SOURCE label -- `should i buy stock reuters`. That is the original P1 shape, not
   * a milder relative of it.
   *
   * The same request with a PERIOD is clean (`src=reuters`), because terminator shape decides
   * there. `!` and `;` have no shape evidence available: `Yahoo!` and `Smith; Jones` are real
   * names, so neither may confirm on its own, and nothing else separates `Yahoo! Finance` from
   * `Alpha! What is the CPI?` except reading the continuation.
   */
  it("keeps the directive out of a source region at an exclamation boundary", () => {
    // WAS `it.fails`, and it is now an ordinary passing control. ESC-015 item 4 closed this by
    // removing the payload entirely rather than by bounding it better: there is no source region
    // to pollute when a directive is present. The `!` boundary is still undecidable and the tail
    // still cannot be separated from a name -- that limitation is real and recorded -- but it can
    // no longer reach anything published.
    servesNothing("Should I buy stock! Reuters published about Alpha?");
    servesNothing("Should I buy stock; Reuters published about Alpha?");
    servesNothing("Should I buy stock. Reuters published about Alpha?");
  });
});

describe("an anchored interval is not the interval it names", () => {
  const operationOf = (query: string) => {
    const a = resolveRequestAuthority(query);
    return a.status === "AUTHORIZED" ? a.operation : a.status;
  };
  const intervalOf = (query: string) => {
    const a = resolveRequestAuthority(query);
    return a.status === "AUTHORIZED" ? (a.interval ?? null) : null;
  };

  it("refuses a temporal anchor rather than silently answering the plain operand", () => {
    // MEASURED, not supposed. Every one of these bound plain `last year` and would have been
    // answered over 2025-01-01..2025-12-31 at an asOf of 2026-08-25:
    //
    //   since last year   loses the eight months since it -- the request runs to NOW
    //   before last year  is answered with the COMPLEMENT of the period it names
    //   after / until / through / from   each name a different period again
    //
    // `since last year` is also an operand `resolveObservationPeriod` deliberately REFUSES, and the
    // refusal was being bypassed because the scan finds the shorter ` last year ` inside it first.
    for (const anchor of ["since", "from", "after", "before", "until", "through"]) {
      const query = `What was the change in US CPI ${anchor} last year?`;
      expect(operationOf(query), query).not.toBe("OBSERVED_CHANGE");
    }
  });

  it("steps over a determiner, so `since THE last quarter` cannot slip past", () => {
    expect(operationOf("What was the change in US CPI since the last quarter?")).not.toBe(
      "OBSERVED_CHANGE",
    );
  });

  it("keeps the prepositions that leave the operand meaning what it says", () => {
    // An ALLOWLIST, and the direction is the point: a missing anchor in a denylist ADMITS a
    // silently reinterpreted period, while a missing member here only refuses a request that would
    // have been fine. `over the last quarter` is the one corpus row this construction authorizes.
    for (const transparent of ["over", "in", "during", "for"]) {
      const query = `What was the change in US CPI ${transparent} last year?`;
      expect(operationOf(query), query).toBe("OBSERVED_CHANGE");
      expect(intervalOf(query), query).toBe("last year");
    }
    expect(operationOf("What was the change in the KOSPI over the last quarter?")).toBe(
      "OBSERVED_CHANGE",
    );
  });

  it("leaves an unanchored interval alone", () => {
    expect(intervalOf("What was the change in US CPI last year?")).toBe("last year");
    expect(intervalOf("What was the change in US CPI over the past year?")).toBe(
      "over the past year",
    );
  });
});

describe("the parser asks one grammar for what an interval means", () => {
  const authority = (query: string) => resolveRequestAuthority(query);
  const intervalOf = (query: string) => {
    const a = authority(query);
    return a.status === "AUTHORIZED" ? (a.interval ?? null) : null;
  };
  const operationOf = (query: string) => {
    const a = authority(query);
    return a.status === "AUTHORIZED" ? a.operation : a.status;
  };

  it("admits a counted trailing window without a new parser literal", () => {
    // GATE B. `INTERVAL_OPERANDS` was twelve literals kept in step BY HAND with the resolver's
    // switch, and the two had already drifted. The parser now asks `parseInterval`, so anything the
    // typed grammar admits is admissible here -- these were unreadable before and no literal was
    // added for them.
    expect(intervalOf("What was the change in US CPI over the past 6 weeks?")).toBe(
      "over the past 6 weeks",
    );
    expect(intervalOf("What was the change in US CPI over the past six weeks?")).toBe(
      "over the past six weeks",
    );
    expect(intervalOf("What was the change in US CPI over the past 3 months?")).toBe(
      "over the past 3 months",
    );
  });

  it("refuses a malformed count here too, because there is only one grammar to refuse it", () => {
    // The point of a single authority: the parser cannot admit what the resolver cannot compute.
    for (const query of [
      "What was the change in US CPI over the past 0 weeks?",
      "What was the change in US CPI over the past several weeks?",
      "What was the change in US CPI over the past 6 fortnights?",
    ]) {
      expect(operationOf(query), query).not.toBe("OBSERVED_CHANGE");
    }
  });

  it("takes the LONGEST interval phrase, so a shorter one cannot shadow it", () => {
    // This is the structural cure for the `since last year` defect. That bug existed because the
    // scan walked a list and found ` last year ` inside `since last year` first. Longest match
    // means the longer phrase is always tried before its own substring, whatever the grammar
    // admits -- `over the past year` is never read as the bare `year to date` fragment beside it,
    // and the anchored-interval rule still stands in front.
    expect(intervalOf("What was the change in US CPI over the past year?")).toBe(
      "over the past year",
    );
    expect(operationOf("What was the change in US CPI since last year?")).not.toBe(
      "OBSERVED_CHANGE",
    );
  });

  it("still refuses the two-endpoint range it has no semantics for", () => {
    // DEV-EN-055. Its real period is a half-to-half comparison, and binding it to the ` last year `
    // sitting inside it would be the anchored-interval defect again. Out of scope per the
    // decision's item 5, and refused rather than approximated.
    expect(
      operationOf(
        "What is the delta in Korean semiconductor exports between the first half and second half of last year?",
      ),
    ).not.toBe("OBSERVED_CHANGE");
  });
});

describe("the change-nominal construction family", () => {
  const operationOf = (query: string) => {
    const a = resolveRequestAuthority(query);
    return a.status === "AUTHORIZED" ? a.operation : a.status;
  };
  const intervalOf = (query: string) => {
    const a = resolveRequestAuthority(query);
    return a.status === "AUTHORIZED" ? (a.interval ?? null) : null;
  };

  it("recognises the motivating row, and binds the interval it actually names", () => {
    // DEV-EN-038, and the whole point of the family. `move` is admitted because this row IS the
    // evidence for that grammatical role, not because a synonym list was extended.
    const query = "Give me the move in the 10-year Treasury yield over the past six weeks.";
    expect(operationOf(query)).toBe("OBSERVED_CHANGE");
    expect(intervalOf(query)).toBe("over the past six weeks");
  });

  it("keeps the head the family already had", () => {
    // DEV-EN-032. The literal ` change in ` row was REPLACED by the derived family, so this is the
    // regression that proves the replacement lost nothing.
    expect(operationOf("What was the change in the KOSPI over the last quarter?")).toBe(
      "OBSERVED_CHANGE",
    );
  });

  it("refuses when the interval is absent rather than defaulting one", () => {
    // The interval is load-bearing. A change with no period is not a question anyone can answer,
    // and guessing one would answer about a period the request never named.
    expect(operationOf("What was the change in US CPI?")).not.toBe("OBSERVED_CHANGE");
    expect(operationOf("Give me the move in the 10-year Treasury yield.")).not.toBe(
      "OBSERVED_CHANGE",
    );
  });

  it("refuses an interval the typed grammar cannot resolve", () => {
    // `over the last fortnight` and a half-to-half range are real corpus phrasings this grammar has
    // no semantics for. Unsupported must refuse, not approximate.
    expect(
      operationOf("What was the movement in the USD/KRW rate over the last fortnight?"),
    ).not.toBe("OBSERVED_CHANGE");
    expect(
      operationOf(
        "What is the delta in Korean semiconductor exports between the first half and second half of last year?",
      ),
    ).not.toBe("OBSERVED_CHANGE");
  });

  it("needs the `in` relation, not merely the head next to a subject", () => {
    // DEV-EN-045, `the Baltic Dry Index, change over the past 30 days?`, is an APPOSITIVE and is
    // explicitly NOT authorized by this decision. It stays unresolved on purpose, and this pins it
    // so that a later loosening of the relation cannot pick it up silently.
    expect(operationOf("the Baltic Dry Index, change over the past 30 days?")).not.toBe(
      "OBSERVED_CHANGE",
    );
    expect(
      operationOf("Give me the move the 10-year Treasury yield over the past six weeks."),
    ).not.toBe("OBSERVED_CHANGE");
  });

  it("does not turn an adjacent level or definition question into a change", () => {
    // The family must not reach across into the operations either side of it.
    expect(operationOf("What is the current US headline CPI?")).toBe("CURRENT_OBSERVATION");
    expect(operationOf("What is a Eurodollar?")).toBe("DEFINITION");
    expect(operationOf("What is the level of the KOSPI over the last quarter?")).not.toBe(
      "OBSERVED_CHANGE",
    );
  });

  it("admits no head that has no corpus row in this role", () => {
    // `delta`, `shift` and `movement` all appear in the corpus in exactly this grammatical role, and
    // are all DELIBERATELY absent, because every one of those rows carries an interval this grammar
    // cannot resolve -- so admitting the head would recognise nothing and would be the speculative
    // synonym enumeration the decision forbids. With a resolvable interval they still refuse, which
    // is what makes this a closed slot rather than a growing list.
    for (const head of ["delta", "shift", "movement", "swing", "variation"]) {
      const query = `Give me the ${head} in the 10-year Treasury yield over the past six weeks.`;
      expect(operationOf(query), query).not.toBe("OBSERVED_CHANGE");
    }
  });
});
