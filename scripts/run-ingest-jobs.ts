/**
 * M25 job runner — sequences the existing `ingest:*` npm scripts with structured logging.
 *
 * This is deliberately a plain sequential runner invoked manually (or by a future scheduler),
 * not a cron/queue service — deploying an unattended scheduler is a production-deployment
 * decision, which is a Human Gate (see docs/DECISIONS.md M25 entry). Each job runs as its own
 * subprocess (its own `tsx` invocation) so that one job's failure or missing API key can't crash
 * or leave a shared Prisma client in a bad state for the next job.
 *
 * Usage: DATABASE_URL=... [FRED_API_KEY=... ECOS_API_KEY=... DART_API_KEY=... EDGAR_USER_AGENT=...] \
 *          npx tsx scripts/run-ingest-jobs.ts
 */
import { spawnSync } from "node:child_process";

const JOBS = ["ingest:fred", "ingest:ecos", "ingest:dart", "ingest:edgar", "ingest:edgar-xbrl"];

interface JobResult {
  job: string;
  ok: boolean;
  durationMs: number;
}

function runJob(job: string): JobResult {
  const startedAt = Date.now();
  console.log(`[jobs] starting ${job}`);
  const result = spawnSync("npm", ["run", job], { stdio: "inherit" });
  const durationMs = Date.now() - startedAt;
  const ok = result.status === 0;
  console.log(`[jobs] ${ok ? "OK" : "FAILED"} ${job} (${durationMs}ms)`);
  return { job, ok, durationMs };
}

function main() {
  const results = JOBS.map(runJob);

  console.log("\n[jobs] summary:");
  for (const r of results) {
    console.log(`  ${r.ok ? "OK    " : "FAILED"} ${r.job} (${r.durationMs}ms)`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n[jobs] ${failed.length}/${results.length} job(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\n[jobs] all ${results.length} job(s) succeeded`);
  }
}

main();
