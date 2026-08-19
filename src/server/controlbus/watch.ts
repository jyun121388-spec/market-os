/**
 * One poll cycle, with the network injected.
 *
 * `runCycle` takes a `fetchComments` function rather than calling `fetch` itself, which is what
 * makes every case in this file testable: a malformed response, a redelivery, a network failure,
 * a crash between the message write and the cursor advance. None of the tests may reach GitHub,
 * and with the dependency injected none of them can.
 */

import type { RemoteComment } from "../escalation/transport";
import type { AuthMode, PollState, RateSignals } from "./ratelimit";
import { isRateLimited, nextPoll, readSignals } from "./ratelimit";
import type { ControlBusState, InboxEntry } from "./state";
import { ingestComments } from "./state";
import type { StorePaths } from "./store";
import { commitCycle, logLine } from "./store";

/**
 * A fetch returns the payload AND what the server said about the budget.
 *
 * The signals used to be discarded, which is how the watcher spent an hour reporting
 * `read failed: Error` while the answer — `x-ratelimit-remaining: 0` — was sitting in a header of
 * the response it had just thrown away (IR-077).
 */
export interface FetchResult {
  payload: unknown;
  signals: RateSignals;
}

export type FetchComments = (issueNumber: number) => Promise<FetchResult>;

export interface CycleResult {
  state: ControlBusState;
  admitted: InboxEntry[];
  /** What to wait before the next cycle. Derived from the response, never from a wall clock. */
  nextDelayMs: number;
  outcome: "ADMITTED" | "QUIET" | "READ_FAILED" | "MALFORMED_RESPONSE" | "RATE_LIMITED";
  /** Why that interval, and in what mode. Surfaced by the status command. */
  pollState: PollState;
  detail: string;
}

/**
 * Validates a fetched payload into comments, or returns null.
 *
 * GitHub returns an object rather than an array for a rate-limit message, an auth failure, or a
 * missing issue, and every one of those parses as JSON perfectly well. Treating "not an array" as
 * a transport failure rather than as an empty page is the difference between backing off and
 * silently reporting that nothing has been posted.
 */
export function parseCommentsPayload(payload: unknown): RemoteComment[] | null {
  if (!Array.isArray(payload)) return null;
  const comments: RemoteComment[] = [];
  for (const item of payload) {
    if (typeof item !== "object" || item === null) return null;
    const candidate = item as Partial<RemoteComment>;
    if (
      typeof candidate.id !== "number" ||
      typeof candidate.body !== "string" ||
      typeof candidate.created_at !== "string" ||
      typeof candidate.user?.login !== "string"
    ) {
      return null;
    }
    comments.push({
      id: candidate.id,
      body: candidate.body,
      created_at: candidate.created_at,
      user: { login: candidate.user.login },
    });
  }
  return comments;
}

