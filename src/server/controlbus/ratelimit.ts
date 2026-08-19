/**
 * How often to poll, decided by what the server actually said.
 *
 * IR-077: the watcher polled every 45 seconds against GitHub's UNAUTHENTICATED endpoint, whose
 * limit is 60 requests an hour. 45 seconds is 80 an hour. The cadence recorded as an invariant in
 * `CLAUDE.md` was arithmetically impossible against the endpoint it targeted, and had been since
 * the day it was written.
 *
 * What made it hard to see is that nothing broke. The watcher stayed alive, heartbeated correctly,
 * logged a failure per cycle, and the bounded backoff then rescued it by ACCIDENT — at the
 * eight-minute ceiling it makes 7.5 requests an hour, comfortably inside the limit. So the channel
 * worked, at eight-minute latency, while every document said forty-five seconds. Textbook
 * SILENT_DEGRADATION: no error, no alarm, and a real capability quietly an order of magnitude worse
 * than advertised.
 *
 * The fix is not to pick a slower number. It is to stop asserting a cadence and start deriving one:
 *
 * - **Authenticated** (5000/hour) — 45 seconds is sustainable with room to spare.
 * - **Unauthenticated** (60/hour) — it is not, and no amount of wanting makes it so. The interval
 *   is computed from the remaining budget and the reset time, and the honest answer is around a
 *   minute even when idle.
 *
 * Every number here comes from headers the useful request already returned. Polling `/rate_limit`
 * to ask about the budget would spend budget to measure budget.
 */

export type AuthMode = "AUTHENTICATED_API" | "UNAUTHENTICATED_PUBLIC_READ" | "UNKNOWN";

/** What the last response told us. Every field optional: a server may omit any of them. */
export interface RateSignals {
  status?: number;
  limit?: number;
  remaining?: number;
  /** Unix seconds, as GitHub sends it. */
  resetAtSeconds?: number;
  retryAfterSeconds?: number;
  /** GitHub asks pollers not to go faster than this, on endpoints that send it. */
  pollIntervalSeconds?: number;
  etag?: string;
}

export type PollState =
  | "POLLING"
  | "RATE_LIMITED_UNAUTHENTICATED"
  | "RATE_LIMITED_AUTHENTICATED"
  | "BACKING_OFF"
  | "NETWORK_DEGRADED";

export interface PollDecision {
  state: PollState;
  delayMs: number;
  /** Why this interval, in words, for the log and the status command. */
  reason: string;
}

export const TARGET_INTERVAL_MS = 45_000;
const MAX_BACKOFF_MS = 480_000;
/** Leave a few requests unspent so a burst of real work is not blocked by routine polling. */
const BUDGET_RESERVE = 5;

/**
 * The interval a budget can actually sustain until it resets.
 *
 * Returns null when there is nothing to compute from, and the caller then keeps the target rather
 * than inventing a number — an unknown budget is not an unlimited one, but it is also not evidence
 * of a small one.
 */
export function sustainableIntervalMs(
  remaining: number | undefined,
  resetAtSeconds: number | undefined,
  nowMs: number,
): number | null {
  if (remaining === undefined || resetAtSeconds === undefined) return null;
  const untilResetMs = resetAtSeconds * 1000 - nowMs;
  if (untilResetMs <= 0) return null;
  const usable = remaining - BUDGET_RESERVE;
  if (usable <= 0) return untilResetMs;
  return Math.ceil(untilResetMs / usable);
}

/**
 * Decides the next interval.
 *
 * Precedence is deliberate and each step is a thing the server told us, ordered by how explicit it
 * was: an instruction (`Retry-After`), then an exhausted budget, then a requested floor
 * (`X-Poll-Interval`), then arithmetic on what is left.
 */
