import { prisma } from "@/server/db/client";
import { sanitiseErrorForStorage } from "@/server/adapters/redactSecrets";
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
 *
 * ## Partial progress
 *
 * The run function receives a mutable `progress` object it may update as it goes. On failure the
 * wrapper records whatever is in it.
 *
 * That exists because rows are written one at a time and are NOT rolled back, while the failure
 * path used to record `{}` — every count zero. An exception after fifty successful inserts left
 * fifty real rows behind an audit row saying `inserted: 0`, and an operator reading /admin would
 * reasonably conclude the database was untouched (independent review, `gpt-5.6-terra`).
 *
 * Deliberately NOT a transaction. Wrapping a 2240-row EDGAR ingest in one would discard two
 * thousand good rows because the last failed, and risks long-transaction timeouts against a
 * provider-paced loop. The defect was a lying audit, not a lying database, so the audit is what
 * changed. Ingest behaviour is untouched.
 *
 * The parameter is optional in practice: every existing caller is a zero-argument arrow and none
 * needed editing.
 */
export async function recordIngestRun<T extends IngestRunOutcome>(
  args: {
    sourceCode: string;
    target: string;
    /**
     * Whether this run re-fetches the target's ENTIRE history or only appends to it.
     *
     * Omitted means UNKNOWN, deliberately. A caller that has not thought about it must not have
     * FULL assumed on its behalf: FULL is what lets a later success clear an earlier truncation,
     * so guessing it would silently declare gaps repaired that nobody re-fetched.
     */
    mode?: "FULL" | "INCREMENTAL";
  },
  run: (progress: IngestRunOutcome) => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  const progress: IngestRunOutcome = {};

  try {
    const result = await run(progress);
    await writeRun({
      ...args,
      startedAt,
      status: result.truncated ? "PARTIAL" : "SUCCESS",
      // The returned value wins over `progress`: it is the run's authoritative final account,
      // and progress exists only for the path that never gets to return one.
      outcome: result,
    });
    return result;
  } catch (err) {
    await writeRun({
      ...args,
      startedAt,
      status: "FAILED",
      outcome: progress,
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
  mode?: "FULL" | "INCREMENTAL";
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
      mode: args.mode ?? "UNKNOWN",
      inserted: outcome.inserted ?? 0,
      revised: outcome.revised ?? 0,
      unchanged: outcome.unchanged ?? 0,
      skipped: outcome.skipped ?? 0,
      providerTotal: outcome.providerTotal ?? null,
      fetched: outcome.fetched ?? null,
      requestsMade: outcome.requestsMade ?? null,
      truncated: outcome.truncated ?? false,
      // Defence in depth. HttpTimeoutError already redacts, but any layer can produce the error
      // that lands here, and this row is both persisted and rendered on an authenticated page.
      // Sanitising also strips Prisma's code frame — absolute paths and application source —
      // which carries no diagnostic value once the actual failure line is kept.
      error: args.error ? sanitiseErrorForStorage(args.error).slice(0, 500) : null,
    },
  });
}
