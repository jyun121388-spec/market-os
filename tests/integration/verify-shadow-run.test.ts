import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Verify shadow run against REAL v1 output (docs/VERIFY_ARCHITECTURE.md).
 *
 * The evaluators were written against reconstructed historical defects. This exercises them
 * through the actual Company X-Ray → Filing Diff path, which is the only way to find out whether
 * they say anything useful about what the product really produces.
 *
 * It already has: the first live run returned INSUFFICIENT_EVIDENCE for all eight Apple outputs
 * while every correctness dimension passed, because SEC publishes no fact total. That semantic
 * error was invisible against fixtures and obvious against real data.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_VERIFY_SHADOW_SOURCE";
const CORP_CODE = "TEST_VSHADOW_CORP";

describeIfDb("Verify shadow run (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let shadowVerifyCompany: typeof import("@/server/verify/shadowRun").shadowVerifyCompany;
  let sourceId: string;

  async function cleanup() {
    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (!existing) return;
    await prisma.ingestRun.deleteMany({ where: { sourceId: existing.id } });
    await prisma.financialFact.deleteMany({ where: { sourceId: existing.id } });
    await prisma.filing.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ shadowVerifyCompany } = await import("@/server/verify/shadowRun"));

    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Verify shadow test source", tier: "TIER_S" },
    });
    sourceId = source.id;

    await prisma.filing.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        corpName: "TEST Verify Shadow Corp",
        reportName: "10-Q",
        receiptNo: "VSHADOW-1",
        receiptDate: new Date("2026-07-31T00:00:00.000Z"),
        raw: {},
      },
    });

    const common = {
      sourceId,
      corpCode: CORP_CODE,
      taxonomy: "us-gaap",
      concept: "Revenues",
      unit: "USD",
      form: "10-Q",
      raw: {},
    };
    // Two consecutive, genuinely comparable quarters — the case that must come back clean.
    await prisma.financialFact.createMany({
      data: [
        {
          ...common,
          periodStart: new Date("2025-12-29T00:00:00.000Z"),
          periodEnd: new Date("2026-03-28T00:00:00.000Z"),
          accessionNumber: "VS-1",
          filedDate: new Date("2026-05-01T00:00:00.000Z"),
          value: "111184000000",
        },
        {
          ...common,
          periodStart: new Date("2026-03-29T00:00:00.000Z"),
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          accessionNumber: "VS-2",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "109417000000",
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("produces a verdict for a real Filing Diff, with every dimension recorded", () => {
    return shadowVerifyCompany(CORP_CODE).then((run) => {
      expect(run.observations.length).toBeGreaterThan(0);
      const o = run.observations[0];
      expect(o.outputType).toBe("FILING_DIFF");
      expect(o.entityRef).toBe(CORP_CODE);
      expect(o.sourceCode).toBe(SOURCE_CODE);
      // A uniform verdict with no breakdown is indistinguishable from a broken verifier.
      expect(Object.keys(o.dimensions).length).toBe(9);
    });
  });

  it("does not reject a correct, genuinely comparable quarter-over-quarter change", () => {
    // The negative control, and the one that decides whether this is worth promoting. Every
    // correctness dimension must pass on real output that is actually right.
    return shadowVerifyCompany(CORP_CODE).then((run) => {
      const o = run.observations.find((x) => x.outputId.includes("Revenues"))!;
      expect(o.verdict).not.toBe("REJECTED");
      expect(o.failed).toEqual([]);
      for (const dimension of [
        "semantic_consistency",
        "calculation_integrity",
        "source_integrity",
        "provenance_integrity",
      ]) {
        expect(o.dimensions[dimension], `${dimension} on correct output`).toBe("PASS");
      }
    });
  });

  it("carries the completeness state the page itself shows, not a rosier one", () => {
    return shadowVerifyCompany(CORP_CODE).then((run) => {
      // No ingest run was recorded for this fixture, so the honest answer is UNKNOWN. A verifier
      // that quietly assumed COMPLETE here would be grading a version of reality nobody sees.
      expect(run.observations[0].completeness).toBe("UNKNOWN");
    });
  });

  it("returns nothing for a company that does not exist, rather than inventing a verdict", () => {
    return shadowVerifyCompany("NO_SUCH_CORP").then((run) => {
      expect(run.observations).toEqual([]);
    });
  });

  it("writes nothing", async () => {
    const before = await Promise.all([
      prisma.financialFact.count(),
      prisma.filing.count(),
      prisma.ingestRun.count(),
    ]);
    await shadowVerifyCompany(CORP_CODE);
    const after = await Promise.all([
      prisma.financialFact.count(),
      prisma.filing.count(),
      prisma.ingestRun.count(),
    ]);
    expect(after).toEqual(before);
  });
});
