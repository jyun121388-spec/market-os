/**
 * Raw shapes returned by SEC EDGAR's XBRL "company facts" API.
 * https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 *
 * URL pattern: https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit zero-padded CIK}.json
 *
 * No API key required — only a descriptive User-Agent header (same as the EDGAR filings
 * adapter, src/server/adapters/edgar/). Returns every XBRL-tagged fact the company has ever
 * reported, grouped by taxonomy (e.g. "us-gaap") then by concept (e.g. "Revenues"), each with
 * an array of dated values per unit.
 *
 * NOTE: direct network access to data.sec.gov (including this XBRL endpoint specifically) is
 * blocked in this dev environment (confirmed via WebFetch — see docs/DECISIONS.md), so this
 * shape is built from SEC's own published documentation rather than a verified live response.
 * Logged in docs/REVIEW_DEBT.md.
 */

export interface XbrlFactValue {
  start?: string; // YYYY-MM-DD, present for duration concepts (e.g. Revenues over a period)
  end: string; // YYYY-MM-DD — the period end / instant date
  val: number;
  accn: string; // accession number, e.g. "0000320193-23-000106"
  fy: number; // fiscal year
  fp: string; // "Q1" | "Q2" | "Q3" | "FY"
  form: string; // e.g. "10-K", "10-Q"
  filed: string; // YYYY-MM-DD
  frame?: string;
  // Index signature so this shape can be stored directly in a Prisma Json column.
  [key: string]: string | number | undefined;
}

export interface XbrlConcept {
  label?: string;
  description?: string;
  units: Record<string, XbrlFactValue[]>; // keyed by unit, e.g. "USD"
}

export interface XbrlCompanyFacts {
  cik: number;
  entityName: string;
  facts: {
    "us-gaap"?: Record<string, XbrlConcept>;
    dei?: Record<string, XbrlConcept>;
    [taxonomy: string]: Record<string, XbrlConcept> | undefined;
  };
}

export interface XbrlCompanyDefinition {
  cik: string; // unpadded, e.g. "320193"
  corpName: string;
}

/** Core concepts this adapter extracts — deliberately a small, well-known starter set. */
export const TRACKED_XBRL_CONCEPTS = [
  "Revenues",
  "NetIncomeLoss",
  "OperatingIncomeLoss",
  "Assets",
  "Liabilities",
  "CashAndCashEquivalentsAtCarryingValue",
] as const;

export const TRACKED_XBRL_COMPANIES: XbrlCompanyDefinition[] = [
  { cik: "320193", corpName: "Apple Inc." },
];