export async function runCycle(input: {
  state: ControlBusState;
  paths: StorePaths;
  fetchComments: FetchComments;
  /** Which budget the caller is spending. Decides whether the target cadence is honest. */
  mode: AuthMode;
  /** Supplied by the caller, so the cycle is deterministic under test. */
  now: string;
}): Promise<CycleResult> {
  const { state, paths, fetchComments, mode, now } = input;
  const nowMs = Date.parse(now);

  let payload: unknown;
  let signals: RateSignals = {};
  try {
    const fetched = await fetchComments(state.issueNumber);
    payload = fetched.payload;
    signals = fetched.signals;
  } catch (error) {
    // A failed read is a fact about the network, never about the issue. The cursor does not move,
    // nothing is marked processed, and the next cycle tries the same range again.
    const failed = { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
    commitCycle(paths, failed, []);
    // The error's NAME, never its message: a fetch error can carry a URL with a token in it.
    // Everything else here is a number the server sent in the clear, and discarding those is what
    // made three identical `read failed: Error` lines the only record of a rate limit.
    const detail =
      `read failed: ${error instanceof Error ? error.name : "unknown error"} ` +
      `(mode ${mode}${signals.status === undefined ? "" : `, HTTP ${signals.status}`})`;
    logLine(paths, `${now} ${detail}`);
    const decision = nextPoll({
      mode,
      signals,
      consecutiveFailures: failed.consecutiveFailures,
      nowMs,
    });
    return {
      state: failed,
      admitted: [],
      nextDelayMs: decision.delayMs,
      outcome: "READ_FAILED",
      pollState: decision.state,
      detail,
    };
  }

  // A rate limit is not a malformed response and not a broken network. It arrives as a 403 with a
  // remaining-count of zero, which is the only thing separating it from an ordinary refusal.
  if (isRateLimited(signals)) {
    const decision = nextPoll({ mode, signals, consecutiveFailures: 0, nowMs });
    const detail =
      `GitHub read rate-limited: HTTP ${signals.status}, remaining ` +
      `${signals.remaining ?? "?"}/${signals.limit ?? "?"}, mode ${mode}, ` +
      `next poll in ${Math.round(decision.delayMs / 1000)}s`;
    // Cursor untouched, nothing marked processed, no failure counted — this is a budget fact.
    commitCycle(paths, state, []);
    logLine(paths, `${now} ${detail}`);
    return {
      state,
      admitted: [],
      nextDelayMs: decision.delayMs,
      outcome: "RATE_LIMITED",
      pollState: decision.state,
      detail,
    };
  }

  const comments = parseCommentsPayload(payload);
  if (comments === null) {
    const failed = { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
    commitCycle(paths, failed, []);
    logLine(paths, `${now} malformed response (mode ${mode}, HTTP ${signals.status ?? "?"})`);
    const decision = nextPoll({
      mode,
      signals,
      consecutiveFailures: failed.consecutiveFailures,
      nowMs,
    });
    return {
      state: failed,
      admitted: [],
      nextDelayMs: decision.delayMs,
      pollState: decision.state,
      outcome: "MALFORMED_RESPONSE",
      detail:
        "The response was not a list of comments. Treated as a transport failure rather than as " +
        "an empty issue, because a rate-limit body parses as JSON perfectly well.",
    };
  }

  const { state: next, admitted, skipped } = ingestComments(state, comments, now);

  // Messages first, cursor second — the ordering is inside `commitCycle`, which is why every
  // caller goes through it.
  commitCycle(paths, next, admitted);

  const detail =
    admitted.length > 0
      ? `admitted ${admitted.map((entry) => entry.protocolId).join(", ")}`
      : `no new decisions (${comments.length} comment(s), ${skipped.length} already seen)`;
  logLine(paths, `${now} ${detail}`);

  const decision = nextPoll({ mode, signals, consecutiveFailures: 0, nowMs });
  return {
    state: next,
    admitted,
    nextDelayMs: decision.delayMs,
    pollState: decision.state,
    outcome: admitted.length > 0 ? "ADMITTED" : "QUIET",
    detail: `${detail} — ${decision.reason}`,
  };
}

/**
 * The unauthenticated public read.
 *
 * A 60-requests-per-hour budget, which cannot sustain the 45-second target and does not pretend to
 * — `nextPoll` derives the real interval from the headers this returns.
 */
export const githubFetchComments: FetchComments = async (issueNumber) => {
  // Paginated, because it was not, and the failure would have been silent and total. GitHub
  // returns issue comments OLDEST first, so a single `per_page=100` request keeps returning the
  // same first hundred forever: once the issue passed a hundred comments every new decision would
  // have been invisible. Found by the adversarial review as IR-050.
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "market-os-control-bus" };
  const all: unknown[] = [];
  let signals: RateSignals = {};

  for (let page = 1; page <= 50; page++) {
    const response = await fetch(
      `https://api.github.com/repos/jyun121388-spec/market-os/issues/${issueNumber}/comments` +
        `?per_page=100&page=${page}`,
      { headers },
    );
    // Captured before any throw, so a rate-limited response still reports WHY.
    signals = readSignals(response.status, response.headers);
    if (!response.ok) {
      if (isRateLimited(signals)) return { payload: null, signals };
      throw new Error(`HTTP ${response.status}`);
    }
    const batch = (await response.json()) as unknown;
    if (!Array.isArray(batch)) return { payload: batch, signals };
    all.push(...batch);
    if (batch.length < 100) return { payload: all, signals };

    // A full page at the ceiling means there is more and we are choosing not to read it — the
    // same silent truncation this loop exists to remove, one boundary further out. Throwing puts
    // it through the READ_FAILED path, where the cursor does not move and it retries.
    if (page === 50) throw new Error("PaginationCeilingReached");
  }
  return { payload: all, signals };
};

/**
 * The authenticated read, through the GitHub CLI.
 *
 * `gh` holds its own credential in the OS keyring and never hands it over, so this uses an
 * authenticated mechanism without the process ever seeing a token. That distinction is the whole
 * reason this adapter is allowed to exist: extracting a credential-helper secret is prohibited,
 * and asking a tool that already has one to make the request is not the same act.
 *
 * A 5000-per-hour budget, which makes the 45-second target honest rather than aspirational.
 */
export function ghFetchComments(run: (args: string[]) => string): FetchComments {
  return async (issueNumber) => {
    // `--paginate` follows Link headers itself, so the ceiling problem does not arise here.
    const raw = run([
      "api",
      "--paginate",
      `repos/jyun121388-spec/market-os/issues/${issueNumber}/comments?per_page=100`,
    ]);
    // `gh` does not surface response headers, so the budget is read separately and cheaply. This
    // is the one place a rate_limit call is justified: it is the only way to see the numbers, and
    // an authenticated budget of 5000 can afford one.
    let signals: RateSignals = {};
    try {
      const core = JSON.parse(run(["api", "rate_limit"])) as {
        resources?: { core?: { limit?: number; remaining?: number; reset?: number } };
      };
      signals = {
        status: 200,
        limit: core.resources?.core?.limit,
        remaining: core.resources?.core?.remaining,
        resetAtSeconds: core.resources?.core?.reset,
      };
    } catch {
      // No signals is not a claim of an unlimited budget; `nextPoll` keeps the target and no more.
      signals = { status: 200 };
    }
    return { payload: JSON.parse(raw) as unknown, signals };
  };
}

/**
 * Which budget we are spending, established rather than assumed.
 *
 * Git remote authentication and GitHub REST authentication are separate capabilities, and this
 * session spent many hours treating the API as unavailable because a probe conflated
 * "gh is logged out" with "gh is not installed" — the `||` branch of a compound command firing on
 * a non-zero exit. Hence a positive check with its own result, rather than an inference.
 */
export function detectAuthMode(probe: () => boolean): AuthMode {
  try {
    return probe() ? "AUTHENTICATED_API" : "UNAUTHENTICATED_PUBLIC_READ";
  } catch {
    return "UNKNOWN";
  }
}
