/**
 * Real invocation path for the OpenDART adapter (M05) — ingests disclosures for every
 * company in TRACKED_DART_COMPANIES over the given date range.
 *
 * Usage: DART_API_KEY=... DATABASE_URL=... npx tsx scripts/ingest-dart.ts [beginYYYYMMDD] [endYYYYMMDD]
 */
import { ingestDartFilings } from "../src/server/adapters/dart/ingest";
import { sanitiseErrorForStorage } from "../src/server/adapters/redactSecrets";
import { TRACKED_DART_COMPANIES } from "../src/server/adapters/dart/types";
import { recordIngestRun } from "../src/server/domain/ingestRun";
import { prisma } from "../src/server/db/client";

async function main() {
  const [beginDate, endDate] = process.argv.slice(2);
  const range = { beginDate: beginDate ?? "20260101", endDate: endDate ?? "20261231" };

  for (const company of TRACKED_DART_COMPANIES) {
    const result = await recordIngestRun(
      { sourceCode: "DART", target: company.corpCode },
      async () => {
        const r = await ingestDartFilings(company, range);
        return {
          ...r,
          providerTotal: r.totalCount,
          fetched: r.inserted + r.unchanged,
          requestsMade: r.pagesFetched,
        };
      },
    );
    console.log(
      `[DART] ${company.corpName} (${result.corpCode}): +${result.inserted} inserted, ` +
        `${result.unchanged} unchanged, ${result.pagesFetched} page(s) of ${result.totalCount}` +
        `${result.truncated ? " (TRUNCATED — incomplete)" : ""}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(sanitiseErrorForStorage(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
