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

/**
 * An entry in `filings.files` — an overflow file holding filings older than those in
 * `filings.recent`. `name` is a filename to be fetched from the same /submissions/ path.
 */
export interface EdgarSubmissionsFileRef {
  name: string;
  filingCount: number;
  filingFrom: string; // YYYY-MM-DD
  filingTo: string;
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
    /**
     * The most recent filings only, hard-capped by SEC at 1000. This is NOT a company's full
     * filing history — anything older spills into `files` (verified live 2026-08-17: Apple's
     * `recent` held exactly 1000 entries back to 2015-06-04, with a further 1240 filings from
     * 1994-2015 in one overflow file).
     */
    recent: EdgarRecentFilings;
    files: EdgarSubmissionsFileRef[];
  };
}

/**
 * The shape of an overflow file (e.g. `CIK0000320193-submissions-001.json`). It is the same
 * parallel-array layout as `filings.recent`, but at the TOP level with no enclosing `filings`
 * wrapper — verified live 2026-08-17. It also carries a couple of fields `recent` does not
 * (`core_type`, `isXBRLNumeric`); the adapter reads neither, so they are not modelled.
 */
export type EdgarSubmissionsOverflow = EdgarRecentFilings;

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
