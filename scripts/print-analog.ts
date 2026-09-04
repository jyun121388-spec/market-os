/**
 * Real invocation path for the Historical Analog Engine (M14) — prints analogs for a given
 * series id. Requires the series to already have observations ingested.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/print-analog.ts <seriesId> [windowSize]
 */
import { computeHistoricalAnalog } from "../src/server/domain/historicalAnalog";
import { prisma } from "../src/server/db/client";

async function main() {
  const [seriesId, windowSizeArg] = process.argv.slice(2);
  if (!seriesId) {
    console.error("Usage: npx tsx scripts/print-analog.ts <seriesId> [windowSize]");
    process.exitCode = 1;
    return;
  }

  const result = await computeHistoricalAnalog(seriesId, {
    windowSize: windowSizeArg ? Number(windowSizeArg) : undefined,
  });

  console.log(`Status: ${result.status}, sample size: ${result.sampleSize}`);
  if (result.status === "COMPUTED") {
    console.log(
      `Current trailing change (${result.windowSize}-window): ${result.currentTrailingChange}`,
    );
    for (const match of result.matches) {
      console.log(
        `  ${match.asOfDate}: trailing change ${match.historicalTrailingChange} ` +
          `(similarity ${match.similarityScore}) -> next1 ${match.subsequentChange1}, ` +
          `next3 ${match.subsequentChange3}, next6 ${match.subsequentChange6}`,
      );
    }
  }
  console.log(`\nLimitations: ${result.limitations}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
