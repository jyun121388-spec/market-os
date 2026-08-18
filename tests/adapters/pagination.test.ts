import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllFredObservations } from "@/server/adapters/fred/client";
import { fetchAllEcosObservations } from "@/server/adapters/ecos/client";
import { fetchAllDartDisclosures } from "@/server/adapters/dart/client";
import { TRACKED_ECOS_SERIES } from "@/server/adapters/ecos/types";

/**
 * Pagination completeness for the three keyed providers.
 *
 * All three adapters shared one defect, found by reading them against their own documented
 * response shapes during the 2026-08-17 hardening pass: each fetched the first page and treated
 * it as the whole answer, while the field that says otherwise — FRED's `count`, ECOS's
 * `list_total_count`, DART's `total_page` — was received and ignored. Nothing failed and nothing
 * warned; the database just quietly held a partial series that read as complete, and every
 * downstream change/regime/analog calculation ran on it. That is the same class of failure as
 * the EDGAR schema drift: trusting the shape of a response nobody had actually looked at.
 *
 * These are deliberately client-level and DB-free. The behaviour under test is "how many
 * requests does the adapter make, and does it stop at the right point" — routing 14,000
 * synthetic rows through the real ingest to assert that took ~30s and proved nothing extra.
 * The DART case is additionally covered end-to-end in tests/integration/dart-ingest.test.ts,
 * where the row count is small enough to be honest about the cost.
 */

const BASE_RATE = TRACKED_ECOS_SERIES[0];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FRED pagination", () => {
  it("sends an explicit limit/offset and pages until it has FRED's own count", async () => {
    process.env.FRED_API_KEY = "test-key";
    const PAGE_SIZE = 5000;
    const TOTAL = 12_000;
    const requests: Array<{ limit: number; offset: number }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const limit = Number(url.searchParams.get("limit"));
        const offset = Number(url.searchParams.get("offset"));
        requests.push({ limit, offset });

        const n = Math.max(0, Math.min(limit, TOTAL - offset));
        return new Response(
          JSON.stringify({
            observation_start: "1990-01-01",
            observation_end: "9999-12-31",
            units: "lin",
            count: TOTAL,
            limit,
            offset,
            observations: Array.from({ length: n }, (_, i) => ({
              date: new Date(Date.UTC(1990, 0, 1 + offset + i)).toISOString().slice(0, 10),
              realtime_start: "1990-01-01",
              realtime_end: "9999-12-31",
              value: "1.23",
            })),
          }),
          { status: 200 },
        );
      }),
    );

    const page = await fetchAllFredObservations("DGS10");

    // The old client made exactly one request and sent no limit at all.
    expect(requests).toEqual([
      { limit: PAGE_SIZE, offset: 0 },
      { limit: PAGE_SIZE, offset: PAGE_SIZE },
      { limit: PAGE_SIZE, offset: PAGE_SIZE * 2 },
    ]);
    expect(page.observations).toHaveLength(TOTAL);
    expect(page.count).toBe(TOTAL);
    expect(page.truncated).toBe(false);
  });

  it("stops after one request when the series fits in a single page", async () => {
    process.env.FRED_API_KEY = "test-key";
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            observation_start: "2026-01-01",
            observation_end: "2026-01-03",
            units: "lin",
            count: 2,
            limit: 5000,
            offset: 0,
            observations: [
              { date: "2026-01-01", realtime_start: "x", realtime_end: "y", value: "1" },
              { date: "2026-01-02", realtime_start: "x", realtime_end: "y", value: "2" },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const page = await fetchAllFredObservations("DGS10");
    expect(calls).toBe(1);
    expect(page.observations).toHaveLength(2);
    expect(page.truncated).toBe(false);
  });
});

