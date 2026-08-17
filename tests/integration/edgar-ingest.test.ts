import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import fixture from "@/server/adapters/edgar/__fixtures__/apple-submissions.json";
import { TRACKED_EDGAR_COMPANIES, padCik } from "@/server/adapters/edgar/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const APPLE = TRACKED_EDGAR_COMPANIES[0];
/**
 * Filings are stored under the canonical zero-padded CIK. The adapter used to pass SEC's `cik`
 * straight through — padded in real responses, unpadded in this fixture — so the stored
 * identifier depended on where the data came from. See tests/integration/corp-code-consistency.
 */
const APPLE_CORP_CODE = padCik(APPLE.cik);

describeIfDb("EDGAR adapter ingest (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestEdgarFilings: typeof import("@/server/adapters/edgar/ingest").ingestEdgarFilings;

  beforeAll(async () => {
    process.env.EDGAR_USER_AGENT = "Market OS test@example.com";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestEdgarFilings } = await import("@/server/adapters/edgar/ingest"));

    const source = await prisma.source.findUnique({ where: { code: "SEC_EDGAR" } });
    if (source) {
      await prisma.filing.deleteMany({ where: { sourceId: source.id, corpCode: APPLE_CORP_CODE } });
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
    expect(result).toEqual({
      cik: APPLE.cik,
      inserted: 2,
      unchanged: 0,
      recentCount: 2,
      totalFetched: 2,
      providerTotal: 2,
      overflowFilesFetched: 0,
      truncated: false,
    });

    const stored = await prisma.filing.findMany({ where: { corpCode: APPLE_CORP_CODE } });
    expect(stored).toHaveLength(2);
    expect(stored.every((f) => f.stockCode === "AAPL")).toBe(true);
  });

  it("is idempotent: re-ingesting the same submissions does not duplicate rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestEdgarFilings(APPLE);
    expect(result).toEqual({
      cik: APPLE.cik,
      inserted: 0,
      unchanged: 2,
      recentCount: 2,
      totalFetched: 2,
      providerTotal: 2,
      overflowFilesFetched: 0,
      truncated: false,
    });

    const count = await prisma.filing.count({ where: { corpCode: APPLE_CORP_CODE } });
    expect(count).toBe(2);
  });

  it("fetches the overflow files instead of storing only filings.recent", async () => {
    // The defect this locks down, found with live evidence on 2026-08-17: SEC hard-caps
    // `filings.recent` at 1000 and spills everything older into `filings.files[]`. The ingest
    // read `recent` alone, so Apple's stored history was exactly 1000 filings back to 2015 and
    // silently missing 1240 more covering 1994-2015 — 55% of it, absent without a word. The
    // stored count being exactly 1000 was the tell.
    await prisma.filing.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });

    const requested: string[] = [];
    const overflowRow = (i: number) => `000032019${String(i).padStart(2, "0")}-94-000001`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        requested.push(url);

        if (url.includes("-submissions-001.json")) {
          // Overflow documents use the same parallel-array layout at the TOP level, with no
          // enclosing `filings` wrapper (verified live).
          return new Response(
            JSON.stringify({
              accessionNumber: [overflowRow(1), overflowRow(2)],
              filingDate: ["1994-01-26", "1995-02-15"],
              reportDate: ["", ""],
              acceptanceDateTime: ["", ""],
              act: ["", ""],
              form: ["10-K", "10-Q"],
              fileNumber: ["", ""],
              filmNumber: ["", ""],
              items: ["", ""],
              size: [1, 2],
              isXBRL: [0, 0],
              isInlineXBRL: [0, 0],
              primaryDocument: ["a.htm", "b.htm"],
              primaryDocDescription: ["Old annual report", "Old quarterly report"],
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({
            ...fixture,
            filings: {
              ...fixture.filings,
              files: [
                {
                  name: "CIK0000320193-submissions-001.json",
                  filingCount: 2,
                  filingFrom: "1994-01-26",
                  filingTo: "1995-02-15",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const result = await ingestEdgarFilings(APPLE);

    expect(requested.some((u) => u.includes("-submissions-001.json"))).toBe(true);
    expect(result.recentCount).toBe(2);
    expect(result.overflowFilesFetched).toBe(1);
    expect(result.totalFetched).toBe(4); // 2 recent + 2 overflow
    expect(result.inserted).toBe(4);
    expect(result.truncated).toBe(false);

    const stored = await prisma.filing.findMany({ where: { corpCode: APPLE_CORP_CODE } });
    expect(stored).toHaveLength(4);
    // The 1994 filing is the one the old code dropped entirely.
    expect(stored.some((f) => f.receiptDate.toISOString().startsWith("1994-01-26"))).toBe(true);
    // Company metadata from the primary document is applied to overflow rows too, which carry
    // none of their own.
    expect(stored.every((f) => f.stockCode === "AAPL")).toBe(true);

    await prisma.filing.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });
  });

  it("throws EdgarApiError on a non-OK HTTP response rather than a silent empty result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" })),
    );

    await expect(ingestEdgarFilings(APPLE)).rejects.toThrow(/404/);
  });
});
