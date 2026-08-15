import { prisma } from "@/server/db/client";
import { fetchEdgarSubmissions } from "./client";
import { normalizeEdgarSubmissions } from "./normalize";
import type { EdgarCompanyDefinition } from "./types";

export interface IngestResult {
  cik: string;
  inserted: number;
  unchanged: number;
}

/**
 * Fetches, normalizes, and persists SEC EDGAR filings for one company. Same idempotent-upsert
 * shape as src/server/adapters/dart/ingest.ts (see that file's docstring): an accession number
 * is a stable, source-issued identifier, so this is a plain upsert keyed on
 * (sourceId, receiptNo), not revision-tracking.
 */
export async function ingestEdgarFilings(company: EdgarCompanyDefinition): Promise<IngestResult> {
  const source = await prisma.source.upsert({
    where: { code: "SEC_EDGAR" },
    update: {},
    create: { code: "SEC_EDGAR", name: "SEC EDGAR", tier: "TIER_S" },
  });

  const raw = await fetchEdgarSubmissions(company.cik);
  const filings = normalizeEdgarSubmissions(raw);

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

  return { cik: company.cik, inserted, unchanged };
}
