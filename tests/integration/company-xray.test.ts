import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Company X-Ray read model (M15/M16's missing view).
 *
 * The non-trivial part is `latestFigures`: one row per (concept, period LENGTH), not per concept.
 * A filing reports the same concept over several spans ending on the same date — nine months and
 * three months — and collapsing them to "the latest" would silently pick one of two very
 * different numbers with nothing to indicate a choice had been made.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_COMPANY_XRAY_SOURCE";
const CORP_CODE = "TEST_XRAY_CORP";

describeIfDb("computeCompanyXray (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeCompanyXray: typeof import("@/server/domain/companyXray").computeCompanyXray;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeCompanyXray } = await import("@/server/domain/companyXray"));

    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (existing) {
      await prisma.financialFact.deleteMany({ where: { sourceId: existing.id } });
      await prisma.filing.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }

    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Company X-Ray test source", tier: "TIER_S" },
    });
    sourceId = source.id;

    await prisma.filing.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        corpName: "TEST X-Ray Corp",
        stockCode: "XRAY",
        reportName: "10-Q (2026 Q3)",
        receiptNo: "XRAY-0001",
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
      fiscalYear: 2026,
      fiscalPeriod: "Q3",
      form: "10-Q",
      raw: {},
    };

    await prisma.financialFact.createMany({
      data: [
        // Nine months and three months, same period end, same accession.
        {
          ...common,
          periodStart: new Date("2025-09-28T00:00:00.000Z"),
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          accessionNumber: "XRAY-ACCN-2",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "364357000000",
        },
        {
          ...common,
          periodStart: new Date("2026-03-29T00:00:00.000Z"),
          periodEnd: new Date("2026-06-27T00:00:00.000Z"),
          accessionNumber: "XRAY-ACCN-2",
          filedDate: new Date("2026-07-31T00:00:00.000Z"),
          value: "109417000000",
        },
        // The previous quarter, so a like-for-like comparison exists.
        {
          ...common,
          periodStart: new Date("2025-12-29T00:00:00.000Z"),
          periodEnd: new Date("2026-03-28T00:00:00.000Z"),
          accessionNumber: "XRAY-ACCN-1",
          filedDate: new Date("2026-05-01T00:00:00.000Z"),
          value: "111184000000",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.financialFact.deleteMany({ where: { sourceId } });
    await prisma.filing.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  it("returns null for a company with nothing stored, rather than an empty shell", async () => {
    expect(await computeCompanyXray("NO_SUCH_CORP")).toBeNull();
  });

  it("keeps one latest figure per period length, each labelled with what it covers", async () => {
    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.company.corpName).toBe("TEST X-Ray Corp");
    expect(xray.company.stockCode).toBe("XRAY");

    const revenues = xray.latestFigures.filter((f) => f.concept === "Revenues");
    // Both the nine-month and the three-month figure, not one silently chosen.
    expect(revenues).toHaveLength(2);
    expect(revenues.map((f) => f.periodMonths).sort()).toEqual([3, 9]);

    const quarterly = revenues.find((f) => f.periodMonths === 3)!;
    expect(quarterly.value).toBe(109417000000);
    expect(quarterly.periodStart).toBe("2026-03-29");
    expect(quarterly.periodEnd).toBe("2026-06-27");

    const nineMonth = revenues.find((f) => f.periodMonths === 9)!;
    expect(nineMonth.value).toBe(364357000000);
  });

  it("compares like with like, and never the two figures from one filing", async () => {
    const xray = (await computeCompanyXray(CORP_CODE))!;
    const change = xray.changes.find((c) => c.concept === "Revenues")!;

    expect(change.status).toBe("COMPUTED");
    expect(change.currentValue).toBe(109417000000);
    expect(change.previousValue).toBe(111184000000);
    expect(change.periodMonths).toBe(3);
    // The nine-month figure is present in the data and must not be the comparison basis.
    expect(change.previousValue).not.toBe(364357000000);
  });

  it("reports UNKNOWN completeness when no ingest run was ever recorded", async () => {
    // Absence of a record is not evidence of completeness. The runs table only started being
    // written recently, so a company with no run is genuinely unknown and must say so rather
    // than defaulting to a reassuring answer.
    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("UNKNOWN");
    expect(xray.completeness.detail).toMatch(/not evidence of completeness/i);
  });

  it("surfaces a truncated ingest as KNOWN_INCOMPLETE, with the shortfall", async () => {
    // A truncation flag reaching only the admin dashboard is little use to the person reading
    // the numbers. If the last run stored less than the provider reported, the page built from
    // it must say so — a subset of a filing history reads exactly like the whole of one.
    const { recordIngestRun } = await import("@/server/domain/ingestRun");
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: CORP_CODE }, async () => ({
      inserted: 100,
      providerTotal: 5000,
      fetched: 100,
      truncated: true,
    }));

    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("KNOWN_INCOMPLETE");
    expect(xray.completeness.detail).toContain("100 of 5000");

    await prisma.ingestRun.deleteMany({ where: { sourceId } });
  });

  it("surfaces a failed ingest distinctly from a truncated one", async () => {
    const { recordIngestRun } = await import("@/server/domain/ingestRun");
    await expect(
      recordIngestRun({ sourceCode: SOURCE_CODE, target: CORP_CODE }, async () => {
        throw new Error("provider returned 503");
      }),
    ).rejects.toThrow();

    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("LAST_RUN_FAILED");

    await prisma.ingestRun.deleteMany({ where: { sourceId } });
  });

  it("reports COMPLETE only when the last run retrieved everything reported", async () => {
    const { recordIngestRun } = await import("@/server/domain/ingestRun");
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: CORP_CODE }, async () => ({
      inserted: 3,
      providerTotal: 3,
      fetched: 3,
      truncated: false,
    }));

    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("COMPLETE");

    await prisma.ingestRun.deleteMany({ where: { sourceId } });
  });

  it("exposes no field that could carry a score, rating or recommendation", async () => {
    // Structural guardrail, the same approach tests/etfSchemaGuardrail.test.ts takes: the shape
    // itself must make a judgment unrepresentable, so one cannot be added by accident later.
    const xray = (await computeCompanyXray(CORP_CODE))!;
    const serialized = JSON.stringify(xray).toLowerCase();
    for (const forbidden of ["rating", "score", "recommend", "target", "verdict", "opinion"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
