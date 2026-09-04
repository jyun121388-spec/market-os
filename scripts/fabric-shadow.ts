/**
 * Runs the Reality Fabric read-only shadow projection against whatever database DATABASE_URL
 * points at, and prints the disagreements between the freshness/completeness implementations that
 * already exist in v1.
 *
 * Read-only by construction — the projection performs no writes. Safe against `market_os_dev`,
 * which is the point: the disagreements only appear against real ingested data.
 *
 *   npm run fabric:shadow
 */
import { computeFabricProjection } from "@/server/fabric/shadowProjection";
import { prisma } from "@/server/db/client";

async function main() {
  const projection = await computeFabricProjection();

  console.log(`Reality Fabric shadow projection — ${projection.generatedAt}`);
  console.log(
    `${projection.series.length} series, ${projection.companies.length} company dataset(s)\n`,
  );

  if (projection.series.length > 0) {
    console.log("SERIES");
    for (const s of projection.series) {
      console.log(
        `  ${s.datasetKey.padEnd(28)} ${s.stalenessVerdict.padEnd(7)} ` +
          `cadence=${s.calendarStatus === "PROJECTED" ? `${s.medianIntervalDays}d` : "unknown"} ` +
          `obs=${s.observationCount} ` +
          `lastObserved=${s.temporal.observedAt ?? "-"} ` +
          `lastRetrieved=${s.daysSinceLastRetrieval ?? "-"}d ago`,
      );
    }
    console.log("");
  }

  if (projection.companies.length > 0) {
    console.log("COMPANIES");
    for (const c of projection.companies) {
      console.log(
        `  ${c.datasetKey.padEnd(28)} ${c.completenessStatus.padEnd(17)} ` +
          `runs=${c.totalRuns} everTruncated=${c.everTruncated} ` +
          `filings=${c.filingCount} facts=${c.factCount}`,
      );
    }
    console.log("");
  }

  if (projection.disagreements.length === 0) {
    console.log("No disagreements between the existing implementations.");
    return;
  }

  console.log(`DISAGREEMENTS (${projection.disagreements.length}) — each is a defect HYPOTHESIS,`);
  console.log(
    "not a confirmed defect. Determine intended semantics before changing any v1 code.\n",
  );
  for (const d of projection.disagreements) {
    console.log(`  [${d.kind}] ${d.datasetKey}`);
    for (const [who, said] of Object.entries(d.answers)) {
      console.log(`      ${who}: ${said}`);
    }
    console.log(`      -> ${d.note}\n`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
