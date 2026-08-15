import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import { InvalidClaimError } from "@/server/domain/claimLedger";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_CLAIM_SOURCE";

describeIfDb("claim store (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let createClaim: typeof import("@/server/domain/claimStore").createClaim;
  let createFactClaimFromObservation: typeof import("@/server/domain/claimStore").createFactClaimFromObservation;
  let sourceId: string;
  let seriesId: string;
  let observationId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ createClaim, createFactClaimFromObservation } = await import("@/server/domain/claimStore"));

    const existing = await prisma.source.findUnique({ where: { code: TEST_SOURCE_CODE } });
    if (existing) {
      await prisma.claim.deleteMany({ where: { sourceId: existing.id } });
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Claim Source", tier: "TIER_S" },
    });
    sourceId = source.id;

    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TEST10Y",
        name: "Test 10-Year Yield",
        unit: "percent",
        frequency: "daily",
      },
    });
    seriesId = series.id;

    const observation = await prisma.observation.create({
      data: {
        seriesId,
        sourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "4.25",
        raw: { value: "4.25" },
      },
    });
    observationId = observation.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("createClaim persists a valid FACT claim", async () => {
    const claim = await createClaim({
      claimText: "test fact",
      claimType: "FACT",
      sourceId,
    });
    expect(claim.claimType).toBe("FACT");
    expect(claim.sourceId).toBe(sourceId);
  });

  it("createClaim rejects an unsourced FACT claim before it ever reaches the database", async () => {
    await expect(createClaim({ claimText: "unsourced fact", claimType: "FACT" })).rejects.toThrow(
      InvalidClaimError,
    );

    const count = await prisma.claim.count({ where: { claimText: "unsourced fact" } });
    expect(count).toBe(0); // never written — rejected before the DB write, not after
  });

  it("createFactClaimFromObservation builds a sourced FACT claim from a real Observation", async () => {
    const claim = await createFactClaimFromObservation(observationId);
    expect(claim.claimType).toBe("FACT");
    expect(claim.sourceId).toBe(sourceId);
    expect(claim.claimText).toContain("4.25");
    expect(claim.claimText).toContain("Test 10-Year Yield");
    expect((claim.evidence as { observationId: string }).observationId).toBe(observationId);
  });

  it("throws on a nonexistent observation rather than fabricating a claim", async () => {
    await expect(createFactClaimFromObservation("nonexistent-id")).rejects.toThrow();
  });
});
