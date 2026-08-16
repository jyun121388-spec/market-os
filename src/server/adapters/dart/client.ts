import { fetchWithTimeout } from "../httpTimeout";
import { isDartError, type DartDisclosureRow, type DartListResponse } from "./types";

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

  const response = await fetchWithTimeout(url.toString());
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

/** Hard stop on the pagination loop, so a bad `total_page` cannot spin forever. */
const MAX_DART_PAGES = 100;
const DART_PAGE_SIZE = 100;

export interface DartDisclosurePage {
  rows: DartDisclosureRow[];
  /** DART's own count for the query — what a complete result should contain. */
  totalCount: number;
  pagesFetched: number;
  /**
   * True when the page cap was hit before DART said it was done, i.e. `rows` is knowably
   * incomplete. Never silently swallowed: the ingest logs it and the caller can act on it.
   */
  truncated: boolean;
}

/**
 * Fetches EVERY disclosure page for one company/date range, not just the first.
 *
 * The single-page `fetchDartDisclosures` above is the honest wire primitive — it returns
 * exactly what DART sent, page fields included. It is not, however, a complete answer, and the
 * ingest used to treat it as one: one request with `page_no=1, page_count=100`, with
 * `total_page` and `total_count` fetched and then ignored. Samsung Electronics alone files well
 * over 100 disclosures a year, so any range wide enough to matter was silently cut off at 100
 * rows. Nothing failed and nothing warned — the database just quietly held a partial filing
 * history that read as complete, which is precisely the failure docs/DATA_POLICY.md is about.
 *
 * The completeness signal is returned rather than asserted, because "DART has more pages than
 * we are willing to fetch in one run" is a real operational condition, not a crash — but it
 * must be visible, so it is a field the caller has to look at rather than a silent shortfall.
 */
export async function fetchAllDartDisclosures(
  corpCode: string,
  options: { beginDate: string; endDate: string },
): Promise<DartDisclosurePage> {
  const rows: DartDisclosureRow[] = [];
  let pagesFetched = 0;
  let totalCount = 0;
  let totalPage = 1;

  for (let pageNo = 1; pageNo <= totalPage && pageNo <= MAX_DART_PAGES; pageNo++) {
    const body = (await fetchDartDisclosures(corpCode, {
      beginDate: options.beginDate,
      endDate: options.endDate,
      pageNo,
      pageCount: DART_PAGE_SIZE,
    })) as Extract<DartListResponse, { list: DartDisclosureRow[] }>;

    pagesFetched++;
    totalCount = body.total_count ?? 0;
    totalPage = body.total_page ?? 1;
    rows.push(...(body.list ?? []));

    // An empty page before the declared end means DART disagrees with its own total_page.
    // Stop rather than loop against a moving target.
    if ((body.list ?? []).length === 0) break;
  }

  return {
    rows,
    totalCount,
    pagesFetched,
    truncated: totalPage > MAX_DART_PAGES,
  };
}
