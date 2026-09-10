/**
 * When a launcher may open the browser, and when it must not.
 *
 * `APP_PROCESS_STARTED` is not `MARKET_OS_READY`: the HTTP port accepts connections before the
 * database is reachable and long before the schema exists. `/api/ready` draws that line, and this
 * decides what to do with each answer.
 *
 * The case that earns its own verdict is `NOT_MARKET_OS`. A launcher polls a fixed port on
 * localhost, and something else may already own it — another copy of this app, a dev server, an
 * unrelated program. Retrying until timeout would be wrong; opening a browser at it would be
 * worse, because the user would be looking at a stranger's page believing it is theirs. So a 200
 * whose body is not this application's readiness document is treated as a different program
 * answering, and the launcher stops.
 */

export const READY_POLL_VERDICTS = ["READY", "RETRY", "TIMED_OUT", "NOT_MARKET_OS"];

/**
 * @param {import("./ready-poll.js").ReadyAttempt} attempt
 * @returns {import("./ready-poll.js").ReadyPollVerdict}
 */
export function classifyReadyAttempt(attempt) {
  const { reached, status, body, elapsedMs, budgetMs } = attempt;

  if (reached && status === 200) {
    const document = parseReadinessDocument(body);
    if (document === "READY") return "READY";
    if (document === "NOT_READY") {
      // Our own app, answering 200 with a NOT_READY body. That combination is not something this
      // route produces — it answers 503 when not ready — but treating it as "keep waiting" is the
      // safe reading either way, and it costs nothing.
      return elapsedMs >= budgetMs ? "TIMED_OUT" : "RETRY";
    }
    return "NOT_MARKET_OS";
  }

  // Everything else — connection refused, a 503 from the readiness route, a redirect, a 500 —
  // is a reason to wait. The budget is what ends it, and it is checked AFTER the success cases so
  // that a ready answer arriving exactly at the deadline is honoured rather than discarded.
  return elapsedMs >= budgetMs ? "TIMED_OUT" : "RETRY";
}

/**
 * Whether a response body is this application's readiness document, and which one.
 *
 * Deliberately strict: the body must parse, must be an object, and its `status` must be one of the
 * two tokens `/api/ready` emits. Anything else — HTML, a different JSON shape, a bare string — is
 * a different program, not a malformed answer from ours.
 *
 * @param {string | undefined} body
 * @returns {"READY" | "NOT_READY" | null}
 */
export function parseReadinessDocument(body) {
  if (typeof body !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  if (parsed.status === "READY") return "READY";
  if (parsed.status === "NOT_READY") return "NOT_READY";
  return null;
}
