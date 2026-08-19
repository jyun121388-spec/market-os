import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "@/server/controlbus/state";
import { storePaths } from "@/server/controlbus/store";
import { runCycle } from "@/server/controlbus/watch";
import type { AuthMode } from "@/server/controlbus/ratelimit";
import {
  TARGET_INTERVAL_MS,
  isRateLimited,
  nextPoll,
  readSignals,
  sustainableIntervalMs,
} from "@/server/controlbus/ratelimit";

/**
 * IR-077, as arithmetic.
 *
 * The watcher polled every 45 seconds against an endpoint allowing 60 requests an hour. 45 seconds
 * is 80 an hour. The cadence had been recorded as an invariant in `CLAUDE.md` since the day it was
 * written and was never achievable.
 *
 * It hid because nothing broke: the watcher stayed alive, heartbeated, logged one failure a cycle,
 * and the bounded backoff rescued it by accident at 7.5 requests an hour. The channel worked at
 * eight-minute latency while every document claimed forty-five seconds.
 *
 * These tests are mostly about refusing to claim a cadence the budget cannot pay for. The two modes
 * are separated because that is the whole finding — the same target is honest in one and a fiction
 * in the other.
 */

const HOUR = 3_600_000;
const now = 1_700_000_000_000;
const resetIn = (ms: number) => Math.floor((now + ms) / 1000);

const decide = (mode: AuthMode, signals: Parameters<typeof nextPoll>[0]["signals"]) =>
  nextPoll({ mode, signals, consecutiveFailures: 0, nowMs: now });

describe("the budget decides the cadence, not the wish", () => {
  it("refuses to promise 45 seconds on a 60-per-hour budget", () => {
    // The finding itself. A fresh unauthenticated budget cannot sustain the target, and saying so
    // is the fix — the previous code asserted 45 seconds and let backoff quietly disagree.
    const decision = decide("UNAUTHENTICATED_PUBLIC_READ", {
      status: 200,
      limit: 60,
      remaining: 59,
      resetAtSeconds: resetIn(HOUR),
    });
    expect(decision.state).toBe("POLLING");
    expect(decision.delayMs).toBeGreaterThan(TARGET_INTERVAL_MS);
    expect(decision.reason).toContain("will not sustain");
  });

  it("keeps the 45-second target on an authenticated budget", () => {
    // 5000 an hour against 80 needed. The target is honest here, which is the point of tracking
    // the mode rather than picking one conservative number for both.
    const decision = decide("AUTHENTICATED_API", {
      status: 200,
      limit: 5000,
      remaining: 4983,
      resetAtSeconds: resetIn(HOUR),
    });
    expect(decision.delayMs).toBe(TARGET_INTERVAL_MS);
    expect(decision.state).toBe("POLLING");
  });

  it("computes an interval the remaining budget can actually pay for", () => {
    // Ten requests left and half an hour to go, minus the reserve: roughly six minutes apart.
    const interval = sustainableIntervalMs(10, resetIn(HOUR / 2), now);
    expect(interval).not.toBeNull();
    expect(Math.round((interval as number) / 1000)).toBe(360);
  });

  it("treats an unknown budget as unknown rather than unlimited", () => {
    // Absent headers are not evidence of a large budget. The target is kept, because an unknown
    // budget is equally not evidence of a small one — inventing either would be a guess.
    expect(sustainableIntervalMs(undefined, resetIn(HOUR), now)).toBeNull();
    expect(decide("UNKNOWN", { status: 200 }).delayMs).toBe(TARGET_INTERVAL_MS);
  });
});

describe("an exhausted budget is not a broken network", () => {
  it("waits for the reset instead of collecting 403s", () => {
    const decision = decide("UNAUTHENTICATED_PUBLIC_READ", {
      status: 403,
      limit: 60,
      remaining: 0,
      resetAtSeconds: resetIn(8 * 60_000),
    });
    expect(decision.state).toBe("RATE_LIMITED_UNAUTHENTICATED");
    expect(decision.delayMs).toBeGreaterThan(7 * 60_000);
    expect(decision.reason).toContain("watcher stays alive");
  });

  it("distinguishes rate limiting from a refusal, which share a status code", () => {
    // GitHub answers an exhausted budget with 403, the same status as "you may not do this". The
    // remaining-count is the only thing that separates them, and conflating the two is what
    // produced three log lines reading `read failed: Error`.
    expect(isRateLimited({ status: 403, remaining: 0 })).toBe(true);
    expect(isRateLimited({ status: 429, remaining: 0 })).toBe(true);
    expect(isRateLimited({ status: 403, remaining: 42 })).toBe(false);
    expect(isRateLimited({ status: 403 })).toBe(false);
    expect(isRateLimited({ status: 200, remaining: 0 })).toBe(false);
  });

  it("reports a headerless failure as degraded, and a rate limit as neither", () => {
    const network = nextPoll({
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      signals: {},
      consecutiveFailures: 3,
      nowMs: now,
    });
    expect(network.state).toBe("NETWORK_DEGRADED");

    const limited = decide("UNAUTHENTICATED_PUBLIC_READ", {
      status: 403,
      remaining: 0,
      resetAtSeconds: resetIn(60_000),
    });
    expect(limited.state).not.toBe("NETWORK_DEGRADED");
  });

  it("backs off geometrically only while there is no HTTP response at all", () => {
    const first = nextPoll({
      mode: "UNKNOWN",
      signals: {},
      consecutiveFailures: 1,
      nowMs: now,
    });
    expect(first.state).toBe("BACKING_OFF");
    expect(first.delayMs).toBe(TARGET_INTERVAL_MS * 2);
    // Bounded, so a slept laptop does not wake into an hour-long wait.
    const many = nextPoll({ mode: "UNKNOWN", signals: {}, consecutiveFailures: 50, nowMs: now });
    expect(many.delayMs).toBeLessThanOrEqual(480_000);
  });
});

