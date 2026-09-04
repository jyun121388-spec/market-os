import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import edgarFixture from "@/server/adapters/edgar/__fixtures__/apple-submissions.json";
import xbrlFixture from "@/server/adapters/edgar-xbrl/__fixtures__/apple-companyfacts.json";
import { TRACKED_EDGAR_COMPANIES } from "@/server/adapters/edgar/types";
import { TRACKED_XBRL_COMPANIES } from "@/server/adapters/edgar-xbrl/types";

/**
 * The two EDGAR adapters must identify a company the same way.
 *
 * They did not. The filings adapter stores the `cik` SEC returns, which is zero-padded to ten
 * digits ("0000320193"); the XBRL adapter stored whatever the caller passed, which is the
 * unpadded "320193" from its tracked-company list. The same company therefore existed under two
 * identifiers, and nothing could join its filings to its financial facts.
 *
 * The consequence was user-visible and silent. `askMarket.ts`'s `findCompanyFacts` locates a
 * Filing by company name and then looks up FinancialFacts by that filing's `corpCode`, so the
 * "Company facts" section of Ask Market returned nothing at all for every EDGAR company.
 * Measured against real ingested data before the fix: 2240 filings, 933 facts, 0 joinable rows.
 * No error, no empty-state message that distinguished "this company has no facts" from "the
 * lookup cannot work" — just a missing section.
 *
 * A unit test on either adapter alone would have passed. The defect only exists between them,
 * which is why this test ingests through both and joins the results.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const APPLE_FILINGS = TRACKED_EDGAR_COMPANIES[0];
const APPLE_XBRL = TRACKED_XBRL_COMPANIES[0];

describeIfDb("EDGAR corpCode consistency (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestEdgarFilings: typeof import("@/server/adapters/edgar/ingest").ingestEdgarFilings;
  let ingestCompanyFacts: typeof import("@/server/adapters/edgar-xbrl/ingest").ingestCompanyFacts;

  const cleanup = async () => {
    const source = await prisma.source.findUnique({ where: { code: "SEC_EDGAR" } });
    if (!source) return;
    for (const code of ["320193", "0000320193"]) {
      await prisma.filing.deleteMany({ where: { sourceId: source.id, corpCode: code } });
      await prisma.financialFact.deleteMany({ where: { sourceId: source.id, corpCode: code } });
    }
  };

  beforeAll(async () => {
    process.env.EDGAR_USER_AGENT = "Market OS test@example.com";
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestEdgarFilings } = await import("@/server/adapters/edgar/ingest"));
    ({ ingestCompanyFacts } = await import("@/server/adapters/edgar-xbrl/ingest"));
    await cleanup();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await cleanup();
    await prisma.$disconnect();
  });

  it("stores filings and financial facts under the same corpCode, so they can be joined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        const body = url.includes("companyfacts") ? xbrlFixture : edgarFixture;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );

    await ingestEdgarFilings(APPLE_FILINGS);
    await ingestCompanyFacts(APPLE_XBRL);
    vi.unstubAllGlobals();

    // Scoped to Apple's two possible identifiers rather than to the whole source: the dev
    // database is shared with other fixtures that also write under SEC_EDGAR.
    const appleCodes = { in: ["320193", "0000320193"] };
    const source = await prisma.source.findUniqueOrThrow({ where: { code: "SEC_EDGAR" } });
    const filings = await prisma.filing.findMany({
      where: { sourceId: source.id, corpCode: appleCodes },
    });
    const facts = await prisma.financialFact.findMany({
      where: { sourceId: source.id, corpCode: appleCodes },
    });

    expect(filings.length).toBeGreaterThan(0);
    expect(facts.length).toBeGreaterThan(0);

    const filingCodes = [...new Set(filings.map((f) => f.corpCode))];
    const factCodes = [...new Set(facts.map((f) => f.corpCode))];

    // The assertion that actually matters: one shared identifier, not two.
    expect(factCodes).toEqual(filingCodes);

    // And it is the canonical zero-padded form SEC itself uses.
    expect(filingCodes).toEqual(["0000320193"]);
  });

  it("lets Ask Market reach a company's facts from its filing", async () => {
    // The exact path that was silently broken: filing found by name, facts looked up by that
    // filing's corpCode.
    const source = await prisma.source.findUniqueOrThrow({ where: { code: "SEC_EDGAR" } });
    const filing = await prisma.filing.findFirstOrThrow({
      where: { sourceId: source.id, corpCode: { in: ["320193", "0000320193"] } },
    });

    const facts = await prisma.financialFact.findMany({
      where: { corpCode: filing.corpCode },
    });

    expect(facts.length).toBeGreaterThan(0);
  });
});