describe("ECOS pagination", () => {
  it("walks the [startIdx, endIdx] window instead of stopping at the first request", async () => {
    process.env.ECOS_API_KEY = "test-key";
    const PAGE_SIZE = 1000;
    const TOTAL = 2300;
    const windows: Array<[number, number]> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        // ECOS is path-addressed: .../json/kr/{startIdx}/{endIdx}/{statCode}/...
        const parts = String(input).split("/");
        const kr = parts.indexOf("kr");
        const startIdx = Number(parts[kr + 1]);
        const endIdx = Number(parts[kr + 2]);
        windows.push([startIdx, endIdx]);

        const n = Math.max(0, Math.min(endIdx, TOTAL) - startIdx + 1);
        return new Response(
          JSON.stringify({
            StatisticSearch: {
              list_total_count: TOTAL,
              row: Array.from({ length: n }, (_, i) => ({
                STAT_CODE: BASE_RATE.statCode,
                STAT_NAME: BASE_RATE.name,
                ITEM_CODE1: BASE_RATE.itemCode1,
                ITEM_NAME1: "item",
                UNIT_NAME: "%",
                TIME: String(200001 + startIdx + i),
                DATA_VALUE: "1.5",
              })),
            },
          }),
          { status: 200 },
        );
      }),
    );

    const page = await fetchAllEcosObservations(BASE_RATE, { start: "200001", end: "202612" });

    expect(windows).toEqual([
      [1, PAGE_SIZE],
      [PAGE_SIZE + 1, PAGE_SIZE * 2],
      [PAGE_SIZE * 2 + 1, PAGE_SIZE * 3],
    ]);
    expect(page.rows).toHaveLength(TOTAL);
    expect(page.totalCount).toBe(TOTAL);
    expect(page.truncated).toBe(false);
  });
});

describe("DART pagination", () => {
  it("reports truncated=true rather than presenting a capped result as complete", async () => {
    process.env.DART_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const pageNo = Number(new URL(String(input)).searchParams.get("page_no"));
        return new Response(
          JSON.stringify({
            status: "000",
            message: "정상",
            page_no: pageNo,
            page_count: 1,
            total_count: 100_000,
            total_page: 1000, // far beyond the client's hard page cap
            list: [
              {
                corp_code: "00126380",
                corp_name: "삼성전자",
                stock_code: "005930",
                corp_cls: "Y",
                report_nm: "r",
                rcept_no: `2026080100${String(pageNo).padStart(4, "0")}`,
                flr_nm: "f",
                rcept_dt: "20260801",
                rm: "",
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const page = await fetchAllDartDisclosures("00126380", {
      beginDate: "20260101",
      endDate: "20261231",
    });

    expect(page.truncated).toBe(true);
    expect(page.pagesFetched).toBe(100);
    // An incomplete result must still be usable and honest about what it is, not an exception
    // and not a silent shortfall.
    expect(page.rows).toHaveLength(100);
    expect(page.totalCount).toBe(100_000);
  });

  it("stops early when DART returns an empty page before its declared total_page", async () => {
    process.env.DART_API_KEY = "test-key";
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            status: "000",
            message: "정상",
            page_no: calls,
            page_count: 100,
            total_count: 500,
            total_page: 5, // claims 5 pages but has nothing to give
            list: [],
          }),
          { status: 200 },
        );
      }),
    );

    const page = await fetchAllDartDisclosures("00126380", {
      beginDate: "20260101",
      endDate: "20261231",
    });

    // DART disagreeing with its own total_page must not become an infinite loop.
    expect(calls).toBe(1);
    expect(page.rows).toHaveLength(0);
  });
});

/**
 * A SHORT PAGE IS NOT A COMPLETE ANSWER (IR-030).
 *
 * All three adapters stopped on a short page and reported `truncated: false` — conflating the
 * reason they stopped looping with the question of whether they hold everything. Stopping early on
 * a short page is right; concluding "therefore complete" is a separate claim, and it is false
 * whenever the provider's own declared total says otherwise.
 *
 * This is the 1000-of-2240 defect in a different provider's clothes: a partial result reported as
 * success, with the field that contradicts it received and ignored. `recordIngestRun` marks the run
 * SUCCESS off that boolean, and `/company` renders completeness from the run.
 *
 * Found by independent review (`gpt-5.6-terra`, review packet target A4) and reproduced here
 * before anything was changed.
 */
