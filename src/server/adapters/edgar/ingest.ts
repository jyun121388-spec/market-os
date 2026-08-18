import { prisma } from "@/server/db/client";
import { insertIfAbsent } from "@/server/domain/idempotentInsert";
import { fetchEdgarFilingHistory, fetchEdgarSubmissions } from "./client";
import { normalizeEdgarFilingHistory } from "./normalize";
import type { EdgarCompanyDefinition } from "./types";

export interface IngestResult {
  cik: string;
  inserted: number;
  unchanged: number;
  /** Filings in `filings.recent` — SEC caps this at 1000, so it is not the history. */
  recentCount: number;
  /** Total across recent plus every overflow file that was fetched. */
  totalFetched: number;
  /** What SEC says exists: recent plus the declared filingCount of every overflow file. */
  providerTotal: number;
  overflowFilesFetched: number;
  /** True when SEC listed more overflow files than this run was willing to fetch. */
  truncated: boolean;
}

/**
 * Fetches, normalizes, and persists SEC EDGAR filings for one company. Same idempotent-upsert
 * shape as src/server/adapters/dart/ingest.ts (see that file's docstring): an accession number
 * is a stable, source-issued identifier, so this is a plain upsert keyed on
 * (sourceId, receiptNo), not revision-tracking.
 */
export async function ingestEdgarFilings(
  company: EdgarCompanyDefinition,
  /**
   * Called after each row so a failure partway through can still be audited truthfully.
   *
   * Rows are written one at a time and are not rolled back. Without this, an exception at row
   * 2000 of 2240 recorded `inserted: 0` while two thousand rows sat in the database — an audit
   * that actively misleads the operator reading it. Optional, so nothing that does not care has
   * to change.
   */
  onProgress?: (progress: { inserted: number; unchanged: number; fetched: number }) => void,
): Promise<IngestResult> {
  const source = await prisma.source.upsert({
    where: { code: "SEC_EDGAR" },
    update: {},
    create: { code: "SEC_EDGAR", name: "SEC EDGAR", tier: "TIER_S" },
  });

  // The tickers live only on the primary submissions document, and fetchEdgarFilingHistory
  // already retrieves it; ask for it once here so the normalizer has a stock code for the
  // overflow filings too, which carry no company metadata of their own.
  const [submissions, history] = await Promise.all([
    fetchEdgarSubmissions(company.cik),
    fetchEdgarFilingHistory(company.cik),
  ]);
  const filings = normalizeEdgarFilingHistory(history, submissions.tickers);

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

    const didInsert = await insertIfAbsent(() =>
      prisma.filing.create({
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
      }),
    );
    if (didInsert) inserted++;
    else unchanged++;
    onProgress?.({ inserted, unchanged, fetched: inserted + unchanged });
  }

  if (history.truncated) {
    console.warn(
      `[EDGAR] ${company.cik}: SEC listed ${history.overflowFilesAvailable} overflow files but ` +
        `this run fetched ${history.overflowFilesFetched}. The stored filing history is ` +
        "knowably incomplete.",
    );
  }

  return {
    cik: company.cik,
    inserted,
    unchanged,
    recentCount: history.recentCount,
    totalFetched: filings.length,
    providerTotal: history.providerTotal,
    overflowFilesFetched: history.overflowFilesFetched,
    truncated: history.truncated,
  };
}
