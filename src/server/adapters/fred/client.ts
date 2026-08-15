import type { FredObservationsResponse } from "./types";

export class FredApiKeyMissingError extends Error {
  constructor() {
    super(
      "FRED_API_KEY is not set. Copy .env.example to .env and add a free key from " +
        "https://fred.stlouisfed.org/docs/api/api_key.html (obtaining/entering a real key is a " +
        "Human Gate per docs/DATA_POLICY.md).",
    );
  }
}

export class FredApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

/**
 * Fetches raw observations for one FRED series. Returns the untouched API response — no
 * normalization, no interpretation (docs/DATA_POLICY.md "Adapter architecture").
 */
export async function fetchFredObservations(
  seriesId: string,
  options?: { observationStart?: string; observationEnd?: string },
): Promise<FredObservationsResponse> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new FredApiKeyMissingError();
  }

  const url = new URL(FRED_BASE_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  if (options?.observationStart) {
    url.searchParams.set("observation_start", options.observationStart);
  }
  if (options?.observationEnd) {
    url.searchParams.set("observation_end", options.observationEnd);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new FredApiError(
      `FRED API request failed for series ${seriesId}: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return (await response.json()) as FredObservationsResponse;
}
