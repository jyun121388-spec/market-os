import { fetchWithTimeout } from "../httpTimeout";
import { padCik } from "../edgar/types";
import type { XbrlCompanyFacts } from "./types";

export class EdgarUserAgentMissingError extends Error {
  constructor() {
    super(
      "EDGAR_USER_AGENT is not set. SEC requires a descriptive User-Agent identifying the " +
        'requester (e.g. "Market OS contact@example.com") for fair-access compliance. Copy ' +
        ".env.example to .env and set it (a real contact identity is a Human Gate per " +
        "docs/DATA_POLICY.md).",
    );
  }
}

export class XbrlApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Fetches every XBRL-tagged fact for one company. Reuses EDGAR_USER_AGENT (same auth pattern
 * as src/server/adapters/edgar/, no API key). Returns the untouched API response — no
 * normalization or interpretation.
 */
export async function fetchCompanyFacts(cik: string): Promise<XbrlCompanyFacts> {
  const userAgent = process.env.EDGAR_USER_AGENT;
  if (!userAgent) {
    throw new EdgarUserAgentMissingError();
  }

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) {
    throw new XbrlApiError(
      `SEC EDGAR XBRL request failed for CIK ${cik}: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return (await response.json()) as XbrlCompanyFacts;
}
