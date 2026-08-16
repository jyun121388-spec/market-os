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

// P1 hardening (docs/DECISIONS.md): each job is its own subprocess specifically so one job
// hanging can't take the others down with it — but spawnSync with no timeout defeats that: a
// stuck subprocess (network stall, a hung child process, etc.) would block this runner, and
// everything after it, forever. SIGTERM first for a clean shutdown; spawnSync's own
// `killSignal` fallback to SIGKILL only kicks in if the child ignores that.
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

// On Windows the npm entry point is `npm.cmd`; `spawnSync("npm", ...)` without a shell fails
// with ENOENT there. That failure is especially nasty here because it does not throw — it comes
// back as `status: null`, which this runner reports as a normal FAILED job, so every job would
// look like it ran and failed rather than never having started.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

interface JobResult {
  job: string;
  ok: boolean;
  durationMs: number;
  timedOut: boolean;
}

function runJob(job: string): JobResult {
  const startedAt = Date.now();
  console.log(`[jobs] starting ${job}`);
  const result = spawnSync(NPM, ["run", job], {
    stdio: "inherit",
    timeout: JOB_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
  const durationMs = Date.now() - startedAt;
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const ok = result.status === 0 && !timedOut;
  if (timedOut) {
    console.log(`[jobs] TIMED OUT ${job} after ${JOB_TIMEOUT_MS}ms — killed`);
  }
  console.log(`[jobs] ${ok ? "OK" : "FAILED"} ${job} (${durationMs}ms)`);
  return { job, ok, durationMs, timedOut };
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
