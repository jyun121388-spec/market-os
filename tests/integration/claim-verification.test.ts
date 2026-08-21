import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_VERIFY_SOURCE";
const OTHER_SOURCE_CODE = "TEST_VERIFY_OTHER_SOURCE";

describeIfDb("claim verification (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let createFactClaimFromObservation: typeof import("@/server/domain/claimStore").createFactClaimFromObservation;
  let computeSeriesChange: typeof import("@/server/domain/whatChanged").computeSeriesChange;
  let verifyClaim: typeof import("@/server/domain/claimVerification").verifyClaim;
  let sourceId: string;
  let otherSourceId: string;
  let observationId: string;
  let seriesId: string;
  let otherSeriesId: string;
  let currentObsId: string;
  let previousObsId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ createFactClaimFromObservation } = await import("@/server/domain/claimStore"));
    ({ computeSeriesChange } = await import("@/server/domain/whatChanged"));
    ({ verifyClaim } = await import("@/server/domain/claimVerification"));

    for (const code of [TEST_SOURCE_CODE, OTHER_SOURCE_CODE]) {
      const existing = await prisma.source.findUnique({ where: { code } });
      if (existing) {
        await prisma.claim.deleteMany({ where: { sourceId: existing.id } });
        await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
        await prisma.series.deleteMany({ where: { sourceId: existing.id } });
        await prisma.source.delete({ where: { id: existing.id } });
      }
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Verify Source", tier: "TIER_S" },
    });
    sourceId = source.id;
    const otherSource = await prisma.source.create({
      data: { code: OTHER_SOURCE_CODE, name: "Test Verify Other Source", tier: "TIER_S" },
    });
    otherSourceId = otherSource.id;

    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TESTVERIFY",
        name: "Test Verify Series",
        unit: "percent",
        frequency: "daily",
      },
    });
    seriesId = series.id;

    const observation = await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "3.50",
        raw: {},
      },
    });
    observationId = observation.id;

    // A second series (same source) for the CALCULATION-claim tests, plus a series belonging
    // to OTHER_SOURCE_CODE used for the "different series" tampering test.
    const changeSeries = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TESTVERIFY_CHANGE",
        name: "Test Verify Change Series",
        unit: "percent",
        frequency: "daily",
      },
    });
    const previousObs = await prisma.observation.create({
      data: {
        seriesId: changeSeries.id,
        sourceId,
        observationDate: new Date("2026-08-13T00:00:00.000Z"),
        value: "2.00",
        raw: {},
      },
    });
    const currentObs = await prisma.observation.create({
      data: {
        seriesId: changeSeries.id,
        sourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "2.25",
        raw: {},
      },
    });
    previousObsId = previousObs.id;
    currentObsId = currentObs.id;

    const otherSeries = await prisma.series.create({
      data: {
        sourceId: otherSourceId,
        externalId: "TESTVERIFY_OTHER_SERIES",
        name: "Test Verify Other Series",
        unit: "percent",
        frequency: "daily",
      },
    });
    otherSeriesId = otherSeries.id;
    await prisma.observation.create({
      data: {
        seriesId: otherSeries.id,
        sourceId: otherSourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "2.25", // deliberately the same value as currentObs, for the collision test
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("verifies a claim built by createFactClaimFromObservation", async () => {
    const claim = await createFactClaimFromObservation(observationId);
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("VERIFIED");
  });

  it("flags a claim whose evidence points at a nonexistent observation", async () => {
    const claim = await prisma.claim.create({
      data: {
        claimText: "fabricated value 9.99",
        claimType: "FACT",
        sourceId,
        evidence: { observationId: "does-not-exist" },
      },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("EVIDENCE_NOT_FOUND");
  });

  it("flags a claim with no evidence at all", async () => {
    const claim = await prisma.claim.create({
      data: { claimText: "unverifiable claim", claimType: "FACT", sourceId },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("EVIDENCE_MISSING");
  });

  it("flags a claim whose text doesn't actually contain the evidenced value", async () => {
    const claim = await prisma.claim.create({
      data: {
        claimText: "the value was definitely 999.99",
        claimType: "FACT",
        sourceId,
        evidence: { observationId },
      },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("VALUE_MISMATCH");
  });

  it("flags a claim attributed to the wrong source even if the value text matches", async () => {
    const claim = await prisma.claim.create({
      data: {
        claimText: "value was 3.50",
        claimType: "FACT",
        sourceId: otherSourceId, // wrong source for this observation
        evidence: { observationId },
      },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("VALUE_MISMATCH");
  });

  it("does not attempt to verify non-FACT claims yet", async () => {
    const claim = await prisma.claim.create({
      data: {
        claimText: "this suggests further easing",
        claimType: "INFERENCE",
        confidence: 0.6,
      },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("UNSUPPORTED_CLAIM_TYPE");
  });

  describe("H2 adversarial regressions (structural, not substring, verification)", () => {
    it("rejects a substring collision: real value 3.50, claim text mentions 13.50", async () => {
      // Under the old `claimText.includes(String(value))` check, "13.50" contains "3.50" as a
      // substring and would have false-positive VERIFIED. Exact-text reconstruction must not.
      const claim = await prisma.claim.create({
        data: {
          claimText: "Test Verify Series was 13.50 percent on 2026-08-14 (Test Verify Source)",
          claimType: "FACT",
          sourceId,
          evidence: { observationId, seriesId },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects truthful evidence with a claimText that doesn't match it", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "Something completely different was stated here",
          claimType: "FACT",
          sourceId,
          evidence: { observationId, seriesId },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a FACT claim whose evidence.seriesId doesn't match the evidenced observation's series", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "Test Verify Series was 3.50 percent on 2026-08-14 (Test Verify Source)",
          claimType: "FACT",
          sourceId,
          evidence: { observationId, seriesId: otherSeriesId }, // tampered: wrong series
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("verifies a real CALCULATION claim built by computeSeriesChange", async () => {
      // computeSeriesChange reads the two most recent observations for the series, which are
      // exactly previousObsId/currentObsId seeded above.
      const changeSeries = await prisma.series.findFirstOrThrow({
        where: { externalId: "TESTVERIFY_CHANGE" },
      });
      const result = await computeSeriesChange(changeSeries.id);
      expect(result.status).toBe("COMPUTED");
      const verification = await verifyClaim(result.claimId!);
      expect(verification.status).toBe("VERIFIED");
    });

    it("rejects a CALCULATION claim whose sourceId was repointed at a different source", async () => {
      // Found on 2026-08-17. verifyFactClaim has always compared `claim.sourceId` against the
      // evidenced observation; the CALCULATION path did not. That mattered specifically because
      // `buildChangeClaimText` does not mention the source, so a claim attributing a real change
      // to the WRONG provider reconstructed to byte-identical text and verified as VERIFIED.
      // Provenance is the product's central promise, so a verifier that skips the claimed source
      // on half its claim types is not verifying it.
      const otherSource = await prisma.source.upsert({
        where: { code: "TEST_VERIFY_OTHER_SOURCE" },
        update: {},
        create: { code: "TEST_VERIFY_OTHER_SOURCE", name: "Some other provider", tier: "TIER_S" },
      });

      const changeSeries = await prisma.series.findFirstOrThrow({
        where: { externalId: "TESTVERIFY_CHANGE" },
      });
      const genuine = await computeSeriesChange(changeSeries.id);
      expect(genuine.status).toBe("COMPUTED");
      // Sanity: it verifies before tampering, so the assertion below is about the source alone.
      expect((await verifyClaim(genuine.claimId!)).status).toBe("VERIFIED");

      await prisma.claim.update({
        where: { id: genuine.claimId! },
        data: { sourceId: otherSource.id },
      });

      const result = await verifyClaim(genuine.claimId!);
      expect(result.status).toBe("VALUE_MISMATCH");
      expect(result.detail).toMatch(/sourceId/i);

      // Only the claim is cleaned up. The throwaway source is left in place: it is upserted by
      // code, so re-running is idempotent, and deleting it would fail once anything else in the
      // suite has attached a row to it.
      await prisma.claim.deleteMany({ where: { sourceId: otherSource.id } });
    });

    it("rejects a CALCULATION claim referencing observations from different series", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "fabricated cross-series change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId,
            currentObservationId: currentObsId, // belongs to changeSeries, not `series`
            previousObservationId: observationId, // belongs to `series`
            absoluteChange: 0,
            percentChange: 0,
            bpsChange: 0,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with reversed current/previous order", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "reversed order claim",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: previousObsId, // swapped
            previousObservationId: currentObsId, // swapped
            absoluteChange: -0.25,
            percentChange: -11.11,
            bpsChange: -25,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with a tampered absoluteChange", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "tampered absolute change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: currentObsId,
            previousObservationId: previousObsId,
            absoluteChange: 99, // real delta is 0.25
            percentChange: 12.5,
            bpsChange: 25,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with a tampered percentChange", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "tampered percent change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: currentObsId,
            previousObservationId: previousObsId,
            absoluteChange: 0.25, // this part is correct
            percentChange: 999, // real percentChange is 12.5
            bpsChange: 25,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with a tampered bpsChange", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "tampered bps change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: currentObsId,
            previousObservationId: previousObsId,
            absoluteChange: 0.25,
            percentChange: 12.5,
            bpsChange: 999999, // real bpsChange is 25
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });
  });
});
