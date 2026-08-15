import { prisma } from "@/server/db/client";
import { fetchDartDisclosures } from "./client";
import { normalizeDartDisclosures } from "./normalize";
import type { DartCompanyDefinition, DartListSuccess } from "./types";

export interface IngestResult {
  corpCode: string;
  inserted: number;
  unchanged: number;
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

  const raw = await fetchDartDisclosures(company.corpCode, {
    beginDate: range.beginDate,
    endDate: range.endDate,
  });
  const filings = normalizeDartDisclosures(raw as DartListSuccess);

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

  return { corpCode: company.corpCode, inserted, unchanged };
}
