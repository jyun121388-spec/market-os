/**
 * Raw shapes returned by SEC EDGAR's submissions API.
 * https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 *
 * URL pattern: https://data.sec.gov/submissions/CIK{10-digit zero-padded CIK}.json
 *
 * Unlike FRED/ECOS/DART, EDGAR requires no API key — only a descriptive `User-Agent` header
 * identifying the requester (SEC's fair-access policy). `filings.recent` uses a parallel-array
 * layout (one array per field, same index = same filing), not an array of row objects.
 *
 * NOTE: direct network access to data.sec.gov is blocked in this dev environment (confirmed
 * via WebFetch, same as ecos.bok.or.kr and opendart.fss.or.kr — see docs/DECISIONS.md), so
 * this shape is built from SEC's own published documentation via web search rather than a
 * verified live response. Logged in docs/REVIEW_DEBT.md.
 */

export interface EdgarRecentFilings {
  accessionNumber: string[];
  filingDate: string[]; // YYYY-MM-DD
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[]; // e.g. "10-K", "10-Q", "8-K"
  fileNumber: string[];
  filmNumber: string[];
  items: string[];
  size: number[];
  isXBRL: number[];
  isInlineXBRL: number[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

export interface EdgarSubmissionsResponse {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  filings: {
    recent: EdgarRecentFilings;
    files: { name: string; filingCount: number; filingFrom: string; filingTo: string }[];
  };
}

export interface EdgarCompanyDefinition {
  cik: string; // unpadded, e.g. "320193" for Apple
  corpName: string;
}

/** Apple Inc. — a stable, well-known CIK for adapter development/testing. */
export const TRACKED_EDGAR_COMPANIES: EdgarCompanyDefinition[] = [
  { cik: "320193", corpName: "Apple Inc." },
];

export function padCik(cik: string): string {
  return cik.padStart(10, "0");
}
