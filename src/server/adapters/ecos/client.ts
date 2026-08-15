import {
  isEcosErrorResponse,
  type EcosSeriesDefinition,
  type EcosStatisticSearchResponse,
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

/**
 * Fetches raw observations for one ECOS series. Returns the untouched API response — no
 * normalization or interpretation (docs/DATA_POLICY.md "Adapter architecture").
 */
export async function fetchEcosObservations(
  def: EcosSeriesDefinition,
  options: { start: string; end: string },
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
    "1",
    "10000",
    def.statCode,
    def.cycle,
    options.start,
    options.end,
    def.itemCode1,
  ].join("/");

  const response = await fetch(path);
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
