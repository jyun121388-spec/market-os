/**
 * Real invocation path for the ECOS adapter (M04) — ingests every series in
 * TRACKED_ECOS_SERIES over the given date range.
 *
 * Usage: ECOS_API_KEY=... DATABASE_URL=... npx tsx scripts/ingest-ecos.ts [startYYYYMM] [endYYYYMM]
 */
import { ingestEcosSeries } from "../src/server/adapters/ecos/ingest";
import { TRACKED_ECOS_SERIES } from "../src/server/adapters/ecos/types";
import { prisma } from "../src/server/db/client";

async function main() {
  const [start, end] = process.argv.slice(2);
  const range = { start: start ?? "202401", end: end ?? "202612" };

  for (const series of TRACKED_ECOS_SERIES) {
    const result = await ingestEcosSeries(series, range);
    console.log(
      `[ECOS] ${result.seriesId}: +${result.inserted} inserted, ${result.revised} revised, ` +
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
