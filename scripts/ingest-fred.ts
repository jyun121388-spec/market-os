/**
 * Real invocation path for the FRED adapter (M03) — ingests every series in
 * TRACKED_FRED_SERIES. Run manually for now; M25 wires this behind a scheduler.
 *
 * Usage: FRED_API_KEY=... DATABASE_URL=... npx tsx scripts/ingest-fred.ts
 */
import { ingestFredSeries } from "../src/server/adapters/fred/ingest";
import { sanitiseErrorForStorage } from "../src/server/adapters/redactSecrets";
import { TRACKED_FRED_SERIES } from "../src/server/adapters/fred/types";
import { recordIngestRun } from "../src/server/domain/ingestRun";
import { prisma } from "../src/server/db/client";

async function main() {
  for (const series of TRACKED_FRED_SERIES) {
    const result = await recordIngestRun(
      // FULL, and now said rather than assumed: `fetchAllFredObservations` is called with no
      // observation range, so every run re-fetches the series' entire history. Measured on
      // 2026-09-06 -- CPIAUCSL came back from 1947-01-01 with providerCount 955 = 954 stored + 1
      // missing marker. Before this line the run was recorded as UNKNOWN, which is the honest
      // default for a caller that has not looked; this caller has.
      { sourceCode: "FRED", target: series.seriesId, mode: "FULL" },
      async () => {
        const r = await ingestFredSeries(series);
        return {
          ...r,
          skipped: r.skippedMissing,
          providerTotal: r.count,
          fetched: r.inserted + r.revised + r.unchanged + r.skippedMissing,
        };
      },
    );
    console.log(
      `[FRED] ${result.seriesId}: +${result.inserted} inserted, ${result.revised} revised, ` +
        `${result.unchanged} unchanged, ${result.skippedMissing} missing skipped` +
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
