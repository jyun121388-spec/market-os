/**
 * Real invocation path for the EDGAR XBRL company-facts adapter (M15) — ingests tracked
 * financial concepts for every company in TRACKED_XBRL_COMPANIES.
 *
 * Usage: EDGAR_USER_AGENT="Market OS you@example.com" DATABASE_URL=... npx tsx scripts/ingest-edgar-xbrl.ts
 */
import { ingestCompanyFacts } from "../src/server/adapters/edgar-xbrl/ingest";
import { TRACKED_XBRL_COMPANIES } from "../src/server/adapters/edgar-xbrl/types";
import { prisma } from "../src/server/db/client";

async function main() {
  for (const company of TRACKED_XBRL_COMPANIES) {
    const result = await ingestCompanyFacts(company);
    console.log(
      `[EDGAR XBRL] ${company.corpName} (CIK ${result.cik}): +${result.inserted} inserted, ` +
        `${result.unchanged} unchanged`,
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
