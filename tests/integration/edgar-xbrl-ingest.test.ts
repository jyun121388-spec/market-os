import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import fixture from "@/server/adapters/edgar-xbrl/__fixtures__/apple-companyfacts.json";
import { TRACKED_XBRL_COMPANIES } from "@/server/adapters/edgar-xbrl/types";
import { padCik } from "@/server/adapters/edgar/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const APPLE = TRACKED_XBRL_COMPANIES[0];
/**
 * Facts are stored under the canonical zero-padded CIK, matching what the filings adapter
 * stores. The tracked definition carries the unpadded form, and storing that was the bug: the
 * same company ended up under two identifiers and nothing could join filings to facts.
 */
const APPLE_CORP_CODE = padCik(APPLE.cik);

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
        where: { sourceId: source.id, corpCode: APPLE_CORP_CODE },
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
          corpCode: APPLE_CORP_CODE,
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
    expect(result).toEqual({
      cik: APPLE.cik,
      inserted: 4,
      unchanged: 0,
      // Eight concepts are tracked and this fixture defines three of them; the other five are
      // reported as skipped rather than being silently absent from the output.
      skippedConcepts: 5,
      skippedNonNumeric: 0,
    });

    const stored = await prisma.financialFact.findMany({ where: { corpCode: APPLE_CORP_CODE } });
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
    expect(result).toEqual({
      cik: APPLE.cik,
      inserted: 0,
      unchanged: 4,
      skippedConcepts: 5,
      skippedNonNumeric: 0,
    });

    const count = await prisma.financialFact.count({ where: { corpCode: APPLE_CORP_CODE } });
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
      where: { corpCode: APPLE_CORP_CODE, concept: "Revenues" },
    });
    expect(revenueRows).toHaveLength(2); // original + restated, both preserved
  });

  it("keeps a year-to-date and a quarterly figure that share a period end and accession", async () => {
    // Verified against live SEC data. One filing reports the same concept twice for one period
    // end, distinguished only by `start`: Apple's NetIncomeLoss under accession
    // 0001193125-09-153165 ending 2008-06-28 is $3.698B over nine months AND $1.072B over one
    // quarter. The old unique key omitted `periodStart`, so it treated those as the same row and
    // kept whichever arrived first — a 3.4x difference decided by array order. A single real
    // ingest of one company silently discarded 168 facts this way and reported them "unchanged".
    await prisma.financialFact.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });

    const sharedPeriodEnd = {
      ...fixture,
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            label: "Net Income (Loss)",
            units: {
              USD: [
                {
                  start: "2007-09-30", // nine months
                  end: "2008-06-28",
                  val: 3698000000,
                  accn: "0001193125-09-153165",
                  fy: 2009,
                  fp: "Q3",
                  form: "10-Q",
                  filed: "2009-07-22",
                },
                {
                  start: "2008-03-30", // one quarter, same end AND same accession
                  end: "2008-06-28",
                  val: 1072000000,
                  accn: "0001193125-09-153165",
                  fy: 2009,
                  fp: "Q3",
                  form: "10-Q",
                  filed: "2009-07-22",
                },
              ],
            },
          },
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(sharedPeriodEnd), { status: 200 })),
    );

    const first = await ingestCompanyFacts(APPLE);
    expect(first.inserted).toBe(2); // both, not one

    const rows = await prisma.financialFact.findMany({
      where: { corpCode: APPLE_CORP_CODE, concept: "NetIncomeLoss" },
      orderBy: { periodStart: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.value.toString())).toEqual(["3698000000", "1072000000"]);
    expect(rows.map((r) => r.periodStart?.toISOString().slice(0, 10))).toEqual([
      "2007-09-30",
      "2008-03-30",
    ]);

    // Still idempotent: the looser identity must not turn re-ingestion into duplication.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(sharedPeriodEnd), { status: 200 })),
    );
    const second = await ingestCompanyFacts(APPLE);
    expect(second.inserted).toBe(0);
    expect(second.unchanged).toBe(2);

    await prisma.financialFact.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });
  });

  it("still deduplicates instant concepts, which have no periodStart", async () => {
    // periodStart is NULL for Assets/Liabilities/Cash, and Postgres treats NULL as distinct from
    // NULL in a unique index — so a naive "just add periodStart to the key" fix would have
    // silently stopped enforcing uniqueness for exactly those rows. Two partial indexes instead.
    await prisma.financialFact.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });

    const instantOnly = {
      ...fixture,
      facts: {
        "us-gaap": {
          Assets: {
            label: "Assets",
            units: {
              USD: [
                {
                  end: "2026-06-30",
                  val: 350000000000,
                  accn: "0000320193-26-000045",
                  fy: 2026,
                  fp: "FY",
                  form: "10-K",
                  filed: "2026-08-01",
                },
              ],
            },
          },
        },
      },
    };

    for (let i = 0; i < 2; i++) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(instantOnly), { status: 200 })),
      );
      await ingestCompanyFacts(APPLE);
    }

    const rows = await prisma.financialFact.findMany({
      where: { corpCode: APPLE_CORP_CODE, concept: "Assets" },
    });
    expect(rows).toHaveLength(1);

    await prisma.financialFact.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });
  });
});
