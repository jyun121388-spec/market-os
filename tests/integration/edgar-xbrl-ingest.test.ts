import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import fixture from "@/server/adapters/edgar-xbrl/__fixtures__/apple-companyfacts.json";
import { TRACKED_XBRL_COMPANIES } from "@/server/adapters/edgar-xbrl/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const APPLE = TRACKED_XBRL_COMPANIES[0];

describeIfDb("EDGAR XBRL adapter ingest (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestCompanyFacts: typeof import("@/server/adapters/edgar-xbrl/ingest").ingestCompanyFacts;

  beforeAll(async () => {
    process.env.EDGAR_USER_AGENT = "Market OS test@example.com";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestCompanyFacts } = await import("@/server/adapters/edgar-xbrl/ingest"));

    const source = await prisma.source.findUnique({ where: { code: "SEC_EDGAR" } });
    if (source) {
      await prisma.financialFact.deleteMany({
        where: { sourceId: source.id, corpCode: APPLE.cik },
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    // Clean up the fixture rows. These are synthetic Apple financials (a fabricated $400B
    // "Revenues"), and the same dev database can also hold facts from a real EDGAR ingest —
    // leaving them behind puts invented numbers next to sourced ones, which is exactly the
    // confusion docs/DATA_POLICY.md exists to prevent. beforeAll already clears them on the
    // way in; this clears them on the way out too.
    const source = await prisma.source.findUnique({ where: { code: "SEC_EDGAR" } });
    if (source) {
      await prisma.financialFact.deleteMany({
        where: {
          sourceId: source.id,
          corpCode: APPLE.cik,
          accessionNumber: { in: ["0000320193-26-000045", "0000320193-26-000099"] },
        },
      });
    }
    await prisma.$disconnect();
  });

  it("persists tracked financial facts, skipping untracked concepts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestCompanyFacts(APPLE);
    expect(result).toEqual({ cik: APPLE.cik, inserted: 4, unchanged: 0 });

    const stored = await prisma.financialFact.findMany({ where: { corpCode: APPLE.cik } });
    expect(stored).toHaveLength(4);
    const revenue = stored.find((f) => f.concept === "Revenues")!;
    expect(revenue.value.toString()).toBe("400000000000");
    expect(revenue.fiscalYear).toBe(2026);

    // A row SEC reports with no fiscal label must persist rather than fail the NOT NULL
    // constraint the columns used to carry — see the 20260817120000 migration.
    const unlabeled = stored.find((f) => f.accessionNumber === "0001193125-15-023732")!;
    expect(unlabeled.fiscalYear).toBeNull();
    expect(unlabeled.fiscalPeriod).toBeNull();
    expect(unlabeled.value.toString()).toBe("207000000000");
  });

  it("is idempotent: re-ingesting identical facts does not duplicate rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
    );

    const result = await ingestCompanyFacts(APPLE);
    expect(result).toEqual({ cik: APPLE.cik, inserted: 0, unchanged: 4 });

    const count = await prisma.financialFact.count({ where: { corpCode: APPLE.cik } });
    expect(count).toBe(4);
  });

  it("preserves a restated value as a new row when a later filing reports a different accession number", async () => {
    const restated = {
      ...fixture,
      facts: {
        ...fixture.facts,
        "us-gaap": {
          ...fixture.facts["us-gaap"],
          Revenues: {
            label: "Revenues",
            units: {
              USD: [
                {
                  ...fixture.facts["us-gaap"].Revenues.units.USD[0],
                  val: 405000000000, // restated value
                  accn: "0000320193-26-000099", // new accession number
                },
              ],
            },
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(restated), { status: 200 })),
    );

    const result = await ingestCompanyFacts(APPLE);
    expect(result.inserted).toBe(1); // only the restated Revenues row is new

    const revenueRows = await prisma.financialFact.findMany({
      where: { corpCode: APPLE.cik, concept: "Revenues" },
    });
    expect(revenueRows).toHaveLength(2); // original + restated, both preserved
  });
});