export function nextPoll(input: {
  mode: AuthMode;
  signals: RateSignals;
  consecutiveFailures: number;
  nowMs: number;
}): PollDecision {
  const { mode, signals, consecutiveFailures, nowMs } = input;
  const authenticated = mode === "AUTHENTICATED_API";

  // An explicit instruction outranks anything we would calculate.
  if (signals.retryAfterSeconds !== undefined) {
    return {
      state: authenticated ? "RATE_LIMITED_AUTHENTICATED" : "RATE_LIMITED_UNAUTHENTICATED",
      delayMs: Math.max(signals.retryAfterSeconds * 1000, TARGET_INTERVAL_MS),
      reason: `Retry-After: ${signals.retryAfterSeconds}s. An instruction, not a suggestion.`,
    };
  }

  // Budget exhausted: wait for the reset and a small skew, rather than spending the next hour
  // collecting 403s. This is NOT a network failure and is not reported as one.
  if (signals.remaining === 0 && signals.resetAtSeconds !== undefined) {
    const waitMs = Math.max(signals.resetAtSeconds * 1000 - nowMs + 2_000, TARGET_INTERVAL_MS);
    return {
      state: authenticated ? "RATE_LIMITED_AUTHENTICATED" : "RATE_LIMITED_UNAUTHENTICATED",
      delayMs: waitMs,
      reason:
        `Rate limit exhausted (0/${signals.limit ?? "?"}), waiting for reset. ` +
        "The watcher stays alive and the engineering loop is unaffected.",
    };
  }

  // A genuine transport failure — no headers, no status — backs off geometrically. Distinguished
  // from a rate limit because the responses are different and so are the remedies.
  if (consecutiveFailures > 0 && signals.status === undefined) {
    return {
      state: consecutiveFailures >= 3 ? "NETWORK_DEGRADED" : "BACKING_OFF",
      delayMs: Math.min(TARGET_INTERVAL_MS * 2 ** Math.min(consecutiveFailures, 4), MAX_BACKOFF_MS),
      reason: `${consecutiveFailures} consecutive read failure(s) with no HTTP response.`,
    };
  }

  const floors: number[] = [TARGET_INTERVAL_MS];
  if (signals.pollIntervalSeconds !== undefined) {
    floors.push(signals.pollIntervalSeconds * 1000);
  }

  // Unauthenticated: the budget decides, and 45 seconds is simply not available at 60/hour.
  // Authenticated budgets are large enough that this term almost never binds, which is the whole
  // difference between the two modes and the reason the mode is tracked explicitly.
  const sustainable = sustainableIntervalMs(signals.remaining, signals.resetAtSeconds, nowMs);
  if (sustainable !== null && !authenticated) floors.push(sustainable);

  const delayMs = Math.max(...floors);
  return {
    state: "POLLING",
    delayMs,
    reason:
      delayMs > TARGET_INTERVAL_MS
        ? `${Math.round(delayMs / 1000)}s: the ${mode} budget will not sustain the ${TARGET_INTERVAL_MS / 1000}s target.`
        : `${Math.round(delayMs / 1000)}s target cadence, sustainable in ${mode}.`,
  };
}

/** Pulls the signals out of response headers, ignoring anything absent. */
export function readSignals(status: number, headers: Headers): RateSignals {
  const num = (name: string): number | undefined => {
    const raw = headers.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    status,
    limit: num("x-ratelimit-limit"),
    remaining: num("x-ratelimit-remaining"),
    resetAtSeconds: num("x-ratelimit-reset"),
    retryAfterSeconds: num("retry-after"),
    pollIntervalSeconds: num("x-poll-interval"),
    etag: headers.get("etag") ?? undefined,
  };
}

/**
 * Whether a response is a rate limit rather than a refusal.
 *
 * GitHub answers an exhausted budget with 403, the same status it uses for "you may not do this".
 * The remaining-count is what separates them, and conflating the two produced a log that said
 * `read failed: Error` three times while the real answer was sitting in a header.
 */
export function isRateLimited(signals: RateSignals): boolean {
  return (
    (signals.status === 403 || signals.status === 429) &&
    signals.remaining !== undefined &&
    signals.remaining <= 0
  );
}
