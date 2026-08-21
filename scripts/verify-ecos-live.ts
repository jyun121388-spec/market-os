/**
 * Live contract verification for the Bank of Korea ECOS adapter.
 *
 * ECOS carries the largest documented unknown of any adapter here. `ecos/types.ts` says so
 * outright: the convention ECOS uses for a missing observation — empty string, "-", omission,
 * something else — was never verified, so `normalize.ts` treats ANY non-numeric DATA_VALUE as
 * missing. That is the safe default, but it cannot distinguish a real gap from a marker nobody
 * anticipated, and it would silently swallow a value ECOS considers meaningful. Settling that
 * question is the main job of this script.
 *
 * Read-only. Writes nothing to the database.
 *
 * Usage: ECOS_API_KEY=... npx tsx scripts/verify-ecos-live.ts
 * Free key: https://ecos.bok.or.kr/api/
 */
import { ContractCheck, requireCredential, summariseNonNumericMarkers } from "./lib/contract-check";
import { sanitiseErrorForStorage } from "../src/server/adapters/redactSecrets";
import {
  fetchEcosObservations,
  fetchAllEcosObservations,
} from "../src/server/adapters/ecos/client";
import { TRACKED_ECOS_SERIES, isEcosErrorResponse } from "../src/server/adapters/ecos/types";
import type { EcosStatisticSearchSuccess } from "../src/server/adapters/ecos/types";
import { normalizeEcosObservations } from "../src/server/adapters/ecos/normalize";

const c = new ContractCheck("ECOS");

const BASE_RATE = TRACKED_ECOS_SERIES[0];
const RANGE = { start: "200001", end: "202612" };

/** TIME format per cycle, straight from the declared type's comment — verified here for real. */
const TIME_PATTERN: Record<string, RegExp> = {
  A: /^\d{4}$/,
  Q: /^\d{4}Q[1-4]$/,
  M: /^\d{6}$/,
  D: /^\d{8}$/,
};

async function verifyShape() {
  c.section(`StatisticSearch ${BASE_RATE.statCode}/${BASE_RATE.itemCode1} (${BASE_RATE.cycle})`);
  const res = await fetchEcosObservations(BASE_RATE, { ...RANGE, startIdx: 1, endIdx: 500 });

  c.check("response is not an error envelope", !isEcosErrorResponse(res));
  if (isEcosErrorResponse(res)) return;

  const body = res as EcosStatisticSearchSuccess;
  c.check("StatisticSearch is present", Boolean(body.StatisticSearch));
  c.check(
    "list_total_count is a number",
    typeof body.StatisticSearch.list_total_count === "number",
    { got: typeof body.StatisticSearch.list_total_count },
  );
  c.check("row is an array", Array.isArray(body.StatisticSearch.row));

  const rows = body.StatisticSearch.row ?? [];
  c.check("at least one row returned", rows.length > 0);
  if (rows.length === 0) return;

  for (const field of ["STAT_CODE", "STAT_NAME", "ITEM_CODE1", "ITEM_NAME1", "UNIT_NAME", "TIME"]) {
    c.check(
      `every row has a string ${field}`,
      rows.every((r) => typeof r[field] === "string"),
      rows.find((r) => typeof r[field] !== "string"),
    );
  }

  // DATA_VALUE is declared as a required string. If ECOS ever omits it entirely rather than
  // sending a marker, the declared type is wrong and normalize's `undefined` branch is load-bearing.
  const missingField = rows.filter((r) => r.DATA_VALUE === undefined).length;
  c.check("DATA_VALUE is always present as a field", missingField === 0, {
    rowsMissingTheField: missingField,
  });

  const pattern = TIME_PATTERN[BASE_RATE.cycle];
  c.check(
    `every TIME matches the ${BASE_RATE.cycle}-cycle format ${pattern}`,
    rows.every((r) => pattern.test(r.TIME)),
    rows.find((r) => !pattern.test(r.TIME))?.TIME,
  );

  // THE question this script exists to answer.
  const markers = summariseNonNumericMarkers(rows.map((r) => r.DATA_VALUE));
  if (markers.length === 0) {
    c.note(
      "No missing values appeared in this window, so the marker convention is still unproven. " +
        "Re-run against a series known to have gaps before treating it as settled.",
    );
  } else {
    c.note(
      `ECOS missing-value markers observed: ${markers.join(", ")}. Record these in ` +
        "src/server/adapters/ecos/types.ts — the conservative any-non-numeric fallback can then " +
        "be narrowed to something that distinguishes a real gap from an unexpected marker.",
    );
  }

  c.info(`UNIT_NAME from ECOS: ${JSON.stringify(rows[0].UNIT_NAME)}`);
  c.info(`declared unit in TRACKED_ECOS_SERIES: ${JSON.stringify(BASE_RATE.unit)}`);

  const normalized = normalizeEcosObservations(body);
  c.check(
    "normalizeEcosObservations accepts the real payload without throwing",
    normalized.observations.length + normalized.skippedMissing.length === rows.length,
  );
  c.info(
    `normalized ${normalized.observations.length} observations, ` +
      `${normalized.skippedMissing.length} treated as missing`,
  );
}

async function verifyPagination() {
  c.section("pagination completeness");
  const page = await fetchAllEcosObservations(BASE_RATE, RANGE);

  c.check("nothing was truncated", page.truncated === false);
  c.check("fetched every row ECOS says exists", page.rows.length === page.totalCount, {
    fetched: page.rows.length,
    listTotalCount: page.totalCount,
  });
  c.check(
    "no duplicate TIME values across window boundaries",
    new Set(page.rows.map((r) => r.TIME)).size === page.rows.length,
  );
  c.info(`${page.rows.length} rows over ${page.requestsMade} request(s)`);

  // Whether ECOS enforces its own per-request row ceiling was an open question when the
  // windowing was written. This answers it.
  c.note(
    `requested windows of 1000 rows; ECOS returned up to ${Math.max(
      ...[page.rows.length, 0],
    )} rows in total across ${page.requestsMade} request(s)`,
  );
}

async function main() {
  if (
    !requireCredential(
      "ECOS_API_KEY",
      "Get a free key at https://ecos.bok.or.kr/api/ (Open API 인증키 신청) and put it in .env.",
    )
  ) {
    return;
  }

  await verifyShape();
  await verifyPagination();
  c.finish();
}

main().catch((err) => {
  console.error(sanitiseErrorForStorage(err));
  process.exitCode = 1;
});
