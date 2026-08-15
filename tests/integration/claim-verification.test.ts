import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_VERIFY_SOURCE";
const OTHER_SOURCE_CODE = "TEST_VERIFY_OTHER_SOURCE";

describeIfDb("claim verification (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let createFactClaimFromObservation: typeof import("@/server/domain/claimStore").createFactClaimFromObservation;
  let verifyClaim: typeof import("@/server/domain/claimVerification").verifyClaim;
  let sourceId: string;
  let otherSourceId: string;
  let observationId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ createFactClaimFromObservation } = await import("@/server/domain/claimStore"));
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
});
