import { assertValidCalendarDate } from "../dateValidation";
import type { DartDisclosureRow, DartListSuccess } from "./types";

export interface NormalizedDartFiling {
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  reportName: string;
  receiptNo: string;
  receiptDate: Date;
  remark: string | null;
  raw: DartDisclosureRow;
}

/**
 * Converts a raw OpenDART list.json response into normalized Filing rows. Unlike the FRED/ECOS
 * adapters, there is no "missing value" concept here — a filing either exists or it doesn't —
 * but a malformed rcept_dt is a real data-integrity problem and must fail loudly, not be
 * silently dropped or defaulted to "now".
 */
export function normalizeDartDisclosures(response: DartListSuccess): NormalizedDartFiling[] {
  return normalizeDartRows(response.list);
}

/** Row-level entry point, used by the paginating fetch which has no single response object. */
export function normalizeDartRows(rows: DartDisclosureRow[]): NormalizedDartFiling[] {
  return rows.map((row) => ({
    corpCode: row.corp_code,
    corpName: row.corp_name,
    stockCode: row.stock_code?.trim() ? row.stock_code.trim() : null,
    reportName: row.report_nm,
    receiptNo: row.rcept_no,
    receiptDate: parseDartDateAsUtc(row.rcept_dt),
    remark: row.rm?.trim() ? row.rm.trim() : null,
    raw: row,
  }));
}

function parseDartDateAsUtc(date: string): Date {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`Unrecognized DART rcept_dt format: "${date}"`);
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  // The \d{8} check above proves the shape, not the date: "20260230" and "20261301" both pass
  // it, and Date.UTC would silently roll them over to Mar 2 and Jan 2027 respectively — storing
  // a filing under a date the source never reported. FRED and ECOS got this guard in the
  // impossible-date hardening pass (docs/DECISIONS.md, 2026-08-16); DART was missed.
  assertValidCalendarDate(year, month, day, date);
  return new Date(Date.UTC(year, month - 1, day));
}
