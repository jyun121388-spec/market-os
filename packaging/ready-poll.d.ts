/** Types for `ready-poll.mjs`, which ships verbatim and so cannot be TypeScript. */

export type ReadyPollVerdict = "READY" | "RETRY" | "TIMED_OUT" | "NOT_MARKET_OS";

export interface ReadyAttempt {
  /** Whether the HTTP request completed at all. `false` for a refused connection. */
  reached: boolean;
  status?: number;
  body?: string;
  elapsedMs: number;
  budgetMs: number;
}

export declare const READY_POLL_VERDICTS: readonly ReadyPollVerdict[];

export declare function classifyReadyAttempt(attempt: ReadyAttempt): ReadyPollVerdict;

export declare function parseReadinessDocument(
  body: string | undefined,
): "READY" | "NOT_READY" | null;
