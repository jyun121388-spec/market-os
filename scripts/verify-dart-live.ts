/**
 * Live contract verification for the OpenDART adapter.
 *
 * `dart/types.ts` records that its field names and `status` handling were taken from
 * documentation rather than a real response. Two things make that riskier here than elsewhere:
 * the adapter branches on an exact status string ("000" success, "013" no-data), so a wrong code
 * turns into either a spurious throw or a silently-empty result; and the response is paginated,
 * which the ingest used to ignore entirely.
 *
 * Read-only. Writes nothing to the database.
 *
 * Usage: DART_API_KEY=... npx tsx scripts/verify-dart-live.ts
 * Free key: https://opendart.fss.or.kr/
 */
import { ContractCheck, COMPACT_DATE, requireCredential } from "./lib/contract-check";
import { fetchDartDisclosures, fetchAllDartDisclosures } from "../src/server/adapters/dart/client";
import { TRACKED_DART_COMPANIES, isDartError } from "../src/server/adapters/dart/types";
import type { DartListSuccess } from "../src/server/adapters/dart/types";
import { normalizeDartRows } from "../src/server/adapters/dart/normalize";

const c = new ContractCheck("OpenDART");

const SAMSUNG = TRACKED_DART_COMPANIES[0];
/** A full year, deliberately wide enough that Samsung exceeds one 100-row page. */
const RANGE = { beginDate: "20250101", endDate: "20251231" };

async function verifyShape() {
  c.section(`list.json ${SAMSUNG.corpCode} (${SAMSUNG.corpName})`);
  const res = await fetchDartDisclosures(SAMSUNG.corpCode, { ...RANGE, pageNo: 1, pageCount: 100 });

  c.check("response is not an error envelope", !isDartError(res), res);
  if (isDartError(res)) return;

  const body = res as DartListSuccess;
  c.check('status is exactly "000" on success', body.status === "000", { status: body.status });
  c.check("message is a string", typeof body.message === "string");

  // Pagination fields — the ones the ingest used to fetch and then ignore.
  for (const field of ["page_no", "page_count", "total_count", "total_page"] as const) {
    c.check(`${field} is a number`, typeof body[field] === "number", {
      got: typeof body[field],
      value: body[field],
    });
  }
  c.check("list is an array", Array.isArray(body.list));

  const rows = body.list ?? [];
  c.check("at least one disclosure returned", rows.length > 0);
  if (rows.length === 0) return;

  for (const field of [
    "corp_code",
    "corp_name",
    "stock_code",
    "corp_cls",
    "report_nm",
    "rcept_no",
    "flr_nm",
    "rcept_dt",
    "rm",
  ] as const) {
    c.check(
      `every row has a string ${field}`,
      rows.every((r) => typeof r[field] === "string"),
      rows.find((r) => typeof r[field] !== "string"),
    );
  }

  c.check(
    "every rcept_dt is YYYYMMDD",
    rows.every((r) => COMPACT_DATE.test(r.rcept_dt)),
    rows.find((r) => !COMPACT_DATE.test(r.rcept_dt))?.rcept_dt,
  );
  c.check(
    "every rcept_no is unique within the page (it is the idempotency key)",
    new Set(rows.map((r) => r.rcept_no)).size === rows.length,
  );
  c.check(
    "corp_cls is one of the documented values Y/K/N/E",
    rows.every((r) => ["Y", "K", "N", "E"].includes(r.corp_cls)),
    [...new Set(rows.map((r) => r.corp_cls))].join(","),
  );

  // stock_code is documented as "empty string if unlisted" — normalize maps blank to null. If
  // DART instead omits it or sends spaces, that mapping needs to know.
  c.info(
    `distinct stock_code values seen: ${[...new Set(rows.map((r) => JSON.stringify(r.stock_code)))]
      .slice(0, 5)
      .join(", ")}`,
  );

  const normalized = normalizeDartRows(rows);
  c.check(
    "normalizeDartRows accepts the real payload without throwing",
    normalized.length === rows.length,
  );
  c.check(
    "every normalized receiptDate is a valid Date",
    normalized.every((f) => !Number.isNaN(f.receiptDate.getTime())),
  );
}

async function verifyNoDataStatus() {
  c.section("no-matching-data handling");
  // A range in which Samsung certainly filed nothing. The client maps DART's documented "013"
  // to an empty success rather than throwing; if the real code differs, this surfaces it.
  const res = await fetchDartDisclosures(SAMSUNG.corpCode, {
    beginDate: "19900101",
    endDate: "19900102",
    pageNo: 1,
    pageCount: 10,
  });
  c.check(
    'an empty range resolves to an empty success rather than throwing (status "013" mapping)',
    !isDartError(res) && (res as DartListSuccess).list.length === 0,
    res,
  );
}

async function verifyPagination() {
  c.section("pagination completeness");
  const page = await fetchAllDartDisclosures(SAMSUNG.corpCode, RANGE);

  c.check("nothing was truncated", page.truncated === false);
  c.check("more than one page was needed (a real multi-page range)", page.pagesFetched > 1, {
    pagesFetched: page.pagesFetched,
    totalCount: page.totalCount,
  });
  c.check("fetched every disclosure DART says exists", page.rows.length === page.totalCount, {
    fetched: page.rows.length,
    totalCount: page.totalCount,
  });
  c.check(
    "no duplicate rcept_no across page boundaries",
    new Set(page.rows.map((r) => r.rcept_no)).size === page.rows.length,
  );
  c.info(
    `${SAMSUNG.corpName} filed ${page.totalCount} disclosures in 2025, fetched over ` +
      `${page.pagesFetched} page(s) — the single-page ingest would have stored 100.`,
  );
}

async function main() {
  if (
    !requireCredential(
      "DART_API_KEY",
      "Get a free key at https://opendart.fss.or.kr/ (오픈API 인증키 신청) and put it in .env.",
    )
  ) {
    return;
  }

  await verifyShape();
  await verifyNoDataStatus();
  await verifyPagination();
  c.finish();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
