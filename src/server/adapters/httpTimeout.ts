/**
 * P1 hardening (see docs/DECISIONS.md): every external data-source adapter (FRED/ECOS/DART/
 * EDGAR) called plain `fetch()` with no timeout. A stalled upstream connection would hang the
 * calling ingest job (and any subprocess wrapping it, e.g. `npm run jobs:ingest-all`)
 * indefinitely instead of failing fast and letting the caller retry/alert. `fetchWithTimeout`
 * is a drop-in `fetch` replacement that aborts and throws a distinguishable error after
 * `timeoutMs`.
 */
import { redactSecrets } from "./redactSecrets";

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    // The URL carries provider credentials — ECOS in a path segment, FRED and DART in a query
    // parameter — and this message is logged, persisted to `ingest_runs.error`, and rendered on
    // /admin. Redact before it leaves this constructor rather than at each consumer.
    super(`Request to ${redactSecrets(url)} timed out after ${timeoutMs}ms`);
  }
}

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new HttpTimeoutError(url, timeoutMs);
    }
    throw err;
  }
}
