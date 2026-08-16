import { fetchWithTimeout } from "../httpTimeout";
import { padCik, type EdgarSubmissionsResponse } from "./types";

export class EdgarUserAgentMissingError extends Error {
  constructor() {
    super(
      "EDGAR_USER_AGENT is not set. SEC requires a descriptive User-Agent identifying the " +
        'requester (e.g. "Market OS contact@example.com") for fair-access compliance — see ' +
        "https://www.sec.gov/search-filings/edgar-application-programming-interfaces. " +
        "Copy .env.example to .env and set it (a real contact identity is a Human Gate per " +
        "docs/DATA_POLICY.md).",
    );
  }
}

export class EdgarApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Fetches raw submissions data for one company. No API key is required, unlike FRED/ECOS/DART
 * — SEC EDGAR instead requires a descriptive User-Agent header (fair-access policy). Returns
 * the untouched API response — no normalization or interpretation.
 */
export async function fetchEdgarSubmissions(cik: string): Promise<EdgarSubmissionsResponse> {
  const userAgent = process.env.EDGAR_USER_AGENT;
  if (!userAgent) {
    throw new EdgarUserAgentMissingError();
  }

  const url = `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) {
    throw new EdgarApiError(
      `SEC EDGAR request failed for CIK ${cik}: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return (await response.json()) as EdgarSubmissionsResponse;
}
