import { fetchWithTimeout } from "../httpTimeout";
import { redactSecrets } from "../redactSecrets";
import type { FredObservationRaw, FredObservationsResponse } from "./types";

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
  options?: {
    observationStart?: string;
    observationEnd?: string;
    limit?: number;
    offset?: number;
  },
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
  if (options?.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }
  if (options?.offset !== undefined) {
    url.searchParams.set("offset", String(options.offset));
  }

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    // FRED returns a structured explanation on failure — captured live 2026-08-18 with a
    // deliberately invalid key:
    //   {"error_code":400,"error_message":"Bad Request.  The value for variable api_key is not
    //    registered. ..."}
    // Throwing on `!response.ok` alone discarded it, leaving an operator with "400 Bad Request"
    // when the provider had already said exactly what was wrong. Reading the body is
    // best-effort: a non-JSON or empty error body must not turn a clear HTTP failure into a
    // parse error.
    const detail = await readFredErrorMessage(response);
    throw new FredApiError(
      `FRED API request failed for series ${seriesId}: ${response.status} ${response.statusText}` +
        (detail ? ` — ${redactSecrets(detail)}` : ""),
      response.status,
    );
  }

  return (await response.json()) as FredObservationsResponse;
}

/** FRED's own error text, or null if the body is missing, unparseable, or shaped differently. */
async function readFredErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error_message?: unknown };
    return typeof body?.error_message === "string" ? body.error_message : null;
  } catch {
    return null;
  }
}

const FRED_PAGE_SIZE = 5000;
/** Hard stop, so a bad `count` cannot spin the loop forever. */
const MAX_FRED_PAGES = 100;

export interface FredObservationPage {
  observations: FredObservationRaw[];
  /** FRED's own count for the query — what a complete result should contain. */
  count: number;
  units: string;
  observationStart: string;
  observationEnd: string;
  requestsMade: number;
  /** True when the request cap was hit before FRED said it was done. */
  truncated: boolean;
}

/**
 * Fetches EVERY observation for one FRED series, paging explicitly rather than trusting a
 * default page size.
 *
 * The previous single request sent no `limit` at all and relied on FRED's default being large
 * enough, while `count` — FRED's own total for the query — was fetched and never compared
 * against how many rows actually arrived. That is the same silent-truncation shape found in the
 * DART and ECOS adapters: a partial series that reads as complete, feeding every downstream
 * change/regime/analog calculation without a word.
 *
 * Sending an explicit limit and paging to `count` removes the dependency on an undocumented
 * default. `scripts/verify-fred-live.ts` confirms the field names against the real endpoint the
 * moment a FRED_API_KEY exists — until then this is correct by construction rather than by
 * assumption.
 */
export async function fetchAllFredObservations(
  seriesId: string,
  options?: { observationStart?: string; observationEnd?: string },
): Promise<FredObservationPage> {
  const observations: FredObservationRaw[] = [];
  let count = 0;
  let units = "";
  let observationStart = "";
  let observationEnd = "";
  let requestsMade = 0;

  for (let page = 0; page < MAX_FRED_PAGES; page++) {
    const body = await fetchFredObservations(seriesId, {
      ...options,
      limit: FRED_PAGE_SIZE,
      offset: page * FRED_PAGE_SIZE,
    });

    requestsMade++;
    count = body.count ?? 0;
    units = body.units ?? units;
    observationStart = body.observation_start ?? observationStart;
    observationEnd = body.observation_end ?? observationEnd;

    const batch = body.observations ?? [];
    observations.push(...batch);

    if (batch.length < FRED_PAGE_SIZE || observations.length >= count) {
      return {
        observations,
        count,
        units,
        observationStart,
        observationEnd,
        requestsMade,
        truncated: false,
      };
    }
  }

  return {
    observations,
    count,
    units,
    observationStart,
    observationEnd,
    requestsMade,
    truncated: observations.length < count,
  };
}
