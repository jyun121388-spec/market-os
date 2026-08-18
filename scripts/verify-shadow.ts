/**
 * Runs Verify in SHADOW MODE over the real v1 output in whatever database DATABASE_URL points at.
 *
 * Read-only: the run performs no writes and nothing in v1 imports the verifier. Safe against
 * `market_os_dev`, which is the point — the verdicts only mean something against real ingested
 * SEC data.
 *
 *   npm run verify:shadow
 */
import {
  companiesWithFilings,
  shadowVerifyCompany,
  shadowVerifyAskMarket,
  shadowVerifySeriesChanges,
  VERIFIER_VERSION,
} from "@/server/verify/shadowRun";
import { prisma } from "@/server/db/client";

async function main() {
  const companies = await companiesWithFilings();
  console.log(`Verify shadow run — ${VERIFIER_VERSION} — ${companies.length} company dataset(s)\n`);

  const totals: Record<string, number> = {};
  let observed = 0;

  for (const corpCode of companies) {
    const { observations, byVerdict } = await shadowVerifyCompany(corpCode);
    if (observations.length === 0) continue;
    observed += observations.length;

    console.log(`${corpCode} — ${observations.length} verifiable output(s)`);
    for (const o of observations) {
      const cause = o.failed.length > 0 ? `  failed: ${o.failed.join(", ")}` : "";
      console.log(`  ${o.verdict.padEnd(30)} ${o.outputId}${cause}`);
      for (const [dimension, gap] of Object.entries(o.evidenceGaps)) {
        console.log(`      gap: ${dimension} -> ${gap}`);
      }
      if (o.error) console.log(`      error: ${o.error}`);
    }
    for (const [verdict, count] of Object.entries(byVerdict)) {
      totals[verdict] = (totals[verdict] ?? 0) + count;
    }
    console.log("");
  }

  // The Ask Market path, the only one whose output could read as advice.
  const ask = await shadowVerifyAskMarket();
  if (ask.observations.length > 0) {
    observed += ask.observations.length;
    console.log(`Ask Market — ${ask.observations.length} verifiable answer(s)`);
    for (const o of ask.observations) {
      const cause = o.failed.length > 0 ? `  failed: ${o.failed.join(", ")}` : "";
      console.log(`  ${o.verdict.padEnd(30)} ${o.outputId}${cause}`);
      console.log(`      advice: ${o.dimensions.adversarial_resilience}`);
      if (o.error) console.log(`      error: ${o.error}`);
    }
    for (const [verdict, count] of Object.entries(ask.byVerdict)) {
      totals[verdict] = (totals[verdict] ?? 0) + count;
    }
    console.log("");
  }

  // The macro path, where the version question is open rather than settled by a filing identity.
  const macro = await shadowVerifySeriesChanges();
  if (macro.observations.length > 0) {
    observed += macro.observations.length;
    console.log(`Series changes — ${macro.observations.length} verifiable output(s)`);
    for (const o of macro.observations) {
      const cause = o.failed.length > 0 ? `  failed: ${o.failed.join(", ")}` : "";
      console.log(`  ${o.verdict.padEnd(30)} ${o.outputId}${cause}`);
      for (const [dimension, gap] of Object.entries(o.evidenceGaps)) {
        console.log(`      gap: ${dimension} -> ${gap}`);
      }
      if (o.error) console.log(`      error: ${o.error}`);
    }
    for (const [verdict, count] of Object.entries(macro.byVerdict)) {
      totals[verdict] = (totals[verdict] ?? 0) + count;
    }
    console.log("");
  }

  if (observed === 0) {
    console.log("No verifiable output at all — no Filing Diff and no series with two readings.");
    return;
  }

  console.log("VERDICT TOTALS");
  for (const [verdict, count] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(30)} ${count}`);
  }
  console.log(
    "\nShadow mode: nothing above changed a rendered page, and no v1 module imports the verifier.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
