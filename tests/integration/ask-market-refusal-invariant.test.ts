import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * A refusal must not be a recommendation wearing a disclaimer.
 *
 * Ask Market answers "Should I buy Apple Inc?" by setting `PERSONALIZED_ADVICE_REDIRECTED`,
 * attaching a redirect message — and still returning the factors, which `/ask` renders underneath.
 * Confirmed against the populated development database: that question returns the refusal and ten
 * Apple figures.
 *
 * That is defensible, and the redirect message says exactly what it is doing: a factor analysis
 * "for you to interpret yourself". What makes it defensible rather than advice-by-arrangement is
 * one property — the factors are IDENTICAL to what the neutral query returns. The advice detector
 * and the factor selection are orthogonal, so the buy/sell framing changes nothing about which
 * figures appear or in what order.
 *
 * Nothing enforced that. `findCompanyFacts` could start ranking on relevance to the question, or
 * a change could surface "the factors that support a purchase", and the refusal would quietly
 * become the thing it refuses. The property is checkable, so it is checked.
 *
 * ## AMENDED 2026-08-26 — what "the neutral query" is allowed to mean
 *
 * Everything above still holds for a request that NAMES an operation. It did not hold for a bare
 * one, and the difference was doing real damage.
 *
 * There is no such thing as "the neutral query" for `Should I buy X?`. The test invented one —
 * `What is the current X?` — and production satisfied the comparison by running a retrieval wide
 * enough to match the invented sentence too. That same width is how a refusal came to publish what
 * the repository refuses:
 *
 *     "Define X."                   -> REQUEST_NOT_SUPPORTED, no facts (this repository holds none)
 *     "Should I buy X? Define X."   -> REDIRECTED, and X's figures published anyway
 *
 * So the contract is now stated in terms of what the request actually asked: a redirected request
 * is answered through the operation it named, by the same selector as any other request, and a
 * request that named no operation is answered with nothing. Refusing to advise is not refusing to
 * inform — but a bare directive asked to be informed of nothing.
 *
 * The anti-flattery property survives intact and is now enforced where it is well defined: on
 * `Should I buy X? What is the current X?`, whose neutral form is a real parse of the same words.
 *
 * Seeded rather than relying on the Apple data, because the suite runs against a disposable test
 * database by design and a test that silently finds nothing would report coverage it did not have.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_ASK_REFUSAL";
const CORP_CODE = "0009999001";
const CORP_NAME = "Contoso Pharmaceuticals Inc.";

