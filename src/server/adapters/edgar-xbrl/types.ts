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
 * VERIFIED LIVE against data.sec.gov on 2026-08-17 via `npx tsx scripts/verify-edgar-live.ts`
 * (55 contract checks). That run corrected one assumption taken from the documentation — see
 * `fy`/`fp` below.
 */

export interface XbrlFactValue {
  start?: string; // YYYY-MM-DD, present for duration concepts (e.g. Revenues over a period)
  end: string; // YYYY-MM-DD — the period end / instant date
  val: number;
  accn: string; // accession number, e.g. "0000320193-23-000106"
  // Fiscal year / fiscal period. Documented as always present, but real responses disagree:
  // Apple's companyfacts returns rows with `fy: null, fp: null` (typically facts republished
  // for a `frame` under a later restating filing — e.g. CY2012 figures carried in a 2015 8-K).
  // Found by the live contract check; the fixtures had never exercised it. Treat the fiscal
  // label as genuinely absent for those rows — do not derive one from `end`, which would turn
  // an inference into what looks like reported source data.
  fy: number | null;
  fp: string | null; // "Q1" | "Q2" | "Q3" | "FY", or null — see fy above
  form: string; // e.g. "10-K", "10-Q"
  filed: string; // YYYY-MM-DD
  frame?: string;
  // Index signature so this shape can be stored directly in a Prisma Json column.
  [key: string]: string | number | null | undefined;
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

/**
 * Core concepts this adapter extracts — deliberately a small, well-known starter set.
 *
 * Each entry is the literal us-gaap tag, stored verbatim in `FinancialFact.concept`. No tag is
 * renamed or merged into another on the way in: mapping one tag's values under a different
 * tag's name would be an interpretation, and it would destroy the ability to tell which tag a
 * number actually came from. Any unification belongs at the presentation layer, where it can be
 * shown and questioned (docs/DATA_POLICY.md).
 *
 * Revenue needs three tags, which is not redundancy. US GAAP changed how revenue is reported
 * with ASC 606, and a filer's history therefore spans several tags with no overlap:
 *
 *   SalesRevenueNet                                      pre-ASC 606 (Apple: through 2018)
 *   Revenues                                             sparse, mostly legacy
 *   RevenueFromContractWithCustomerExcludingAssessedTax  post-ASC 606 (Apple: current)
 *
 * Tracking only `Revenues` was the original state, and against Apple it yielded 11 rows ending
 * in 2018 — so Company X-Ray had no revenue at all for the most recent eight years, which is a
 * strange thing for a financial product to be missing and nothing said so. Verified against
 * live companyfacts on 2026-08-17: 210 rows under SalesRevenueNet, 117 under
 * RevenueFromContractWithCustomerExcludingAssessedTax (latest $364.4B for the period ending
 * 2026-06-27), 11 under Revenues.
 */
export const TRACKED_XBRL_CONCEPTS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
  "NetIncomeLoss",
  "OperatingIncomeLoss",
  "Assets",
  "Liabilities",
  "CashAndCashEquivalentsAtCarryingValue",
] as const;

export const TRACKED_XBRL_COMPANIES: XbrlCompanyDefinition[] = [
  { cik: "320193", corpName: "Apple Inc." },
];
