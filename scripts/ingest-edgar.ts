/**
 * Real invocation path for the SEC EDGAR adapter (M06) — ingests filings for every company
 * in TRACKED_EDGAR_COMPANIES.
 *
 * Usage: EDGAR_USER_AGENT="Market OS you@example.com" DATABASE_URL=... npx tsx scripts/ingest-edgar.ts
 */
import { ingestEdgarFilings } from "../src/server/adapters/edgar/ingest";
import { TRACKED_EDGAR_COMPANIES, padCik } from "../src/server/adapters/edgar/types";
import { recordIngestRun } from "../src/server/domain/ingestRun";
import { prisma } from "../src/server/db/client";

async function main() {
  for (const company of TRACKED_EDGAR_COMPANIES) {
    const result = await recordIngestRun(
      // Canonical padded CIK, matching `Filing.corpCode`. Recording the unpadded tracked
      // constant here would repeat the identity mismatch that left 2240 filings and 933 facts
      // with zero joinable rows — and it would silently break any consumer trying to ask
      // "was this company's data complete?".
      { sourceCode: "SEC_EDGAR", target: padCik(company.cik) },
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
