/**
 * Real invocation path for the SEC EDGAR adapter (M06) — ingests filings for every company
 * in TRACKED_EDGAR_COMPANIES.
 *
 * Usage: EDGAR_USER_AGENT="Market OS you@example.com" DATABASE_URL=... npx tsx scripts/ingest-edgar.ts
 */
import { ingestEdgarFilings } from "../src/server/adapters/edgar/ingest";
import { TRACKED_EDGAR_COMPANIES } from "../src/server/adapters/edgar/types";
import { recordIngestRun } from "../src/server/domain/ingestRun";
import { prisma } from "../src/server/db/client";

async function main() {
  for (const company of TRACKED_EDGAR_COMPANIES) {
    const result = await recordIngestRun(
      { sourceCode: "SEC_EDGAR", target: company.cik },
      async () => {
        const r = await ingestEdgarFilings(company);
        return { ...r, fetched: r.totalFetched, providerTotal: null };
      },
    );
    console.log(
      `[EDGAR] ${company.corpName} (CIK ${result.cik}): +${result.inserted} inserted, ` +
        `${result.unchanged} unchanged (${result.totalFetched} filings across ` +
        `${result.overflowFilesFetched + 1} document(s))`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
