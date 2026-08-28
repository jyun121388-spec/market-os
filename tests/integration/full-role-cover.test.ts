import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Full-role candidate cover, on the DETERMINISTIC path, against a real repository.
 *
 * ESC-015 `EXACT-CANDIDATE-COVER`: a parser labelling text as `subjectRegion` is not proof that all
 * of that role was consumed. Before any row is rendered, the authority-bearing role must be exactly
 * bound to the operation-specific canonical identity with no unexplained residue. A stored name
 * merely OCCURRING inside a larger role is not authority to materialize that stored record.
 *
 * ## Why these tests are here and not at the parser
 *
 * The parser cannot close this. `Purchase Gamma shares.` carries no coordinator, no clause-opening
 * token and no Hangul predicate, and bare `Purchase <security>` is not a decision request to the
 * advice screen either -- both were measured. So the request arrives as one recognised
 * CURRENT_OBSERVATION whose subject region contains the second sentence, and the only remaining
 * place to refuse it is where the row would be chosen.
 *
 * Every negative below must fail for CANDIDATE-RESIDUE reasons. The seeded positive control exists
 * so that "nothing was served" cannot be satisfied by an empty database, which is the failure mode
 * this file would otherwise have.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_FULL_ROLE_COVER";
const SERIES_NAME = "TESTCOVER Alpha";
const OTHER_SERIES_NAME = "TESTCOVER Beta";

describeIfDb("a stored name occurring inside a larger role is not publication authority", () => {
  let prisma: typeof PrismaClientInstance;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    const source = await prisma.source.upsert({
      where: { code: SOURCE_CODE },
      update: {},
      create: { code: SOURCE_CODE, name: "Full-role cover test", tier: "TIER_S" },
    });
    sourceId = source.id;
    await prisma.observation.deleteMany({ where: { sourceId } });
    await prisma.series.deleteMany({ where: { sourceId } });

    const day = 24 * 60 * 60 * 1000;
    for (const name of [SERIES_NAME, OTHER_SERIES_NAME]) {
      const series = await prisma.series.create({
        data: {
          sourceId,
          externalId: `${SOURCE_CODE}_${name.replace(/\s+/g, "_")}`,
          name,
          unit: "index",
          frequency: "daily",
        },
      });
      // Two recent readings, so the series has a cadence and a CURRENT observation exists. Without
      // freshness the positive control returns nothing and every negative below passes vacuously.
      for (const [ago, value] of [
        [1, "102.0"],
        [2, "100.0"],
      ] as const) {
        await prisma.observation.create({
          data: {
            seriesId: series.id,
            sourceId,
            observationDate: new Date(Date.now() - ago * day),
            value,
            raw: {},
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { sourceId } });
    await prisma.series.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  const ask = async (query: string) => {
    const { askMarket } = await import("@/server/domain/askMarket");
    return askMarket(query);
  };
  const served = (r: Awaited<ReturnType<typeof ask>>) =>
    r.seriesFactors.length + r.causalFactors.length + r.companyFacts.length;

  it("serves the exact subject", async () => {
    // NON-VACUITY. Everything below asserts that nothing is served; if this is empty they all pass
    // for the wrong reason and the file proves nothing.
    const r = await ask(`What is the current ${SERIES_NAME}?`);
    expect(r.status, JSON.stringify(r)).toBe("FACTORS_FOUND");
    expect(served(r)).toBeGreaterThan(0);
  });

  it.each([
    // The reproduced P1. `purchase` reaches no guard upstream: not a clause opener, not a decision
    // request. The role is ` <name> purchase gamma shares ` and the stored name occurs inside it.
    ["a bare trading imperative", `What is the current ${SERIES_NAME}. Purchase Gamma shares.`],
    ["a coined tail", `What is the current ${SERIES_NAME}. Zorbulate Gamma.`],
    ["an informational second question", `What is the current ${SERIES_NAME}. Summarize Gamma.`],
    [
      "a known second subject",
      `What is the current ${SERIES_NAME}. What is the current ${OTHER_SERIES_NAME}?`,
    ],
  ])("serves nothing when the role carries %s", async (_label, query) => {
    const r = await ask(query);
    expect(served(r), `${query} -> ${JSON.stringify(r)}`).toBe(0);
    // And the reason must be role authority, not an empty repository. NOT_FOUND is reserved for a
    // role that resolved exactly and whose record is genuinely unavailable.
    expect(r.status, query).not.toBe("NOT_FOUND");
  });
});
