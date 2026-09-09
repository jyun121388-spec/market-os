import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * The filings/evidence reader, against a real database.
 *
 * `listCompanyFilings` exists because `recentFilings` takes ten — right for a summary on a page
 * about figures, wrong for a page about the filings themselves. The controls below are about the
 * two things a truncating list can get quietly wrong: saying how many it did not show, and coming
 * back in the same order twice.
 *
 * The comparison evidence itself is `computeFilingDiff`, unchanged and re-read here only to prove
 * both accessions survive to a consumer — the whole reason the evidence page was added is that
 * they were on the result and nothing rendered them.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_FILINGS_EVIDENCE";
const CORP_CODE = "0000000902";

describeIfDb("filings and comparison evidence over real rows", () => {
  let prisma: typeof PrismaClientInstance;
  let listCompanyFilings: typeof import("@/server/domain/companyXray").listCompanyFilings;
  let computeCompanyXray: typeof import("@/server/domain/companyXray").computeCompanyXray;
  let sourceId: string;

  async function cleanup() {
    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (!existing) return;
    await prisma.financialFact.deleteMany({ where: { sourceId: existing.id } });
    await prisma.filing.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ listCompanyFilings, computeCompanyXray } = await import("@/server/domain/companyXray"));
    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Filings evidence", tier: "TIER_S" },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    await prisma.financialFact.deleteMany({ where: { sourceId } });
    await prisma.filing.deleteMany({ where: { sourceId } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function filing(receiptNo: string, receiptDate: string, remark: string | null = null) {
    await prisma.filing.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        corpName: "Evidence Fixture Inc.",
        stockCode: null,
        reportName: `Report ${receiptNo}`,
        receiptNo,
        receiptDate: new Date(`${receiptDate}T00:00:00.000Z`),
        remark,
        raw: {},
      },
    });
  }

  async function fact(over: {
    value: string;
    periodStart: string;
    periodEnd: string;
    accessionNumber: string;
    filedDate: string;
  }) {
    await prisma.financialFact.create({
      data: {
        sourceId,
        corpCode: CORP_CODE,
        taxonomy: "us-gaap",
        concept: "NetIncomeLoss",
        unit: "USD",
        periodStart: new Date(`${over.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${over.periodEnd}T00:00:00.000Z`),
        fiscalYear: Number(over.periodEnd.slice(0, 4)),
        fiscalPeriod: "FY",
        form: "10-K",
        accessionNumber: over.accessionNumber,
        filedDate: new Date(`${over.filedDate}T00:00:00.000Z`),
        value: over.value,
        raw: {},
      },
    });
  }

  it("reports how many it did NOT show, so a truncated list cannot read as the whole history", async () => {
    for (let i = 1; i <= 7; i++) {
      await filing(`0000000902-26-00000${i}`, `2026-0${i}-01`);
    }
    const page = (await listCompanyFilings(CORP_CODE, SOURCE_CODE, 3))!;
    expect(page.total).toBe(7);
    expect(page.rows).toHaveLength(3);
    expect(page.limit).toBe(3);
    // Newest first, so a cap drops the OLDEST rather than an arbitrary three.
    expect(page.rows.map((r) => r.receiptDate)).toEqual(["2026-07-01", "2026-06-01", "2026-05-01"]);
  });

  it("returns the same order twice when several filings share a date", async () => {
    // `receiptDate` is a date, so a company filing three documents on one day has rows Postgres
    // may return in any order. An evidence list that rearranges itself between two requests is
    // not evidence — the same millisecond-resolution trap as the observation revision chain.
    await filing("0000000902-26-000003", "2026-03-01");
    await filing("0000000902-26-000001", "2026-03-01");
    await filing("0000000902-26-000002", "2026-03-01");

    const first = (await listCompanyFilings(CORP_CODE, SOURCE_CODE))!;
    const second = (await listCompanyFilings(CORP_CODE, SOURCE_CODE))!;
    expect(first.rows.map((r) => r.receiptNo)).toEqual(second.rows.map((r) => r.receiptNo));
    expect(first.rows.map((r) => r.receiptNo)).toEqual([
      "0000000902-26-000003",
      "0000000902-26-000002",
      "0000000902-26-000001",
    ]);
  });

  it("carries the provider's own remark through rather than dropping it", async () => {
    await filing("0000000902-26-000001", "2026-01-01", "정정");
    const page = (await listCompanyFilings(CORP_CODE, SOURCE_CODE))!;
    expect(page.rows[0].remark).toBe("정정");
  });

  it("is empty rather than absent for a company with no filings, and says the total is zero", async () => {
    const page = (await listCompanyFilings(CORP_CODE, SOURCE_CODE))!;
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });

  it("returns null for a provider that does not exist rather than an empty page", async () => {
    // An empty page says "this company has no filings here". Null says "there is no such
    // provider". A caller that cannot tell those apart renders the wrong sentence.
    expect(await listCompanyFilings(CORP_CODE, "NO_SUCH_SOURCE")).toBeNull();
  });

  it("a comparison carries BOTH accessions, which is what the evidence page renders", async () => {
    await filing("0000000902-25-000001", "2025-02-01");
    await filing("0000000902-26-000001", "2026-02-01");
    await fact({
      value: "1000",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      accessionNumber: "0000000902-25-000001",
      filedDate: "2025-02-01",
    });
    await fact({
      value: "1500",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000902-26-000001",
      filedDate: "2026-02-01",
    });

    const xray = (await computeCompanyXray(CORP_CODE, SOURCE_CODE))!;
    const change = xray.changes.find((c) => c.concept === "NetIncomeLoss")!;
    expect(change.status).toBe("COMPUTED");
    expect(change.currentAccession).toBe("0000000902-26-000001");
    expect(change.previousAccession).toBe("0000000902-25-000001");
    // Both must resolve to filings actually stored, or the "evidence" is two labels.
    for (const accession of [change.currentAccession!, change.previousAccession!]) {
      const stored = await prisma.filing.findFirst({ where: { sourceId, receiptNo: accession } });
      expect(stored, accession).not.toBeNull();
    }
  });

  it("a single period yields no comparison, and says so rather than inventing one", async () => {
    await filing("0000000902-26-000001", "2026-02-01");
    await fact({
      value: "1500",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      accessionNumber: "0000000902-26-000001",
      filedDate: "2026-02-01",
    });

    const xray = (await computeCompanyXray(CORP_CODE, SOURCE_CODE))!;
    const change = xray.changes.find((c) => c.concept === "NetIncomeLoss")!;
    expect(change.status).toBe("INSUFFICIENT_DATA");
    expect(change.currentAccession).toBeUndefined();
    expect(change.percentChange).toBeUndefined();
  });
});