describe("a short page before the declared total", () => {
  it("FRED: holding 100 of a declared 10,000 is truncated, not complete", async () => {
    process.env.FRED_API_KEY = "test-key";
    const DECLARED = 10_000;
    const RETURNED = 100;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              observation_start: "1990-01-01",
              observation_end: "9999-12-31",
              units: "lin",
              count: DECLARED,
              observations: Array.from({ length: RETURNED }, (_, i) => ({
                date: new Date(Date.UTC(1990, 0, 1 + i)).toISOString().slice(0, 10),
                realtime_start: "1990-01-01",
                realtime_end: "9999-12-31",
                value: "1.23",
              })),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const page = await fetchAllFredObservations("DGS10");
    expect(page.observations.length).toBe(RETURNED);
    expect(page.count).toBe(DECLARED);
    // The whole finding in one assertion.
    expect(page.truncated).toBe(true);
  });

  it("ECOS: holding 40 of a declared 900 is truncated, not complete", async () => {
    process.env.ECOS_API_KEY = "test-key";
    const DECLARED = 900;
    const RETURNED = 40;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              StatisticSearch: {
                list_total_count: DECLARED,
                row: Array.from({ length: RETURNED }, (_, i) => ({
                  STAT_CODE: BASE_RATE.statCode,
                  STAT_NAME: "base rate",
                  ITEM_CODE1: BASE_RATE.itemCode1,
                  ITEM_NAME1: "x",
                  UNIT_NAME: "%",
                  TIME: `2026${String((i % 12) + 1).padStart(2, "0")}`,
                  DATA_VALUE: "2.5",
                })),
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const page = await fetchAllEcosObservations(BASE_RATE, { start: "199001", end: "209912" });
    expect(page.rows.length).toBe(RETURNED);
    expect(page.totalCount).toBe(DECLARED);
    expect(page.truncated).toBe(true);
  });

  it("DART: an empty page before the declared end is truncated, not complete", async () => {
    process.env.DART_API_KEY = "test-key";
    // DART declares two pages and 200 rows, then returns nothing on page 2 — its own total
    // disagreeing with its own pagination. Breaking the loop is right; calling the result
    // complete is not.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const pageNo = Number(new URL(String(input)).searchParams.get("page_no"));
        return new Response(
          JSON.stringify({
            status: "000",
            message: "정상",
            page_no: pageNo,
            page_count: 100,
            total_count: 200,
            total_page: 2,
            list:
              pageNo === 1
                ? Array.from({ length: 100 }, (_, i) => ({
                    corp_code: "00126380",
                    corp_name: "삼성전자",
                    stock_code: "005930",
                    corp_cls: "Y",
                    report_nm: "보고서",
                    rcept_no: `2026${String(i).padStart(10, "0")}`,
                    flr_nm: "삼성전자",
                    rcept_dt: "20260101",
                    rm: "",
                  }))
                : [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const page = await fetchAllDartDisclosures("00126380", {
      beginDate: "20260101",
      endDate: "20261231",
    });
    expect(page.rows.length).toBe(100);
    expect(page.totalCount).toBe(200);
    expect(page.truncated).toBe(true);
  });

  it("still reports complete when the short page IS everything the provider declared", async () => {
    // The control. Every real series ends on a short page, and turning that into a permanent
    // truncation warning would make the signal worthless — which is the failure mode of the
    // over-broad fix.
    process.env.FRED_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              observation_start: "1990-01-01",
              observation_end: "9999-12-31",
              units: "lin",
              count: 3,
              observations: [
                { date: "2026-01-01", realtime_start: "x", realtime_end: "y", value: "1" },
                { date: "2026-01-02", realtime_start: "x", realtime_end: "y", value: "2" },
                { date: "2026-01-03", realtime_start: "x", realtime_end: "y", value: "3" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const page = await fetchAllFredObservations("DGS10");
    expect(page.observations.length).toBe(3);
    expect(page.truncated).toBe(false);
  });
});
