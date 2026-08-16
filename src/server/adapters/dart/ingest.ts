import { prisma } from "@/server/db/client";
import { fetchAllDartDisclosures } from "./client";
import { normalizeDartRows } from "./normalize";
import type { DartCompanyDefinition } from "./types";

export interface IngestResult {
  corpCode: string;
  inserted: number;
  unchanged: number;
  /** DART's own count for the range — compare against inserted+unchanged for completeness. */
  totalCount: number;
  pagesFetched: number;
  /** True when DART reported more pages than this run was willing to fetch. */
  truncated: boolean;
}

/**
 * Fetches, normalizes, and persists DART disclosures for one company over a date range.
 * A filing's receipt number (rcept_no) is a stable, source-issued identifier — amendments
 * ("정정") arrive as new filings with their own rcept_no, so unlike Observations there is no
 * revision-of-the-same-row concept here; this is a plain idempotent upsert keyed on
 * (sourceId, receiptNo).
 */
export async function ingestDartFilings(
  company: DartCompanyDefinition,
  range: { beginDate: string; endDate: string },
): Promise<IngestResult> {
  const source = await prisma.source.upsert({
    where: { code: "DART" },
    update: {},
    create: { code: "DART", name: "OpenDART 전자공시시스템", tier: "TIER_S" },
  });

  const page = await fetchAllDartDisclosures(company.corpCode, {
    beginDate: range.beginDate,
    endDate: range.endDate,
  });
  const filings = normalizeDartRows(page.rows);

  let inserted = 0;
  let unchanged = 0;

  for (const filing of filings) {
    const existing = await prisma.filing.findUnique({
      where: { sourceId_receiptNo: { sourceId: source.id, receiptNo: filing.receiptNo } },
    });

    if (existing) {
      unchanged++;
      continue;
    }

    await prisma.filing.create({
      data: {
        sourceId: source.id,
        corpCode: filing.corpCode,
        corpName: filing.corpName,
        stockCode: filing.stockCode,
        reportName: filing.reportName,
        receiptNo: filing.receiptNo,
        receiptDate: filing.receiptDate,
        remark: filing.remark,
        raw: filing.raw,
      },
    });
    inserted++;
  }

  if (page.truncated) {
    console.warn(
      `[DART] ${company.corpCode}: DART reported more pages than this run fetches — stored ` +
        `${filings.length} of ${page.totalCount} disclosures. The result is knowably incomplete; ` +
        `narrow the date range and re-run.`,
    );
  } else if (page.totalCount > 0 && filings.length !== page.totalCount) {
    console.warn(
      `[DART] ${company.corpCode}: fetched ${filings.length} rows but DART reported ` +
        `total_count=${page.totalCount}. Not necessarily wrong (the range can shift between ` +
        `pages), but worth knowing rather than assuming completeness.`,
    );
  }

  return {
    corpCode: company.corpCode,
    inserted,
    unchanged,
    totalCount: page.totalCount,
    pagesFetched: page.pagesFetched,
    truncated: page.truncated,
  };
}
