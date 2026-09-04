import { fetchWithTimeout } from "../httpTimeout";
import {
  isEcosErrorResponse,
  type EcosSeriesDefinition,
  type EcosStatisticSearchRow,
  type EcosStatisticSearchResponse,
  type EcosStatisticSearchSuccess,
} from "./types";

export class EcosApiKeyMissingError extends Error {
  constructor() {
    super(
      "ECOS_API_KEY is not set. Copy .env.example to .env and add a free key from " +
        "https://ecos.bok.or.kr/api/ (obtaining/entering a real key is a Human Gate per " +
        "docs/DATA_POLICY.md).",
    );
  }
}

export class EcosApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

const ECOS_BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch";

/** Rows per request. ECOS addresses results by a 1-based inclusive [startIdx, endIdx] window. */
const ECOS_PAGE_SIZE = 1000;
/** Hard stop, so a bad `list_total_count` cannot spin the loop forever. */
const MAX_ECOS_PAGES = 100;

/**
 * Fetches raw observations for one ECOS series. Returns the untouched API response — no
 * normalization or interpretation (docs/DATA_POLICY.md "Adapter architecture").
 */
export async function fetchEcosObservations(
  def: EcosSeriesDefinition,
  options: { start: string; end: string; startIdx?: number; endIdx?: number },
): Promise<EcosStatisticSearchResponse> {
  const apiKey = process.env.ECOS_API_KEY;
  if (!apiKey) {
    throw new EcosApiKeyMissingError();
  }

  const path = [
    ECOS_BASE_URL,
    apiKey,
    "json",
    "kr",
    String(options.startIdx ?? 1),
    String(options.endIdx ?? ECOS_PAGE_SIZE),
    def.statCode,
    def.cycle,
    options.start,
    options.end,
    def.itemCode1,
  ].join("/");

  const response = await fetchWithTimeout(path);
  if (!response.ok) {
    throw new EcosApiError(
      `ECOS API request failed for ${def.statCode}/${def.itemCode1}: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as EcosStatisticSearchResponse;
  if (isEcosErrorResponse(body)) {
    throw new EcosApiError(body.RESULT.MESSAGE, body.RESULT.CODE);
  }
  return body;
}

export interface EcosObservationPage {
  rows: EcosStatisticSearchRow[];
  /** ECOS's own count for the query — what a complete result should contain. */
  totalCount: number;
  requestsMade: number;
  /** True when the request cap was hit before ECOS said it was done. */
  truncated: boolean;
}

/**
 * Fetches EVERY row for one ECOS series/date range by walking the [startIdx, endIdx] window.
 *
 * The previous single request hardcoded the window to 1..10000 and then ignored
 * `list_total_count` entirely, so a series with more rows than that was silently cut off — the
 * same failure the DART adapter had with `total_page`, and the same reason it mattered: an
 * incomplete series reads as a complete one, and every downstream change/regime/analog
 * calculation then runs on data that is quietly missing its tail.
 *
 * Whether the BOK API enforces its own per-request row ceiling is not yet known — that is one
 * of the things `scripts/verify-ecos-live.ts` is written to answer against the real endpoint.
 * Windowing in fixed pages is correct either way, and no longer depends on guessing the limit.
 */
export async function fetchAllEcosObservations(
  def: EcosSeriesDefinition,
  options: { start: string; end: string },
): Promise<EcosObservationPage> {
  const rows: EcosStatisticSearchRow[] = [];
  let totalCount = 0;
  let requestsMade = 0;

  for (let page = 0; page < MAX_ECOS_PAGES; page++) {
    const startIdx = page * ECOS_PAGE_SIZE + 1;
    const endIdx = startIdx + ECOS_PAGE_SIZE - 1;

    const body = (await fetchEcosObservations(def, {
      start: options.start,
      end: options.end,
      startIdx,
      endIdx,
    })) as EcosStatisticSearchSuccess;

    requestsMade++;
    totalCount = body.StatisticSearch?.list_total_count ?? 0;
    const batch = body.StatisticSearch?.row ?? [];
    rows.push(...batch);

    // Stop on a short page (the normal end) or once we have everything ECOS claims exists.
    // Stopping is not the same claim as completeness — see the note in fred/client.ts (IR-030).
    if (batch.length < ECOS_PAGE_SIZE || rows.length >= totalCount) {
      return { rows, totalCount, requestsMade, truncated: rows.length < totalCount };
    }
  }

  return { rows, totalCount, requestsMade, truncated: rows.length < totalCount };
}
