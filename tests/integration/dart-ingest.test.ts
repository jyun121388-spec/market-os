import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import fixture from "@/server/adapters/dart/__fixtures__/samsung-list.json";
import { TRACKED_DART_COMPANIES } from "@/server/adapters/dart/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SAMSUNG = TRACKED_DART_COMPANIES[0];
const RANGE = { beginDate: "20260801", endDate: "20260814" };

describeIfDb("DART adapter ingest (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestDartFilings: typeof import("@/server/adapters/dart/ingest").ingestDartFilings;

  beforeAll(async () => {
    process.env.DART_API_KEY = "test-key";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestDartFilings } = await import("@/server/adapters/dart/ingest"));

    await prisma.filing.deleteMany({ where: { corpCode: SAMSUNG.corpCode } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists every disclosure as a Filing row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestDartFilings(SAMSUNG, RANGE);
    expect(result).toEqual({
      corpCode: SAMSUNG.corpCode,
      inserted: 2,
      unchanged: 0,
      totalCount: 2,
      pagesFetched: 1,
      truncated: false,
    });

    const stored = await prisma.filing.findMany({ where: { corpCode: SAMSUNG.corpCode } });
    expect(stored).toHaveLength(2);
    expect(stored.map((f) => f.receiptNo).sort()).toEqual(
      ["20260810000456", "20260814000123"].sort(),
    );
  });

  it("is idempotent: re-ingesting the same disclosures does not duplicate rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestDartFilings(SAMSUNG, RANGE);
    expect(result).toEqual({
      corpCode: SAMSUNG.corpCode,
      inserted: 0,
      unchanged: 2,
      totalCount: 2,
      pagesFetched: 1,
      truncated: false,
    });

    const count = await prisma.filing.count({ where: { corpCode: SAMSUNG.corpCode } });
    expect(count).toBe(2);
  });

  it("follows every page instead of storing only the first 100 disclosures", async () => {
    // The defect this locks down: the ingest used to make one request with page_no=1,
    // page_count=100 and then ignore total_page entirely. Samsung files well over 100
    // disclosures a year, so any range wide enough to matter was cut off at 100 rows with
    // nothing failing and nothing warning — a partial filing history that reads as complete.
    await prisma.filing.deleteMany({ where: { corpCode: SAMSUNG.corpCode } });

    const TOTAL = 250;
    const PAGE_SIZE = 100;
    const totalPage = Math.ceil(TOTAL / PAGE_SIZE);
    const requestedPages: number[] = [];

    const makeRow = (i: number) => ({
      ...fixture.list[0],
      rcept_no: `2026080100${String(i).padStart(4, "0")}`,
      report_nm: `Disclosure ${i}`,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const pageNo = Number(url.searchParams.get("page_no"));
        requestedPages.push(pageNo);

        const start = (pageNo - 1) * PAGE_SIZE;
        const list = Array.from(
          { length: Math.max(0, Math.min(PAGE_SIZE, TOTAL - start)) },
          (_, i) => makeRow(start + i),
        );
        return new Response(
          JSON.stringify({
            status: "000",
            message: "정상",
            page_no: pageNo,
            page_count: PAGE_SIZE,
            total_count: TOTAL,
            total_page: totalPage,
            list,
          }),
          { status: 200 },
        );
      }),
    );

    const result = await ingestDartFilings(SAMSUNG, RANGE);

    expect(requestedPages).toEqual([1, 2, 3]); // not just [1]
    expect(result.pagesFetched).toBe(3);
    expect(result.totalCount).toBe(TOTAL);
    expect(result.truncated).toBe(false);
    expect(result.inserted).toBe(TOTAL);

    const stored = await prisma.filing.count({ where: { corpCode: SAMSUNG.corpCode } });
    expect(stored).toBe(TOTAL);

    await prisma.filing.deleteMany({ where: { corpCode: SAMSUNG.corpCode } });
  });

  it("reports truncated=true rather than pretending a capped result is complete", async () => {
    await prisma.filing.deleteMany({ where: { corpCode: SAMSUNG.corpCode } });

    // DART claims far more pages than the runner will fetch. The run must still succeed, but it
    // must say so — an incomplete result presented as complete is the actual hazard here.
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
            total_page: 1000,
            list: [
              {
                ...fixture.list[0],
                rcept_no: `2026080100${String(pageNo).padStart(4, "0")}`,
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await ingestDartFilings(SAMSUNG, RANGE);
    expect(result.truncated).toBe(true);
    expect(result.pagesFetched).toBe(100); // the hard page cap, not 1000

    await prisma.filing.deleteMany({ where: { corpCode: SAMSUNG.corpCode } });
  });

  it("treats DART status 013 (no matching data) as an empty result, not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "013", message: "조회된 데이터가 없습니다." }), {
            status: 200,
          }),
      ),
    );

    const result = await ingestDartFilings(SAMSUNG, { beginDate: "19900101", endDate: "19900102" });
    expect(result.inserted).toBe(0);
  });

  it("throws DartApiError (not a silent empty result) on a genuine error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "020", message: "사용 한도를 초과하였습니다." }), {
            status: 200,
          }),
      ),
    );

    await expect(ingestDartFilings(SAMSUNG, RANGE)).rejects.toThrow(/사용 한도를 초과하였습니다/);
  });
});
