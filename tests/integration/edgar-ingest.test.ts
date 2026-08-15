import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import fixture from "@/server/adapters/edgar/__fixtures__/apple-submissions.json";
import { TRACKED_EDGAR_COMPANIES } from "@/server/adapters/edgar/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const APPLE = TRACKED_EDGAR_COMPANIES[0];

describeIfDb("EDGAR adapter ingest (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestEdgarFilings: typeof import("@/server/adapters/edgar/ingest").ingestEdgarFilings;

  beforeAll(async () => {
    process.env.EDGAR_USER_AGENT = "Market OS test@example.com";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestEdgarFilings } = await import("@/server/adapters/edgar/ingest"));

    const source = await prisma.source.findUnique({ where: { code: "SEC_EDGAR" } });
    if (source) {
      await prisma.filing.deleteMany({ where: { sourceId: source.id, corpCode: APPLE.cik } });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists every filing as a Filing row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestEdgarFilings(APPLE);
    expect(result).toEqual({ cik: APPLE.cik, inserted: 2, unchanged: 0 });

    const stored = await prisma.filing.findMany({ where: { corpCode: APPLE.cik } });
    expect(stored).toHaveLength(2);
    expect(stored.every((f) => f.stockCode === "AAPL")).toBe(true);
  });

  it("is idempotent: re-ingesting the same submissions does not duplicate rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestEdgarFilings(APPLE);
    expect(result).toEqual({ cik: APPLE.cik, inserted: 0, unchanged: 2 });

    const count = await prisma.filing.count({ where: { corpCode: APPLE.cik } });
    expect(count).toBe(2);
  });

  it("throws EdgarApiError on a non-OK HTTP response rather than a silent empty result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" })),
    );

    await expect(ingestEdgarFilings(APPLE)).rejects.toThrow(/404/);
  });
});
