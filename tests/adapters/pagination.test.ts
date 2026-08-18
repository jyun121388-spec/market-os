import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllFredObservations } from "@/server/adapters/fred/client";
import { fetchAllEcosObservations } from "@/server/adapters/ecos/client";
import { fetchAllDartDisclosures } from "@/server/adapters/dart/client";
import { fetchEdgarFilingHistory } from "@/server/adapters/edgar/client";
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

/**
 * EDGAR: the fourth adapter with the same completeness defect (IR-038).
 *
 * IR-030 fixed FRED, ECOS and DART, all of which derived `truncated` from the reason their loop
 * stopped rather than from held-versus-declared. EDGAR was not part of that finding and has the
 * same shape: `truncated: overflowFiles.length > MAX_OVERFLOW_FILES` — a statement about hitting
 * OUR OWN page cap, not about whether we hold what SEC says exists.
 *
 * It computes `providerTotal` correctly, and carefully: `filings.recent.length` plus the
 * `filingCount` SEC declares on every overflow file, INCLUDING the ones this run chose not to
 * fetch. Everything needed to answer the question is right there and is never compared.
 *
 * This is the live path. EDGAR is the only provider with real data, so unlike IR-032 and IR-037
 * this is not latent — a short or partial overflow document makes `/company` report a complete
 * filing history it does not hold, exactly as 1000 of 2240 once did.
 */
describe("EDGAR completeness comes from the page cap, not from the count", () => {
  const CIK = "0000320193";
  const submissions = (overflow: { name: string; filingCount: number }[]) => ({
    cik: CIK,
    name: "Apple Inc.",
    entityType: "operating",
    tickers: ["AAPL"],
    exchanges: ["Nasdaq"],
    filings: {
      recent: {
        accessionNumber: ["0000320193-26-000001"],
        filingDate: ["2026-01-02"],
        reportDate: ["2026-01-01"],
        acceptanceDateTime: ["2026-01-02T00:00:00.000Z"],
        act: [""],
        form: ["10-K"],
        fileNumber: [""],
        filmNumber: [""],
        items: [""],
        primaryDocument: ["a.htm"],
        primaryDocDescription: ["10-K"],
        size: [1],
        isXBRL: [1],
        isInlineXBRL: [1],
      },
      files: overflow,
    },
  });

  const overflowBody = (rows: number) => ({
    accessionNumber: Array.from(
      { length: rows },
      (_, i) => `0000320193-25-${String(i).padStart(6, "0")}`,
    ),
    filingDate: Array.from({ length: rows }, () => "2025-06-01"),
    reportDate: Array.from({ length: rows }, () => "2025-05-31"),
    acceptanceDateTime: Array.from({ length: rows }, () => "2025-06-01T00:00:00.000Z"),
    act: Array.from({ length: rows }, () => ""),
    form: Array.from({ length: rows }, () => "8-K"),
    fileNumber: Array.from({ length: rows }, () => ""),
    filmNumber: Array.from({ length: rows }, () => ""),
    items: Array.from({ length: rows }, () => ""),
    primaryDocument: Array.from({ length: rows }, () => "b.htm"),
    primaryDocDescription: Array.from({ length: rows }, () => "8-K"),
    size: Array.from({ length: rows }, () => 1),
    isXBRL: Array.from({ length: rows }, () => 0),
    isInlineXBRL: Array.from({ length: rows }, () => 0),
  });

  it("declares 501 filings, returns 101, and reports truncated", async () => {
    process.env.EDGAR_USER_AGENT = "market-os-test test@example.com";
    // One overflow file, well under the 20-file cap, that declares 500 filings and serves 100.
    // A short document, a partial mirror, or SEC's own count drifting all produce this.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        const body = url.includes("CIK0000320193-submissions-001.json")
          ? overflowBody(100)
          : submissions([{ name: "CIK0000320193-submissions-001.json", filingCount: 500 }]);
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const history = await fetchEdgarFilingHistory(CIK);

    // SEC says 501 exist. We hold 101.
    expect(history.providerTotal).toBe(501);
    expect(history.filings.form.length).toBe(101);

    // And the run reports itself complete, because the only question asked was whether OUR page
    // cap was hit. recordIngestRun turns this boolean into SUCCESS, and /company renders
    // completeness from the run.
    // Fixed: truncation now comes from held-versus-declared, not from whether our own page cap
    // was hit. recordIngestRun turns this into PARTIAL rather than SUCCESS, and /company reports
    // a shortfall instead of a complete history it does not hold.
    expect(history.truncated).toBe(true);
  });

  it("does report truncation when the page cap itself is hit", async () => {
    // The control: the one case the current logic does catch must keep working, so a fix narrows
    // nothing. Twenty-one overflow files exceed MAX_OVERFLOW_FILES.
    process.env.EDGAR_USER_AGENT = "market-os-test test@example.com";
    const files = Array.from({ length: 21 }, (_, i) => ({
      name: `CIK0000320193-submissions-${String(i).padStart(3, "0")}.json`,
      filingCount: 1,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const body = String(input).includes("-submissions-") ? overflowBody(1) : submissions(files);
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const history = await fetchEdgarFilingHistory(CIK);
    expect(history.truncated).toBe(true);
  });
});
