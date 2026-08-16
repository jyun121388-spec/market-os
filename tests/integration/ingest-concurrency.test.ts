import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import edgarFixture from "@/server/adapters/edgar/__fixtures__/apple-submissions.json";
import { TRACKED_EDGAR_COMPANIES, padCik } from "@/server/adapters/edgar/types";

/**
 * Concurrent runs of the same ingest.
 *
 * The filing and financial-fact ingests are `findUnique` → if absent, `create`: a read-then-write
 * pretending to be atomic. Two concurrent runs over the same range both see nothing and both
 * insert, and the loser gets a raw P2002 for a row the ingest itself defines as idempotent.
 * Sequential runs never hit it, which is exactly why it survived — the job runner is sequential
 * today, but nothing stops two overlapping invocations of `npm run jobs:ingest-all`, and a real
 * scheduler is a Human Gate away.
 *
 * Third instance of this shape found on 2026-08-17, after the observation revision chain and the
 * watchlist upsert. In all three the database constraint already guarantees the invariant, so
 * losing the race is the correct outcome — what must not happen is a crash or a miscount.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const APPLE = TRACKED_EDGAR_COMPANIES[0];
/** Filings are stored under the canonical zero-padded CIK — see corp-code-consistency.test.ts. */
const APPLE_CORP_CODE = padCik(APPLE.cik);

describeIfDb("concurrent ingest runs (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestEdgarFilings: typeof import("@/server/adapters/edgar/ingest").ingestEdgarFilings;

  beforeAll(async () => {
    process.env.EDGAR_USER_AGENT = "Market OS test@example.com";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestEdgarFilings } = await import("@/server/adapters/edgar/ingest"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.filing.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });
  });

  afterAll(async () => {
    await prisma.filing.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });
    await prisma.$disconnect();
  });

  it("N concurrent EDGAR ingests store each filing exactly once and never throw", async () => {
    await prisma.filing.deleteMany({ where: { corpCode: APPLE_CORP_CODE } });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(edgarFixture), { status: 200 })),
    );

    // Promise.all rejects if any run throws, which is half the assertion.
    const results = await Promise.all([
      ingestEdgarFilings(APPLE),
      ingestEdgarFilings(APPLE),
      ingestEdgarFilings(APPLE),
      ingestEdgarFilings(APPLE),
    ]);

    const stored = await prisma.filing.findMany({ where: { corpCode: APPLE_CORP_CODE } });
    const fixtureCount = edgarFixture.filings.recent.accessionNumber.length;

    // Exactly one row per filing, no duplicates.
    expect(stored).toHaveLength(fixtureCount);
    expect(new Set(stored.map((f) => f.receiptNo)).size).toBe(fixtureCount);

    // And the counts add up honestly: across all runs, each filing is reported as inserted
    // exactly once. A run that lost the race must report `unchanged`, not `inserted` — an
    // inflated insert count is a quieter bug than a crash but still a false report.
    const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
    expect(totalInserted).toBe(fixtureCount);
    for (const r of results) {
      expect(r.inserted + r.unchanged).toBe(fixtureCount);
    }
  });
});
