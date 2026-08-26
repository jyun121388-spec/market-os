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
  const constituentOf = (query: string) => {
    const a = authorize(query);
    expect(a.status, query).toBe("PROHIBITED");
    return a.status === "PROHIBITED" ? a.informational : undefined;
  };

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
  ])("carries the whole informational clause across %s", (_label, query, mustContain) => {
    expect(constituentOf(query)?.subjectRegion).toContain(mustContain);
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

  it("refuses a directive standing in front of a valid operation, without detecting the directive", () => {
    // Unread residue alone, with no coordinator in the subject and no advice vocabulary matched.
    // This is the property IR-107 was built for: what stops the request is that nothing read it.
    const a = authorize("Rebalance the portfolio. What is the current gold price?");
    expect(a.status).toBe("UNSUPPORTED");
    expect(a.status === "UNSUPPORTED" && a.detail).toContain("beyond the operation");
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
    const a = authorize("Should I buy stock? 기준금리는 얼마인가요?");
    expect(a.status).toBe("PROHIBITED");
    const informational = a.status === "PROHIBITED" ? a.informational : undefined;
    expect(informational?.operation).toBe("CURRENT_OBSERVATION");
    expect(informational?.subjectRegion).toContain("기준금리");
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
    expect(a.status === "PROHIBITED" ? a.informational : undefined).toBeUndefined();
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
