/**
 * Real invocation path for the Macro Regime Engine (M11) — prints the current snapshot across
 * every axis. Purely reads already-ingested Observations; run the ingest:fred/ingest:ecos
 * scripts first for anything beyond NOT_TRACKED/INSUFFICIENT_DATA readings.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/print-regime.ts
 */
import { computeRegimeSnapshot } from "../src/server/domain/macroRegime";
import { prisma } from "../src/server/db/client";

async function main() {
  const snapshot = await computeRegimeSnapshot();
  for (const axis of snapshot.axes) {
    console.log(`\n[${axis.axis}] ${axis.status}`);
    for (const reading of axis.readings) {
      if (reading.status === "COMPUTED") {
        console.log(
          `  ${reading.seriesName} (${reading.sourceCode}:${reading.externalId}): ` +
            `${reading.value} as of ${reading.asOfDate}, change ${reading.change?.absoluteChange} ` +
            `(${reading.direction})`,
        );
      } else {
        console.log(`  ${reading.sourceCode}:${reading.externalId}: ${reading.status}`);
      }
    }
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