describe("what the server explicitly asks for wins", () => {
  it("obeys Retry-After over any calculation", () => {
    const decision = decide("AUTHENTICATED_API", {
      status: 429,
      retryAfterSeconds: 120,
      remaining: 4000,
      resetAtSeconds: resetIn(HOUR),
    });
    expect(decision.delayMs).toBe(120_000);
    expect(decision.reason).toContain("not a suggestion");
  });

  it("never polls faster than X-Poll-Interval asks", () => {
    const decision = decide("AUTHENTICATED_API", {
      status: 200,
      remaining: 4900,
      resetAtSeconds: resetIn(HOUR),
      pollIntervalSeconds: 90,
    });
    expect(decision.delayMs).toBe(90_000);
  });
});

describe("signals come from the response that was already made", () => {
  it("reads the headers GitHub actually sends", () => {
    // Live values from a real poll during the investigation, so the names match reality rather
    // than documentation. Polling /rate_limit to inspect the budget would spend budget to measure
    // budget, which is why these are taken from the useful request.
    const signals = readSignals(
      200,
      new Headers({
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "59",
        "x-ratelimit-reset": "1787185018",
        etag: 'W/"1432402d29f78cdc"',
      }),
    );
    expect(signals).toMatchObject({
      status: 200,
      limit: 60,
      remaining: 59,
      resetAtSeconds: 1787185018,
      etag: 'W/"1432402d29f78cdc"',
    });
    expect(signals.retryAfterSeconds).toBeUndefined();
  });

  it("ignores a header it cannot read as a number", () => {
    const signals = readSignals(200, new Headers({ "x-ratelimit-remaining": "lots" }));
    expect(signals.remaining).toBeUndefined();
  });
});

/**
 * The wiring, not just the arithmetic.
 *
 * A correct interval helper that nothing calls is not a fix, and this project has now found that
 * shape often enough to test for it directly: `runCycle` must actually consult the response
 * headers, actually respect the mode it was given, and actually classify a rate limit as something
 * other than a broken network.
 */
describe("the cycle uses the adaptive scheduler, not a constant", () => {
  let root: string;
  let paths: ReturnType<typeof storePaths>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rl-"));
    paths = storePaths(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const NOW = new Date(now).toISOString();
  const fetchWith =
    (signals: Parameters<typeof nextPoll>[0]["signals"], payload: unknown = []) =>
    () =>
      Promise.resolve({ payload, signals });

  it("classifies an exhausted budget as rate-limited, not as a failed read", () => {
    // The whole of IR-077 in one assertion. Three cycles logged `read failed: Error` for what was
    // a 403 with `remaining: 0` sitting in a header the code threw away.
    return runCycle({
      state: emptyState(2),
      paths,
      fetchComments: fetchWith(
        { status: 403, limit: 60, remaining: 0, resetAtSeconds: resetIn(300_000) },
        null,
      ),
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      now: NOW,
    }).then((result) => {
      expect(result.outcome).toBe("RATE_LIMITED");
      expect(result.pollState).toBe("RATE_LIMITED_UNAUTHENTICATED");
      expect(result.detail).toContain("remaining 0/60");
      // Not a failure: the budget is a fact about us, not about the connection.
      expect(result.state.consecutiveFailures).toBe(0);
      // And the cursor must not move on a response that carried no comments.
      expect(result.state.lastRemoteCommentId).toBeNull();
    });
  });

  it("derives a longer interval unauthenticated than authenticated, on identical headers", () => {
    // The mode is not decoration. Same response, same budget arithmetic, different honest answer.
    const signals = { status: 200, limit: 60, remaining: 40, resetAtSeconds: resetIn(HOUR) };
    return Promise.all([
      runCycle({
        state: emptyState(2),
        paths,
        fetchComments: fetchWith(signals),
        mode: "UNAUTHENTICATED_PUBLIC_READ",
        now: NOW,
      }),
      runCycle({
        state: emptyState(2),
        paths,
        fetchComments: fetchWith(signals),
        mode: "AUTHENTICATED_API",
        now: NOW,
      }),
    ]).then(([unauth, auth]) => {
      expect(auth.nextDelayMs).toBe(TARGET_INTERVAL_MS);
      expect(unauth.nextDelayMs).toBeGreaterThan(auth.nextDelayMs);
    });
  });

  it("records the HTTP status in the log without recording anything secret", () => {
    return runCycle({
      state: emptyState(2),
      paths,
      fetchComments: () => Promise.reject(new Error("https://x?token=ghp_SECRET0123456789abcd")),
      mode: "AUTHENTICATED_API",
      now: NOW,
    }).then((result) => {
      const log = readFileSync(paths.log, "utf8");
      // The error's NAME and the mode are safe; its message can carry a URL with a token in it.
      expect(result.detail).toContain("AUTHENTICATED_API");
      expect(log).not.toContain("ghp_");
      expect(log).not.toContain("token=");
    });
  });
});
