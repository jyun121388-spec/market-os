import { prisma } from "@/server/db/client";
import { redactSecrets } from "@/server/adapters/redactSecrets";
import type { IngestRunStatus } from "@/generated/prisma/client";

/**
 * Records one real ingestion run (see the `IngestRun` model docstring for why).
 *
 * Called from the `scripts/ingest-*.ts` entry points, which are the real run boundary — not
 * from the adapter ingest functions themselves, so that tests and ad-hoc calls do not litter
 * the table with runs that never happened operationally.
 */

export interface IngestRunOutcome {
  inserted?: number;
  revised?: number;
  unchanged?: number;
  skipped?: number;
  /** The provider's own claimed total for this query, when it reports one. */
  providerTotal?: number | null;
  /** What this run actually retrieved. A gap against providerTotal is the signal. */
  fetched?: number | null;
  requestsMade?: number | null;
  truncated?: boolean;
}

/**
 * Wraps one unit of ingestion, recording the outcome either way.
 *
 * A failure is recorded and re-thrown rather than swallowed: the caller still needs to fail,
 * but a run that died is exactly the run an operator most wants to see afterwards. Only the
 * error MESSAGE is stored — never a stack trace, which would put local filesystem paths (and
 * potentially a connection string) into a table rendered on an authenticated page.
 */
export async function recordIngestRun<T extends IngestRunOutcome>(
  args: { sourceCode: string; target: string },
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();

  try {
    const result = await run();
    await writeRun({
      ...args,
      startedAt,
      status: result.truncated ? "PARTIAL" : "SUCCESS",
      outcome: result,
    });
    return result;
  } catch (err) {
    await writeRun({
      ...args,
      startedAt,
      status: "FAILED",
      outcome: {},
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function writeRun(args: {
  sourceCode: string;
  target: string;
  startedAt: Date;
  status: IngestRunStatus;
  outcome: IngestRunOutcome;
  error?: string;
}): Promise<void> {
  // The source row is created by the ingest itself; if the run failed before reaching that
  // point there is nothing to attach to, and losing the audit row is preferable to masking the
  // real error with a foreign-key failure.
  const source = await prisma.source.findUnique({ where: { code: args.sourceCode } });
  if (!source) return;

  const { outcome } = args;
  await prisma.ingestRun.create({
    data: {
      sourceId: source.id,
      target: args.target,
      startedAt: args.startedAt,
      finishedAt: new Date(),
      status: args.status,
      inserted: outcome.inserted ?? 0,
      revised: outcome.revised ?? 0,
      unchanged: outcome.unchanged ?? 0,
      skipped: outcome.skipped ?? 0,
      providerTotal: outcome.providerTotal ?? null,
      fetched: outcome.fetched ?? null,
      requestsMade: outcome.requestsMade ?? null,
      truncated: outcome.truncated ?? false,
      // Defence in depth: HttpTimeoutError already redacts, but any error from any layer can
      // end up here, and this row is both persisted and rendered on an authenticated page.
      error: args.error ? redactSecrets(args.error).slice(0, 500) : null,
    },
  });
}