describeIfDb("a refused advice question returns the same factors as a neutral one", () => {
  let prisma: typeof PrismaClientInstance;
  let sourceId: string;

  // IR-107: the neutral control has to name an operation now, or it is refused for a reason
  // that has nothing to do with the property under test.
  const NEUTRAL = `What is the current ${CORP_NAME}?`;
  const ADVICE = [
    `Should I buy ${CORP_NAME}?`,
    `Should I sell ${CORP_NAME} now?`,
    `${CORP_NAME} 지금 살까?`,
  ];

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));

    const source = await prisma.source.upsert({
      where: { code: SOURCE_CODE },
      update: {},
      create: { code: SOURCE_CODE, name: "Ask Market refusal test", tier: "TIER_S" },
    });
    sourceId = source.id;

    await prisma.financialFact.deleteMany({ where: { sourceId } });
    await prisma.filing.deleteMany({ where: { sourceId } });

    await prisma.filing.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        corpName: CORP_NAME,
        reportName: "10-Q",
        receiptNo: "9999-0001",
        receiptDate: new Date("2026-07-30T00:00:00.000Z"),
        raw: {},
      },
    });

    // Three figures with visibly different characters, so a re-ranking would be detectable rather
    // than hidden behind values that all look alike.
    // Relative periods, and two of them.
    //
    // These were fixed dates and a single reported period. Once `askMarket` began asking whether a
    // filing figure is CURRENT, one period projected no cadence and the whole fixture stopped being
    // answerable -- so this invariant was being checked against an empty payload, which it would
    // have satisfied trivially.
    const day = 24 * 60 * 60 * 1000;
    const iso = (n: number) => new Date(Date.now() - n * day).toISOString().slice(0, 10);
    const CURRENT = iso(30);
    const facts = [
      { concept: "Revenues", value: "12000000000", periodEnd: CURRENT },
      { concept: "NetIncomeLoss", value: "-450000000", periodEnd: CURRENT },
      { concept: "Assets", value: "88000000000", periodEnd: CURRENT },
      // The quarter before, which gives the company a cadence and must not itself be served as
      // current.
      { concept: "Revenues", value: "11000000000", periodEnd: iso(120) },
    ];
    for (const f of facts) {
      await prisma.financialFact.create({
        data: {
          sourceId,
          corpCode: CORP_CODE,
          taxonomy: "us-gaap",
          concept: f.concept,
          accessionNumber: "9999-0001",
          unit: "USD",
          value: f.value,
          periodStart: f.concept === "Assets" ? null : new Date(`${iso(120)}T00:00:00.000Z`),
          periodEnd: new Date(`${f.periodEnd}T00:00:00.000Z`),
          fiscalYear: 2026,
          fiscalPeriod: "Q3",
          form: "10-Q",
          filedDate: new Date("2026-07-30T00:00:00.000Z"),
          raw: {},
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.financialFact.deleteMany({ where: { sourceId } });
    await prisma.filing.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  const fingerprint = (
    facts: { concept: string; unit: string; value: number; periodEnd: string }[],
  ) => facts.map((f) => `${f.concept}|${f.unit}|${f.value}|${f.periodEnd}`);

  /**
   * REPLACED 2026-08-26, and the replacement is the opposite expectation.
   *
   * This asserted that a bare `Should I buy X?` publishes the SAME factors as the invented neutral
   * query `What is the current X?`. The property was real -- a refusal must not re-rank true
   * figures to flatter a purchase -- but the mechanism behind it was a wide retrieval over the raw
   * string, and that same retrieval published records the repository refuses when asked plainly:
   *
   *     "Define X."                   -> REQUEST_NOT_SUPPORTED, no facts (no glossary is held)
   *     "Should I buy X? Define X."   -> REDIRECTED, X's figures published anyway
   *
   * Both cannot hold. A redirect either answers through the operation the request named, or it
   * answers through something wider than any operation -- and wider is what let the refusal
   * contradict the refusal. The contract chosen is: refusing to advise is not refusing to inform,
   * BUT A BARE DIRECTIVE ASKED TO BE INFORMED OF NOTHING. `Should I buy X?` names no operation, so
   * it publishes none.
   *
   * The anti-flattery property it was protecting is not lost. It moves to the request that DOES
   * name an operation, below, where "identical to the neutral form" is well defined because the
   * neutral form is a real parse of the same words rather than a different sentence the test made
   * up.
   */
  it("publishes nothing for a bare directive that names no operation", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // The control: the same company IS answerable, so the empties below are the rule and not an
    // absent fixture.
    const neutral = await askMarket(NEUTRAL);
    expect(neutral.status).toBe("FACTORS_FOUND");
    expect(neutral.companyFacts.length).toBeGreaterThan(0);

    for (const query of ADVICE) {
      const refused = await askMarket(query);
      expect(refused.status, query).toBe("PERSONALIZED_ADVICE_REDIRECTED");
      expect(refused.redirectMessage, query).toBeTruthy();

      expect(refused.companyFacts, query).toEqual([]);
      expect(refused.seriesFactors, query).toEqual([]);
      expect(refused.causalFactors, query).toEqual([]);
    }
  });

  it("keeps the redirect message honest about what is underneath it", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // The old message promises "a factor analysis instead". Printed above an empty page that is a
    // claim the screen contradicts, so the message follows what was published rather than which
    // branch produced it.
    const bare = await askMarket(ADVICE[0]);
    expect(bare.companyFacts).toEqual([]);
    expect(bare.redirectMessage).not.toContain("Here's a factor analysis");

    const withOperation = await askMarket(
      `Should I buy ${CORP_NAME}? What is the current ${CORP_NAME}?`,
    );
    expect(withOperation.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(withOperation.companyFacts.length).toBeGreaterThan(0);
    expect(withOperation.redirectMessage).toContain("Here's a factor analysis");
  });

  it("answers a directive that also names an operation exactly as the operation would", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // This is where the anti-flattery property lives now. The neutral form is a genuine parse of
    // the same operation, so "identical, and in the same order" is a claim about one request rather
    // than a comparison with a sentence the test invented.
    const neutral = await askMarket(NEUTRAL);
    expect(neutral.companyFacts.length).toBeGreaterThan(0);

    const refused = await askMarket(`Should I buy ${CORP_NAME}? ${NEUTRAL}`);
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    // Order matters: re-ranking the same true figures to lead with the flattering ones would be a
    // recommendation assembled entirely out of facts.
    expect(fingerprint(refused.companyFacts)).toEqual(fingerprint(neutral.companyFacts));
  });

  it("publishes nothing for a directive whose operation this repository cannot answer", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // The reproduced P1, and the phrasing is deliberate. `Define X` is not recognised as an
    // operation AT ALL, so it would exercise the "no constituent" path and pass without ever
    // testing the one that matters. `What is the definition of X?` IS recognised as DEFINITION,
    // whose record class is a glossary this repository does not hold -- so the constituent is
    // attached, its normal selector runs, and it yields nothing. That is the path under test.
    const neutral = await askMarket(`What is the definition of ${CORP_NAME}?`);
    expect(neutral.companyFacts).toEqual([]);

    const refused = await askMarket(
      `Should I buy ${CORP_NAME}? What is the definition of ${CORP_NAME}?`,
    );
    // The outer status stays the prohibition: a factual clause never rescues a directive, and the
    // selector's own refusal status must not surface in its place.
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(refused.companyFacts).toEqual([]);
    expect(refused.seriesFactors).toEqual([]);
  });

  it("does not cut the informational clause at a period inside a company suffix", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // The clause splitter treated `.` as a sentence boundary, so `... Acme Inc. revenue?` was cut
    // into `... Acme Inc.` and `revenue?`. The leading fragment PARSES ON ITS OWN, so a constituent
    // still attached and still published -- carrying the subject `Acme Inc.` for a question asked
    // about `Acme Inc. revenue`. Same company, same rows, different question, which is why this
    // integration test cannot see the defect and the assertion that can lives in
    // `requestAuthority.test.ts` on the subject region. This one is kept as parity coverage.
    //
    // The clause has to CONTINUE past the suffix for the period to be judged at all. `NEUTRAL`
    // ends `Inc.?`, so it would not reproduce this and would pass either way -- the same trap as
    // before. This one ends `Inc. revenue?`, where the old splitter cut between `Inc.` and
    // `revenue?`.
    const informational = `What is the current ${CORP_NAME} revenue?`;
    const neutral = await askMarket(informational);
    expect(neutral.companyFacts.length).toBeGreaterThan(0);

    const refused = await askMarket(`Should I buy stock? ${informational}`);
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(fingerprint(refused.companyFacts)).toEqual(fingerprint(neutral.companyFacts));
  });

  it("publishes nothing when the request names more than one informational operation", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // Fail-closed on the far side of one. Two recognised clauses means choosing which half the
    // reader meant, and choosing is inventing. The control above proves the current-observation
    // clause alone WOULD have published, so this empty is the ambiguity rule and not a dead path.
    const refused = await askMarket(
      `Should I buy ${CORP_NAME}? ${NEUTRAL} What is the definition of ${CORP_NAME}?`,
    );
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(refused.companyFacts).toEqual([]);
    expect(refused.seriesFactors).toEqual([]);
  });

  it("serves the clean clause when a tail is swallowed, and never the directive itself", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // The publication half of the P1. The authority-level assertions live in
    // `requestAuthority.test.ts`; this one follows the same request all the way to what a reader
    // would be shown, because a clean authority object is only worth something if the serving path
    // uses it. The defect it guards published under a source region that had absorbed the advice
    // directive -- literally `source "should i buy stock what did reuters"`.
    //
    // What the contract actually is, and I asserted the wrong thing first: appending an
    // unreadable tail must publish EXACTLY what the two-clause form publishes. The repair was
    // never about suppressing the clean clause -- the authority-level control pins
    // `subjectRegion` as containing `alpha` and NOT `gamma` for the same shape -- it was about the
    // tail not being absorbed into the region that gets served. Asserting emptiness here would
    // have contradicted that and locked in a different, wrong behaviour; the run said so.
    //
    // The middle clause is the one the control above proves DOES publish alone, so this comparison
    // is against a known non-empty result rather than against two empties agreeing.
    const informational = `What is the current ${CORP_NAME} revenue?`;
    const publishes = await askMarket(`Should I buy stock? ${informational}`);
    expect(publishes.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(publishes.companyFacts.length).toBeGreaterThan(0);

    const swallowed = await askMarket(
      `Should I buy stock? ${informational} What about the Gamma level?`,
    );
    expect(swallowed.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(fingerprint(swallowed.companyFacts)).toEqual(fingerprint(publishes.companyFacts));
    expect(swallowed.seriesFactors).toEqual(publishes.seriesFactors);

    // No DERIVED field may quote the directive back, nor the clause the grammar could not read.
    // Serialising everything rather than naming fields is deliberate -- naming them would only
    // cover the ones I thought of, and the defect was a directive surfacing in a field nobody was
    // looking at, `source "should i buy stock what did reuters"`.
    //
    // `query` is excluded, and only `query`. It is the request echoed back verbatim, so it
    // necessarily contains the directive; the first version of this assertion caught that and it
    // was the assertion that was wrong, not the output. Everything else here is something the
    // system CHOSE to say.
    //
    // Excluded is NOT the same as never displayed, and review was right to make the distinction:
    // `/ask` does render `result.query`, on the NOT_FOUND branch (`src/app/ask/page.tsx`). What
    // keeps it off the redirect surface is that the two statuses are exclusive, not that the field
    // is unrendered. So this exclusion is scoped to derived-content checking and must not be read
    // as a claim that the echo is invisible.
    const derived = { ...swallowed, query: undefined };
    const published = JSON.stringify(derived).toLowerCase();
    expect(published).not.toContain("should i buy");
    expect(published).not.toContain("gamma");
  });

  it("Verify agrees the rendered answer recommends nothing", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");
    const { verificationInputFromAskMarket } = await import("@/server/verify/fromAskMarket");
    const { verify } = await import("@/server/verify/evaluate");

    // The directive that also names an operation, because this dimension exists to look at figures
    // rendered UNDERNEATH a refusal, and a bare directive no longer puts any there. Checking the
    // bare form would make the assertion below vacuous rather than strict.
    const refused = await askMarket(`Should I buy ${CORP_NAME}? ${NEUTRAL}`);
    const input = verificationInputFromAskMarket(refused);
    expect(input).not.toBeNull();
    expect(input!.advice?.shape).toBe("REFUSAL");
    expect(input!.advice?.figureCount).toBeGreaterThan(0);

    expect(verify(input!).dimensions.adversarial_resilience.status).toBe("PASS");
  });
});

