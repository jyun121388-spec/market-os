/**
 * Raw shapes returned by OpenDART (전자공시시스템) — 금융감독원 (Korea's FSC/FSS).
 * https://opendart.fss.or.kr/
 *
 * URL pattern (disclosure search / list.json):
 *   https://opendart.fss.or.kr/api/list.json?crtfc_key={key}&corp_code={corpCode}
 *     &bgn_de={YYYYMMDD}&end_de={YYYYMMDD}&pblntf_ty={type}&page_no={n}&page_count={n}
 *
 * NOTE: direct network access to opendart.fss.or.kr is blocked in this dev environment (see
 * docs/DECISIONS.md), so this shape is built from documentation/tooling references rather than
 * a verified live response. `status`/error-code handling and field names should be confirmed
 * against a real response once DART_API_KEY is available (Human Gate) — logged in
 * docs/REVIEW_DEBT.md.
 */

export interface DartDisclosureRow {
  corp_code: string; // DART's internal company identifier (not the stock ticker)
  corp_name: string;
  stock_code: string; // empty string if the company is unlisted
  corp_cls: string; // Y=코스피, K=코스닥, N=코넥스, E=기타
  report_nm: string;
  rcept_no: string; // unique receipt number for this filing
  flr_nm: string; // filer name
  rcept_dt: string; // YYYYMMDD, the date DART received the filing
  rm: string; // remark flags, e.g. "유"/"코"/"정정" — free-text, not enumerable
  // Index signature so this shape can be stored directly in a Prisma Json column.
  [key: string]: string;
}

export interface DartListSuccess {
  status: "000";
  message: string;
  page_no: number;
  page_count: number;
  total_count: number;
  total_page: number;
  list: DartDisclosureRow[];
}

export interface DartApiErrorResponse {
  status: string; // any non-"000" code
  message: string;
}

export type DartListResponse = DartListSuccess | DartApiErrorResponse;

export function isDartError(response: DartListResponse): response is DartApiErrorResponse {
  return response.status !== "000";
}

export interface DartCompanyDefinition {
  corpCode: string;
  corpName: string;
}

/** Samsung Electronics — a stable, well-known corp_code for adapter development/testing. */
export const TRACKED_DART_COMPANIES: DartCompanyDefinition[] = [
  { corpCode: "00126380", corpName: "삼성전자" },
];
