/**
 * Real invocation path for Filing Diff's numeric-delta half (M16) — prints the change for
 * every tracked XBRL concept for one company, across its two most recent filings.
 * Run scripts/ingest-edgar-xbrl.ts first so there's data to diff.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/print-filing-diff.ts [cik]
 */
import { computeFilingDiff } from "../src/server/domain/filingDiff";
import {
  TRACKED_XBRL_CONCEPTS,
  TRACKED_XBRL_COMPANIES,
} from "../src/server/adapters/edgar-xbrl/types";
import { prisma } from "../src/server/db/client";

async function main() {
  const cik = process.argv[2] ?? TRACKED_XBRL_COMPANIES[0].cik;
  const source = await prisma.source.findUnique({ where: { code: "SEC_EDGAR" } });
  if (!source) {
    console.log("No SEC_EDGAR source found — run `npm run ingest:edgar-xbrl` first.");
    return;
  }

  const diffs = await computeFilingDiff(
    source.id,
    cik,
    TRACKED_XBRL_CONCEPTS.map((concept) => ({ concept, unit: "USD" })),
  );

  for (const diff of diffs) {
    if (diff.status === "COMPUTED") {
      console.log(
        `${diff.concept}: ${diff.previousValue} (${diff.previousAccession}) -> ${diff.currentValue} ` +
          `(${diff.currentAccession}), change ${diff.absoluteChange}` +
          (diff.percentChange !== null ? ` (${diff.percentChange}%)` : ""),
      );
    } else {
      console.log(`${diff.concept}: ${diff.status}`);
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