/**
 * A refusal must not publish a relation the same repository refuses to publish neutrally.
 *
 * The invariant above is the "not less" half: a redirect shows the figures its neutral twin shows,
 * so refusing to advise is visibly not refusing to inform. This is the "not more" half, and it was
 * open. The redirect ran a WIDE topical edge search -- an edge matched when EITHER endpoint loosely
 * mentioned the query -- while the only authorized edge path, `STORED_MECHANISM`, requires resolved,
 * oriented, exactly-framed regions. Two publishing rules, and the loose one was reachable through
 * the door that refuses.
 *
 *     stored A -> B
 *     "Should I buy A? Explain how A affects B only if something else."
 *     ->  PERSONALIZED_ADVICE_REDIRECTED  causalFactors [A -> B]
 *     "Explain how A affects B only if something else."
 *     ->  NOT_FOUND                       causalFactors []
 *
 * A conditional question answered unconditionally, underneath a refusal, in a product that may not
 * give advice. The redirect now publishes no edges at all.
 *
 * Why not "publish what the twin would publish" instead: measured, all three advice forms resolve
 * PROHIBITED, so no cause or effect region exists on this path to run that computation with, and
 * rebuilding them from the raw query is the second source of authority B2 exists to remove. The
 * affirmative case is therefore a deliberate narrowing and is pinned below rather than left to be
 * discovered -- a refusal that publishes strictly less cannot become advice by arrangement.
 */
