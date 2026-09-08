/**
 * Search and coverage for the company index.
 *
 * Pure, and separated from the page for one reason: the coverage sentence is a CLAIM about what
 * this installation can and cannot answer, and a claim needs controls. "Korea and US companies" is
 * exactly the kind of sentence a product says because it sounds right, and here it would be false
 * on almost every installation — the universe is whatever has actually been ingested, which
 * depends on credentials nobody may have entered yet.
 */

export interface SearchableCompany {
  corpName: string;
  corpCode: string;
  stockCode: string | null;
  sourceCode: string;
}

/**
 * Case-insensitive substring match over the three things a person might type: the name, the
 * ticker, or the provider's own code.
 *
 * Deliberately not fuzzy. A fuzzy match that silently returns a different company than the one
 * asked for is the failure mode this repository has been most careful about elsewhere (IR-001,
 * IR-032), and a search box is exactly where it would be least visible.
 */
export function filterCompanies<T extends SearchableCompany>(companies: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return companies;
  return companies.filter(
    (c) =>
      c.corpName.toLowerCase().includes(q) ||
      c.corpCode.toLowerCase().includes(q) ||
      (c.stockCode ?? "").toLowerCase().includes(q),
  );
}

export type ProviderCoverageState = "HAS_DATA" | "CONFIGURED_NO_DATA" | "NOT_CONFIGURED";

export interface ProviderCoverage {
  sourceCode: string;
  /** What this provider covers, in the terms a reader thinks in. */
  universe: string;
  state: ProviderCoverageState;
  companies: number;
  detail: string;
}

/** The filing providers. FRED and ECOS supply indicators, not companies, so they are not here. */
const FILING_PROVIDERS: { sourceCode: string; universe: string; needsKey: boolean }[] = [
  { sourceCode: "SEC_EDGAR", universe: "US issuers filing with the SEC", needsKey: false },
  { sourceCode: "DART", universe: "Korean issuers filing with DART", needsKey: true },
];

/**
 * What this installation actually covers, per provider.
 *
 * `configured` carries booleans only — whether a credential is present, never its value. The
 * three states are kept apart because they need three different things from the reader: data
 * exists; the provider is set up but nothing has been fetched; the provider needs configuring.
 * Collapsing them into "no results" is what makes a product look broken when it is merely empty.
 */
export function summariseCoverage(
  companiesBySource: Map<string, number>,
  configured: Record<string, boolean>,
): ProviderCoverage[] {
  return FILING_PROVIDERS.map(({ sourceCode, universe, needsKey }) => {
    const companies = companiesBySource.get(sourceCode) ?? 0;
    if (companies > 0) {
      return {
        sourceCode,
        universe,
        state: "HAS_DATA" as const,
        companies,
        detail: `${companies} compan${companies === 1 ? "y" : "ies"} on record.`,
      };
    }
    if (needsKey && !configured[sourceCode]) {
      return {
        sourceCode,
        universe,
        state: "NOT_CONFIGURED" as const,
        companies: 0,
        detail:
          "No credential is configured for this provider, so none of its companies can be " +
          "fetched. This is a setup step, not a fault.",
      };
    }
    return {
      sourceCode,
      universe,
      state: "CONFIGURED_NO_DATA" as const,
      companies: 0,
      detail: "Nothing has been fetched from this provider yet.",
    };
  });
}
