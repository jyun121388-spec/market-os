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

  it("returns identical factors whether or not the question asks for advice", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");

    const neutral = await askMarket(NEUTRAL);
    expect(neutral.status).toBe("FACTORS_FOUND");
    // A vacuous pass here would be worse than a failure: it would report coverage this run did
    // not have.
    expect(neutral.companyFacts.length).toBeGreaterThan(0);

    for (const query of ADVICE) {
      const refused = await askMarket(query);
      expect(refused.status, query).toBe("PERSONALIZED_ADVICE_REDIRECTED");
      expect(refused.redirectMessage, query).toBeTruthy();

      // Identical, and in the same order. Order matters: re-ranking the same true figures to lead
      // with the flattering ones would be a recommendation assembled entirely out of facts.
      expect(fingerprint(refused.companyFacts), query).toEqual(fingerprint(neutral.companyFacts));
    }
  });

  it("Verify agrees the rendered answer recommends nothing", async () => {
    const { askMarket } = await import("@/server/domain/askMarket");
    const { verificationInputFromAskMarket } = await import("@/server/verify/fromAskMarket");
    const { verify } = await import("@/server/verify/evaluate");

    const refused = await askMarket(ADVICE[0]);
    const input = verificationInputFromAskMarket(refused);
    expect(input).not.toBeNull();
    expect(input!.advice?.shape).toBe("REFUSAL");
    // Not a vacuous pass: the answer genuinely does put figures on the page underneath the
    // refusal, which is the whole reason this dimension needs to look at the rendered text.
    expect(input!.advice?.figureCount).toBeGreaterThan(0);

    expect(verify(input!).dimensions.adversarial_resilience.status).toBe("PASS");
  });
});