const EDGE_SOURCE = "TEST_ASK_REDIRECT_EDGE";
const CAUSE = "TEST Redirect Cause";
const EFFECT = "TEST Redirect Effect";

describeIfDb("the advice redirect publishes no causal edge its neutral form would refuse", () => {
  let prisma: typeof PrismaClientInstance;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    await prisma.causalEdge.deleteMany({ where: { fromVariable: CAUSE } });
    await prisma.causalEdge.create({
      data: {
        fromVariable: CAUSE,
        toVariable: EFFECT,
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "test transmission mechanism",
        evidence: EDGE_SOURCE,
        lag: "1 quarter",
        counterexamples: "test fixture",
      },
    });
  });

  afterAll(async () => {
    await prisma.causalEdge.deleteMany({ where: { fromVariable: CAUSE } });
    await prisma.$disconnect();
  });

  const edges = (r: { causalFactors: { fromVariable: string; toVariable: string }[] }) =>
    r.causalFactors.map((f) => `${f.fromVariable} -> ${f.toVariable}`);

  // Positive control, and it is load-bearing: every assertion below expects an EMPTY array, which
  // an empty database would satisfy without the rule ever firing. This proves the edge is stored
  // and reachable, so the empties are refusals rather than absence.
  it("serves the affirmative relation on the authorized path", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    const result = await askMarket(`Explain how ${CAUSE} affects ${EFFECT}.`);
    expect(result.status).toBe("FACTORS_FOUND");
    expect(edges(result)).toEqual([`${CAUSE} -> ${EFFECT}`]);
  });

  it.each([
    [
      "conditional",
      `Should I buy ${CAUSE}? Explain how ${CAUSE} affects ${EFFECT} only if something else.`,
    ],
    ["denial", `Should I buy ${CAUSE}? Explain how it is false that ${CAUSE} affects ${EFFECT}.`],
  ])("redirects a %s relation without publishing the edge", async (_label, query) => {
    const { askMarket } = await import("@/server/domain/askMarket");

    const refused = await askMarket(query);
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(refused.redirectMessage).toBeTruthy();
    expect(edges(refused)).toEqual([]);
  });

  // REVERSED 2026-08-26. This asserted the opposite -- that the affirmative advice form publishes
  // nothing -- which was a deliberate narrowing at the time and review returned CONTRACT_BREACH on
  // it: the redirect showed less than its neutral form, and "publishing less cannot become advice"
  // was a safety argument, not the parity commitment the contract states.
  //
  // It is no longer a narrowing, because the redirect can now reach the relation the request
  // actually named. The affirmative form serves the edge, exactly as the neutral form does; the
  // conditional and denied forms above still serve nothing, exactly as their neutral forms do. One
  // rule, three answers that each match their own neutral parse.
  it("serves the edge for an advice-framed affirmative relation, as its neutral form does", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    const refused = await askMarket(
      `Should I buy ${CAUSE}? Explain how ${CAUSE} affects ${EFFECT}.`,
    );
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(edges(refused)).toEqual([`${CAUSE} -> ${EFFECT}`]);
  });
});

