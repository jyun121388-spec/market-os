import type { EdgarRecentFilings, EdgarSubmissionsResponse } from "./types";

export interface NormalizedEdgarFiling {
  corpCode: string; // CIK
  corpName: string;
  stockCode: string | null;
  reportName: string;
  receiptNo: string; // accession number
  receiptDate: Date;
  remark: string | null;
  raw: Record<string, string | number>;
}

/**
 * Converts one company's raw EDGAR submissions response into normalized Filing rows.
 * `filings.recent` is a parallel-array structure (docs on types.ts) — this function first
 * validates every array has matching length before zipping, since a length mismatch would
 * silently misattribute one filing's date to another's accession number.
 */
export function normalizeEdgarSubmissions(
  response: EdgarSubmissionsResponse,
): NormalizedEdgarFiling[] {
  const recent = response.filings.recent;
  assertParallelArraysAligned(recent);

  const stockCode = response.tickers?.[0] ?? null;
  const count = recent.accessionNumber.length;
  const filings: NormalizedEdgarFiling[] = [];

  for (let i = 0; i < count; i++) {
    const raw: Record<string, string | number> = {};
    for (const [key, values] of Object.entries(recent)) {
      raw[key] = (values as (string | number)[])[i];
    }

    filings.push({
      corpCode: response.cik,
      corpName: response.name,
      stockCode,
      reportName: recent.primaryDocDescription[i]?.trim()
        ? `${recent.form[i]} — ${recent.primaryDocDescription[i]}`
        : recent.form[i],
      receiptNo: recent.accessionNumber[i],
      receiptDate: parseEdgarDateAsUtc(recent.filingDate[i]),
      remark: recent.items[i]?.trim() ? recent.items[i] : null,
      raw,
    });
  }

  return filings;
}

function assertParallelArraysAligned(recent: EdgarRecentFilings): void {
  const lengths = Object.entries(recent).map(([key, values]) => [key, values.length] as const);
  const expected = lengths[0]?.[1];
  for (const [key, length] of lengths) {
    if (length !== expected) {
      throw new Error(
        `EDGAR filings.recent parallel arrays are misaligned: "${key}" has length ${length}, ` +
          `expected ${expected}. Refusing to zip — this would misattribute filing data.`,
      );
    }
  }
}

function parseEdgarDateAsUtc(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Unrecognized EDGAR filingDate format: "${date}"`);
  }
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
