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
    expect(result).toEqual({ corpCode: SAMSUNG.corpCode, inserted: 2, unchanged: 0 });

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
    expect(result).toEqual({ corpCode: SAMSUNG.corpCode, inserted: 0, unchanged: 2 });

    const count = await prisma.filing.count({ where: { corpCode: SAMSUNG.corpCode } });
    expect(count).toBe(2);
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