/**
 * The two cases the constituent mutation set could not kill, which is why they exist.
 *
 * Both were MISSED by mutants that removed real rules, and a mutant surviving is a statement about
 * the tests rather than about the code:
 *
 *   M-CON-8  restored the wide SERIES lookup over the raw query. Nothing failed, because every
 *            fixture in this file stores company facts and not one stores a series -- so the series
 *            half of the deleted wide retrieval had no test at all. Review's P1 named this exact
 *            gap: "the identical attack works for a fresh stored series".
 *   M-CON-5  removed the branch that lets a SINGLE-clause request be its own constituent. Nothing
 *            failed, because every case here is compound. That branch matters: the prohibition
 *            screen is deliberately broad and a phrase like "target price" trips it on a request
 *            that is one complete, recognised operation. Without the branch that request publishes
 *            nothing, though it plainly asked for something.
 */
const SERIES_SOURCE_CODE = "TEST_ASK_REFUSAL_SERIES";
const SERIES_NAME = "TEST Refusal Widget Index";

describeIfDb("a redirect selects series through the constituent, or not at all", () => {
  let prisma: typeof PrismaClientInstance;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    const source = await prisma.source.upsert({
      where: { code: SERIES_SOURCE_CODE },
      update: {},
      create: { code: SERIES_SOURCE_CODE, name: "Ask Market refusal series", tier: "TIER_S" },
    });
    sourceId = source.id;
    await prisma.observation.deleteMany({ where: { sourceId } });
    await prisma.series.deleteMany({ where: { sourceId } });

    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TEST_REFUSAL_WIDGET",
        name: SERIES_NAME,
        unit: "index",
        frequency: "daily",
      },
    });
    const day = 24 * 60 * 60 * 1000;
    for (const n of [1, 2, 3]) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId,
          observationDate: new Date(Date.now() - n * day),
          value: `${100 + n}.0`,
          raw: {},
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { sourceId } });
    await prisma.series.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  // The control for both tests below. Without it, "no series published" is satisfied by a fixture
  // that never stored one.
  it("serves the series on the authorized path", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    const result = await askMarket(`What is the current ${SERIES_NAME}?`);
    expect(result.status).toBe("FACTORS_FOUND");
    expect(result.seriesFactors.length).toBeGreaterThan(0);
  });

  it("publishes no series when the constituent's own operation yields none", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // DEFINITION is the recognised constituent and this repository holds no glossary, so nothing is
    // published -- even though the series name occurs in the string twice and a wide lookup would
    // find it immediately. That difference is the repair.
    const refused = await askMarket(
      `Should I buy ${SERIES_NAME}? What is the definition of ${SERIES_NAME}?`,
    );
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(refused.seriesFactors).toEqual([]);
  });

  it("serves a single-clause request that is recognised and prohibited at once", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    // One complete CURRENT_OBSERVATION that also trips the advice screen on "target price". The
    // request named an operation, so the redirect answers through it; the verdict stays the
    // prohibition.
    const refused = await askMarket(`What is the current ${SERIES_NAME} target price?`);
    expect(refused.status).toBe("PERSONALIZED_ADVICE_REDIRECTED");
    expect(refused.seriesFactors.length).toBeGreaterThan(0);
  });
});
