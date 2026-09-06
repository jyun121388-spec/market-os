/**
 * Ingests one FRED series' full VINTAGE history rather than its current values.
 *
 * The follow-up `CAP-FOLLOWUP-FRED` names (IR-130). FRED's default response gives one row per date
 * stamped with the query date; the documented realtime range gives one row per (date, vintage)
 * with the interval in which that value was current. HG-002 measured both. This asks for the
 * second and stores each vintage's own `realtime_start` as the row's `releaseDate` — the column
 * `Observation` has carried since M08 and that nothing could write to until now.
 *
 * Scoped to ONE series per run, on purpose. A vintage history is much larger than a value history
 * and the point of this script is to make the shape observable, not to backfill everything.
 *
 * Usage: FRED_API_KEY=... DATABASE_URL=... npx tsx scripts/ingest-fred-vintages.ts CPIAUCSL [from]
 */
import { ingestFredSeries } from "../src/server/adapters/fred/ingest";
import { sanitiseErrorForStorage } from "../src/server/adapters/redactSecrets";
import { TRACKED_FRED_SERIES } from "../src/server/adapters/fred/types";
import { recordIngestRun } from "../src/server/domain/ingestRun";
import { prisma } from "../src/server/db/client";

async function main() {
  const seriesId = process.argv[2];
  const from = process.argv[3];
  const def = TRACKED_FRED_SERIES.find((s) => s.seriesId === seriesId);
  if (!def) {
    console.error(
      `Unknown or untracked series "${seriesId ?? ""}". One of: ` +
        TRACKED_FRED_SERIES.map((s) => s.seriesId).join(", "),
    );
    process.exitCode = 1;
    return;
  }

  // PRECONDITION, learned by running this once and measuring the result.
  //
  // The first run against CPIAUCSL did exactly what it was asked and left the chain WRONG. That
  // series already held the current value from an ordinary ingest, stored as the chain ORIGINAL.
  // Appending the vintage history to it put three older vintages in AFTER the newest one, and the
  // chain tail is decided by arrival order, so the read path began serving 300.456 (the 2025-02-12
  // vintage) where the true current value is 300.420. A superseded figure presented as current is
  // IR-021 exactly, reached from a new direction.
  //
  // Storing the vintages is correct and is what this unit is for. Ordering a chain by the
  // provider's vintage instead of by arrival is a change to V1 revision semantics and is a
  // separate decision. Until that decision exists, this refuses to append history to a chain that
  // already contains present-tense rows, because the result is a chain nobody can read correctly.
  const existing = await prisma.observation.count({
    where: {
      series: { externalId: def.seriesId, source: { code: "FRED" } },
      releaseDate: null,
    },
  });
  if (existing > 0 && process.argv[4] !== "--i-have-read-IR-130") {
    console.error(
      `Refusing: ${def.seriesId} already holds ${existing} observation(s) with no provider ` +
        "release date — rows from an ordinary ingest. Appending a vintage history to those chains " +
        "puts older vintages after the current value, and the chain tail is chosen by arrival " +
        "order, so the read path would serve a superseded figure.\n\n" +
        "This is safe only on a series with no present-tense rows, or once chain ordering by " +
        "provider vintage has been decided (docs/REVIEW_DEBT.md, IR-130).",
    );
    process.exitCode = 1;
    return;
  }

  const result = await recordIngestRun(
    // Not FULL: a vintage run fetches a different shape from the same series, and recording it as
    // FULL would make the run history claim two incomparable things under one name.
    { sourceCode: "FRED", target: `${def.seriesId}#vintages`, mode: "INCREMENTAL" },
    async () => {
      const r = await ingestFredSeries(def, {
        allVintages: true,
        ...(from ? { observationStart: from } : {}),
      });
      return {
        ...r,
        skipped: r.skippedMissing,
        providerTotal: r.count,
        fetched: r.inserted + r.revised + r.unchanged + r.skippedMissing,
      };
    },
  );

  console.log(
    `[FRED vintages] ${result.seriesId}${from ? ` from ${from}` : ""}: ` +
      `+${result.inserted} inserted, ${result.revised} revised, ${result.unchanged} unchanged, ` +
      `${result.skippedMissing} missing skipped` +
      `${result.truncated ? " (TRUNCATED — incomplete)" : ""}`,
  );
  console.log(
    "Rows the guard refused are counted by the ingest as neither revised nor unchanged: a value " +
      "that reappears in a chain is still refused, because ordering on the provider's vintage is " +
      "a separate decision. See docs/REVIEW_DEBT.md, IR-130.",
  );
}

main()
  .catch((err) => {
    console.error(sanitiseErrorForStorage(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
