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
/** A second provider reusing the same corp code. See the provenance test at the bottom. */
const OTHER_SOURCE_CODE = "TEST_COMPANY_XRAY_OTHER_SOURCE";

describeIfDb("computeCompanyXray (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeCompanyXray: typeof import("@/server/domain/companyXray").computeCompanyXray;
  let sourceId: string;
  let otherSourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeCompanyXray } = await import("@/server/domain/companyXray"));

    for (const code of [SOURCE_CODE, OTHER_SOURCE_CODE]) {
      const existing = await prisma.source.findUnique({ where: { code } });
      if (existing) {
        await deleteSourceAndDependents(existing.id);
      }
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

    // A DIFFERENT provider that happens to use the same corp code string. It files EARLIER, so
    // the page still identifies the company as the first source's — which is exactly the
    // dangerous case: the header is right, and the body quietly carries a second provider's
    // filings and a foreign-currency figure alongside it.
    const otherSource = await prisma.source.create({
      data: { code: OTHER_SOURCE_CODE, name: "Company X-Ray other source", tier: "TIER_S" },
    });
    otherSourceId = otherSource.id;
    await prisma.filing.create({
      data: {
        sourceId: otherSourceId,
        corpCode: CORP_CODE,
        corpName: "TOTALLY DIFFERENT COMPANY",
        stockCode: "OTHER",
        reportName: "OTHER-PROVIDER-REPORT",
        receiptNo: "OTHER-0001",
        receiptDate: new Date("2025-01-15T00:00:00.000Z"),
        raw: {},
      },
    });
    await prisma.financialFact.create({
      data: {
        sourceId: otherSourceId,
        corpCode: CORP_CODE,
        taxonomy: "ifrs-full",
        concept: "Revenues",
        unit: "KRW",
        periodStart: new Date("2024-10-01T00:00:00.000Z"),
        periodEnd: new Date("2024-12-31T00:00:00.000Z"),
        fiscalYear: 2024,
        fiscalPeriod: "Q4",
        form: "OTHER-PROVIDER-FORM",
        accessionNumber: "OTHER-ACCN",
        filedDate: new Date("2025-01-15T00:00:00.000Z"),
        value: "999999999",
        raw: {},
      },
    });
  });

  /**
   * Removes a test source and everything pointing at it.
   *
   * `ingest_runs` matters and was missing: the completeness tests below write runs, and a
   * source cannot be deleted while one references it. Any run that aborted part-way therefore
   * left rows that made the NEXT run's setup fail on a foreign key — reported by vitest as a
   * skipped suite, which reads exactly like "no database configured". A test file that cannot
   * clean up after an interrupted run silently stops testing anything.
   */
  async function deleteSourceAndDependents(id: string) {
    await prisma.ingestRun.deleteMany({ where: { sourceId: id } });
    await prisma.financialFact.deleteMany({ where: { sourceId: id } });
    await prisma.filing.deleteMany({ where: { sourceId: id } });
    await prisma.source.delete({ where: { id } });
  }

  afterAll(async () => {
    for (const id of [sourceId, otherSourceId]) {
      if (id) await deleteSourceAndDependents(id);
    }
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

  it("does not claim COMPLETE when the provider never stated a total", async () => {
    // Found by independent review (`gpt-5.6-terra`) and confirmed against the real database:
    // all 20 recorded ingest runs have providerTotal NULL, so /company/0000320193 was telling
    // readers "the most recent ingest retrieved everything the provider reported" when the
    // provider reported no total at all.
    //
    // This is the same rule the no-run branch of this function already states — absence of a
    // record is not evidence of completeness — applied inconsistently two branches later. A
    // successful run with nothing to compare against proves no shortfall was DETECTED, which is
    // a weaker claim than completeness and has to read as one.
    const { recordIngestRun } = await import("@/server/domain/ingestRun");
    await prisma.ingestRun.deleteMany({ where: { sourceId } });
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: CORP_CODE }, async () => ({
      inserted: 3,
      providerTotal: null,
      fetched: 3,
      truncated: false,
    }));

    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("UNCONFIRMED");
    expect(xray.completeness.detail).toMatch(/did not state a total/i);
    // Must not overstate: no claim of having retrieved everything.
    expect(xray.completeness.detail).not.toMatch(/retrieved everything/i);

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

  it("does not merge two providers that happen to share a corp code", async () => {
    // The page prints ONE source code, taken from the most recent filing, then counts filings
    // and lists figures for the corp code across EVERY source. `listCompanies` already groups by
    // (corpCode, sourceId) and reports these as two separate companies, so the index and the
    // detail page disagreed about how many companies exist — and the detail page was the one
    // presenting a merged entity as a single sourced record.
    const xray = (await computeCompanyXray(CORP_CODE))!;

    // Everything shown must belong to the one source the page names.
    expect(xray.company.sourceCode).toBe(SOURCE_CODE);
    expect(xray.company.corpName).toBe("TEST X-Ray Corp");
    expect(xray.company.filingCount).toBe(1);
    expect(xray.company.stockCode).toBe("XRAY");
    expect(xray.latestFigures.every((f) => f.unit === "USD")).toBe(true);
    expect(xray.latestFigures.map((f) => f.value)).not.toContain(999999999);
    expect(xray.recentFilings.every((f) => f.reportName !== "OTHER-PROVIDER-REPORT")).toBe(true);
  });
  it("does not let an INCREMENTAL success clear an earlier truncation", async () => {
    // Terra''s finding, reproduced. assessCompleteness reduced to "the most recent run per
    // target", so a truncated all-history run followed by a successful partial rerun reported
    // COMPLETE while the old filings nobody re-fetched were still missing.
    //
    // Only a later FULL run can repair that. IngestRun had no way to say which kind it was,
    // which is why this needed a migration rather than a query change.
    const { recordIngestRun } = await import("@/server/domain/ingestRun");
    await prisma.ingestRun.deleteMany({ where: { sourceId } });

    await recordIngestRun(
      { sourceCode: SOURCE_CODE, target: CORP_CODE, mode: "FULL" },
      async () => ({ inserted: 1000, providerTotal: 2240, fetched: 1000, truncated: true }),
    );
    await recordIngestRun(
      { sourceCode: SOURCE_CODE, target: CORP_CODE, mode: "INCREMENTAL" },
      async () => ({ inserted: 3, providerTotal: 3, fetched: 3, truncated: false }),
    );

    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("KNOWN_INCOMPLETE");
    expect(xray.completeness.detail).toMatch(/only added to what was already stored/i);

    await prisma.ingestRun.deleteMany({ where: { sourceId } });
  });

  it("lets a later FULL success clear an earlier truncation", async () => {
    // The negative control. Without it the rule above would simply mark every company that was
    // ever truncated as permanently incomplete, which is its own false statement.
    const { recordIngestRun } = await import("@/server/domain/ingestRun");
    await prisma.ingestRun.deleteMany({ where: { sourceId } });

    await recordIngestRun(
      { sourceCode: SOURCE_CODE, target: CORP_CODE, mode: "FULL" },
      async () => ({ inserted: 1000, providerTotal: 2240, fetched: 1000, truncated: true }),
    );
    await recordIngestRun(
      { sourceCode: SOURCE_CODE, target: CORP_CODE, mode: "FULL" },
      async () => ({ inserted: 2240, providerTotal: 2240, fetched: 2240, truncated: false }),
    );

    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("COMPLETE");

    await prisma.ingestRun.deleteMany({ where: { sourceId } });
  });

  it("treats an UNKNOWN-mode success as not having repaired anything", async () => {
    // Rows predating this distinction default to UNKNOWN. Assuming FULL for them would
    // retroactively declare gaps repaired that nobody re-fetched - inventing certainty about
    // runs no one observed.
    const { recordIngestRun } = await import("@/server/domain/ingestRun");
    await prisma.ingestRun.deleteMany({ where: { sourceId } });

    await recordIngestRun({ sourceCode: SOURCE_CODE, target: CORP_CODE }, async () => ({
      inserted: 1000,
      providerTotal: 2240,
      fetched: 1000,
      truncated: true,
    }));
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: CORP_CODE }, async () => ({
      inserted: 3,
      providerTotal: 3,
      fetched: 3,
      truncated: false,
    }));

    const xray = (await computeCompanyXray(CORP_CODE))!;
    expect(xray.completeness.status).toBe("KNOWN_INCOMPLETE");

    await prisma.ingestRun.deleteMany({ where: { sourceId } });
  });
});
