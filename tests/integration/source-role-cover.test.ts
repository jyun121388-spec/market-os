import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Full-role cover on the SOURCE role, against a real repository.
 *
 * ESC-015 §8: an ATTRIBUTED_REPORTED_OBSERVATION must bind BOTH `sourceRegion` and `subjectRegion`
 * exactly. The subject side is covered; `resolveSourceIdentity` still resolved by occurrence, and
 * the parser really does hand it roles with residue in them -- measured before writing any of this,
 * with `scripts/probe-source-role-residue.ts`:
 *
 *     What did Reuters Purchase Gamma shares publish about Alpha?
 *       -> AUTHORIZED, sourceRegion "reuters purchase gamma shares"
 *
 * A provider's attribution is a stronger claim than a figure. Publishing a reading as "what Reuters
 * reported" because `Reuters` occurred somewhere in a role that also said `Purchase Gamma shares`
 * attributes to a real news organisation something it did not say.
 *
 * ## The capability this deliberately gives up
 *
 * `What did the Reuters desk publish about Alpha?` refuses too, because `desk` is not framing and
 * the role is therefore not explained by the stored identity. That is a real loss and it fails
 * closed: the alternative is to accept unexplained words next to a provider's name, which is the
 * defect above with friendlier wording.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_NAME = "TESTSRCCOVER Wire";
const SOURCE_CODE = "TEST_SOURCE_ROLE_COVER";
const SERIES_NAME = "TESTSRCCOVER Alpha";

describeIfDb(
  "a stored source name occurring inside a larger role is not attribution authority",
  () => {
    let prisma: typeof PrismaClientInstance;
    let sourceId: string;

    beforeAll(async () => {
      ({ prisma } = await import("@/server/db/client"));
      const source = await prisma.source.upsert({
        where: { code: SOURCE_CODE },
        update: { name: SOURCE_NAME },
        create: { code: SOURCE_CODE, name: SOURCE_NAME, tier: "TIER_S" },
      });
      sourceId = source.id;
      await prisma.observation.deleteMany({ where: { sourceId } });
      await prisma.series.deleteMany({ where: { sourceId } });

      const series = await prisma.series.create({
        data: {
          sourceId,
          externalId: `${SOURCE_CODE}_SERIES`,
          name: SERIES_NAME,
          unit: "index",
          frequency: "daily",
        },
      });
      const day = 24 * 60 * 60 * 1000;
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

    it("serves the exact source role", async () => {
      // NON-VACUITY. Every negative below asserts nothing is served; without this they would all
      // pass against an empty repository and the file would prove nothing.
      const r = await ask(`What did ${SOURCE_NAME} publish about ${SERIES_NAME}?`);
      expect(r.status, JSON.stringify(r)).toBe("FACTORS_FOUND");
      expect(served(r)).toBeGreaterThan(0);
    });

    it.each([
      [
        "a trading directive",
        `What did ${SOURCE_NAME} Purchase Gamma shares publish about ${SERIES_NAME}?`,
      ],
      ["a coined tail", `What did ${SOURCE_NAME} Zorbulate publish about ${SERIES_NAME}?`],
      ["an unexplained qualifier", `What did some ${SOURCE_NAME} publish about ${SERIES_NAME}?`],
      [
        "an organisational sub-unit",
        `What did the ${SOURCE_NAME} desk publish about ${SERIES_NAME}?`,
      ],
    ])("attributes nothing when the source role carries %s", async (_label, query) => {
      const r = await ask(query);
      expect(served(r), `${query} -> ${JSON.stringify(r)}`).toBe(0);
      // Role authority, not a data gap. NOT_FOUND would say this repository holds nothing from that
      // provider, which is false -- it holds a reading, and the request did not name the provider
      // exactly.
      expect(r.status, query).not.toBe("NOT_FOUND");
    });
  },
);

/**
 * The two identities a source role can be explained by, and what happens when both answer.
 *
 * `resolveSourceIdentity` matches a provider by NAME or by CODE, and normalization maps `_` to a
 * space -- so the code `TESTSRCAMB_WIRE` and the name `TESTSRCAMB Wire` are the same string by the
 * time either is compared to a role. Two different providers can therefore both completely cover
 * one source role, which is not true on the series path: there, discovery keeps only the maximal
 * name and the shorter one never reaches cover.
 *
 * Both cases were found by mutation rather than by review. `M-ROLE-SOURCE-NAME-ONLY` (delete the
 * code as an identity) and `M-ROLE-SOURCE-AMBIGUOUS` (resolve two covering providers by taking the
 * first) both survived, and the AMBIGUOUS branch turned out never to have had a test at all --
 * older than the cover work, and reachable.
 */
describeIfDb("which identity explains the source role", () => {
  let prisma: typeof PrismaClientInstance;
  const codes = ["TESTSRCAMB_WIRE", "TESTSRCAMB_OTHER"];
  let servingId = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    // One provider carries the name; the other carries the SAME string as its code.
    const named = await prisma.source.upsert({
      where: { code: codes[1] },
      update: { name: "TESTSRCAMB Wire" },
      create: { code: codes[1], name: "TESTSRCAMB Wire", tier: "TIER_S" },
    });
    const coded = await prisma.source.upsert({
      where: { code: codes[0] },
      update: { name: "TESTSRCAMB Unrelated Provider" },
      create: { code: codes[0], name: "TESTSRCAMB Unrelated Provider", tier: "TIER_S" },
    });
    servingId = coded.id;
    for (const id of [named.id, coded.id]) {
      await prisma.observation.deleteMany({ where: { sourceId: id } });
      await prisma.series.deleteMany({ where: { sourceId: id } });
    }
    const series = await prisma.series.create({
      data: {
        sourceId: coded.id,
        externalId: "TESTSRCAMB_SERIES",
        name: "TESTSRCAMB Alpha",
        unit: "index",
        frequency: "daily",
      },
    });
    const day = 24 * 60 * 60 * 1000;
    for (const [ago, value] of [
      [1, "102.0"],
      [2, "100.0"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: coded.id,
          observationDate: new Date(Date.now() - ago * day),
          value,
          raw: {},
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { sourceId: servingId } });
    await prisma.series.deleteMany({ where: { sourceId: servingId } });
    await prisma.source.deleteMany({ where: { code: { in: codes } } });
    await prisma.$disconnect();
  });

  const ask = async (query: string) => {
    const { askMarket } = await import("@/server/domain/askMarket");
    return askMarket(query);
  };

  it("resolves a provider named by its code", async () => {
    // Codes are user-facing names here -- FRED, ECOS, DART, EDGAR are what a person types. If the
    // code stopped being an identity that can explain a role, this would serve nothing.
    const r = await ask("What did TESTSRCAMB Unrelated Provider publish about TESTSRCAMB Alpha?");
    expect(r.status, JSON.stringify(r)).toBe("FACTORS_FOUND");
    expect(r.seriesFactors.length).toBeGreaterThan(0);
  });

  it("refuses when a name and a code both explain the whole role", async () => {
    // Not a tie to be broken. Attributing the reading to either provider would state that a
    // particular organisation reported it, on the strength of a collision between one provider's
    // code and another's name.
    const r = await ask("What did TESTSRCAMB Wire publish about TESTSRCAMB Alpha?");
    expect(r.seriesFactors.length + r.companyFacts.length, JSON.stringify(r)).toBe(0);
    expect(r.status).toBe("REQUEST_NOT_SUPPORTED");
    expect(r.redirectMessage).toContain("more than one provider");
  });
});
