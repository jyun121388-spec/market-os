/**
 * One poll cycle, with the network injected.
 *
 * `runCycle` takes a `fetchComments` function rather than calling `fetch` itself, which is what
 * makes every case in this file testable: a malformed response, a redelivery, a network failure,
 * a crash between the message write and the cursor advance. None of the tests may reach GitHub,
 * and with the dependency injected none of them can.
 */

import type { RemoteComment } from "../escalation/transport";
import type { ControlBusState, InboxEntry } from "./state";
import { ingestComments, pollDelayMs } from "./state";
import type { StorePaths } from "./store";
import { commitCycle, logLine } from "./store";

export type FetchComments = (issueNumber: number) => Promise<unknown>;

export interface CycleResult {
  state: ControlBusState;
  admitted: InboxEntry[];
  /** What to wait before the next cycle. Derived from the state, never from a wall clock. */
  nextDelayMs: number;
  outcome: "ADMITTED" | "QUIET" | "READ_FAILED" | "MALFORMED_RESPONSE";
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
  /** Supplied by the caller, so the cycle is deterministic under test. */
  now: string;
}): Promise<CycleResult> {
  const { state, paths, fetchComments, now } = input;

  let payload: unknown;
  try {
    payload = await fetchComments(state.issueNumber);
  } catch (error) {
    // A failed read is a fact about the network, never about the issue. The cursor does not move,
    // nothing is marked processed, and the next cycle tries the same range again.
    const failed = { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
    commitCycle(paths, failed, []);
    const detail = `read failed: ${error instanceof Error ? error.name : "unknown error"}`;
    logLine(paths, `${now} ${detail}`);
    return {
      state: failed,
      admitted: [],
      nextDelayMs: pollDelayMs(failed.consecutiveFailures),
      outcome: "READ_FAILED",
      // The error's NAME, never its message. A fetch error can carry a URL with a token in it.
      detail,
    };
  }

  const comments = parseCommentsPayload(payload);
  if (comments === null) {
    const failed = { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
    commitCycle(paths, failed, []);
    logLine(paths, `${now} malformed response`);
    return {
      state: failed,
      admitted: [],
      nextDelayMs: pollDelayMs(failed.consecutiveFailures),
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

  return {
    state: next,
    admitted,
    nextDelayMs: pollDelayMs(0),
    outcome: admitted.length > 0 ? "ADMITTED" : "QUIET",
    detail,
  };
}

/** The unauthenticated read. Public repository, so no credential is involved and none is sought. */
export const githubFetchComments: FetchComments = async (issueNumber) => {
  const response = await fetch(
    `https://api.github.com/repos/jyun121388-spec/market-os/issues/${issueNumber}/comments?per_page=100`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "market-os-control-bus" } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
