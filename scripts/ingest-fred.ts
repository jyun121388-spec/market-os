/**
 * Real invocation path for the FRED adapter (M03) — ingests every series in
 * TRACKED_FRED_SERIES. Run manually for now; M25 wires this behind a scheduler.
 *
 * Usage: FRED_API_KEY=... DATABASE_URL=... npx tsx scripts/ingest-fred.ts
 */
import { ingestFredSeries } from "../src/server/adapters/fred/ingest";
import { TRACKED_FRED_SERIES } from "../src/server/adapters/fred/types";
import { prisma } from "../src/server/db/client";

async function main() {
  for (const series of TRACKED_FRED_SERIES) {
    const result = await ingestFredSeries(series);
    console.log(
      `[FRED] ${result.seriesId}: +${result.inserted} inserted, ${result.revised} revised, ` +
        `${result.unchanged} unchanged, ${result.skippedMissing} missing skipped`,
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
