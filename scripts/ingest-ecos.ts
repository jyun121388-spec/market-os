/**
 * Real invocation path for the ECOS adapter (M04) — ingests every series in
 * TRACKED_ECOS_SERIES over the given date range.
 *
 * Usage: ECOS_API_KEY=... DATABASE_URL=... npx tsx scripts/ingest-ecos.ts [startYYYYMM] [endYYYYMM]
 */
import { ingestEcosSeries } from "../src/server/adapters/ecos/ingest";
import { sanitiseErrorForStorage } from "../src/server/adapters/redactSecrets";
import { TRACKED_ECOS_SERIES } from "../src/server/adapters/ecos/types";
import { recordIngestRun } from "../src/server/domain/ingestRun";
import { prisma } from "../src/server/db/client";

async function main() {
  const [start, end] = process.argv.slice(2);
  const range = { start: start ?? "202401", end: end ?? "202612" };

  for (const series of TRACKED_ECOS_SERIES) {
    const result = await recordIngestRun(
      { sourceCode: "ECOS", target: `${series.statCode}:${series.itemCode1}` },
      async () => {
        const r = await ingestEcosSeries(series, range);
        return {
          ...r,
          skipped: r.skippedMissing,
          providerTotal: r.totalCount,
          fetched: r.inserted + r.revised + r.unchanged + r.skippedMissing,
        };
      },
    );
    console.log(
      `[ECOS] ${result.seriesId}: +${result.inserted} inserted, ${result.revised} revised, ` +
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
