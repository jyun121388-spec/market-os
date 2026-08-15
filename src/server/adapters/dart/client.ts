import { isDartError, type DartListResponse } from "./types";

export class DartApiKeyMissingError extends Error {
  constructor() {
    super(
      "DART_API_KEY is not set. Copy .env.example to .env and add a free key from " +
        "https://opendart.fss.or.kr/ (obtaining/entering a real key is a Human Gate per " +
        "docs/DATA_POLICY.md).",
    );
  }
}

export class DartApiError extends Error {
  constructor(
    message: string,
    public readonly status: string,
  ) {
    super(message);
  }
}

const DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json";

/**
 * Fetches raw disclosure list entries for one company over a date range. Returns the
 * untouched API response — no normalization or interpretation (docs/DATA_POLICY.md "Adapter
 * architecture").
 */
export async function fetchDartDisclosures(
  corpCode: string,
  options: { beginDate: string; endDate: string; pageNo?: number; pageCount?: number },
): Promise<DartListResponse> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    throw new DartApiKeyMissingError();
  }

  const url = new URL(DART_LIST_URL);
  url.searchParams.set("crtfc_key", apiKey);
  url.searchParams.set("corp_code", corpCode);
  url.searchParams.set("bgn_de", options.beginDate);
  url.searchParams.set("end_de", options.endDate);
  url.searchParams.set("page_no", String(options.pageNo ?? 1));
  url.searchParams.set("page_count", String(options.pageCount ?? 100));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new DartApiError(
      `OpenDART API request failed for ${corpCode}: ${response.status} ${response.statusText}`,
      String(response.status),
    );
  }

  const body = (await response.json()) as DartListResponse;
  if (isDartError(body)) {
    // status "013" is DART's documented "no matching data" code, not a failure — treat as
    // an empty result rather than throwing. Any other non-"000" status is a real error.
    if (body.status === "013") {
      return {
        status: "000",
        message: body.message,
        page_no: 1,
        page_count: 0,
        total_count: 0,
        total_page: 0,
        list: [],
      };
    }
    throw new DartApiError(body.message, body.status);
  }
  return body;
}
