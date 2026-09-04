import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "@/server/controlbus/state";
import { storePaths } from "@/server/controlbus/store";
import { ghFetchComments, parseGhPages, runCycle } from "@/server/controlbus/watch";
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
    // Absent headers are not evidence of a large budget, and the arithmetic says so by refusing
    // to produce a number.
    expect(sustainableIntervalMs(undefined, resetIn(HOUR), now)).toBeNull();
  });

  it("does not grant the target cadence to a mode that is not known to be authenticated", () => {
    // This assertion used to expect 45s for UNKNOWN, and that was the bug rather than the fix.
    // The target is only affordable on the authenticated budget; UNKNOWN is not authenticated, so
    // failing closed means the unauthenticated floor. A review found the same hole on the
    // UNAUTHENTICATED path with headers missing — absent numbers are not permission.
    expect(decide("UNKNOWN", { status: 200 }).delayMs).toBeGreaterThan(TARGET_INTERVAL_MS);
    expect(decide("UNAUTHENTICATED_PUBLIC_READ", { status: 200 }).delayMs).toBeGreaterThan(
      TARGET_INTERVAL_MS,
    );
    // 60 requests an hour is one a minute exactly, so the floor has to clear a minute.
    expect(decide("UNAUTHENTICATED_PUBLIC_READ", { status: 200 }).delayMs).toBeGreaterThan(60_000);
  });

  it("keeps the target for a mode that IS known to be authenticated, with no headers", () => {
    expect(decide("AUTHENTICATED_API", { status: 200 }).delayMs).toBe(TARGET_INTERVAL_MS);
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

describe("the computed interval never outruns the budget", () => {
  /**
   * E1 as a property rather than a spot check.
   *
   * The question a reviewer raised and I could not answer from one example: can the arithmetic
   * ever return an interval that would spend MORE requests before the reset than remain? Sweeping
   * the space is cheaper than arguing about rounding, and it covers the reserve, the ceiling and
   * the integer division at once.
   */
  it.each([1, 2, 5, 6, 10, 30, 59, 60])("stays within budget with %i remaining", (remaining) => {
    for (const minutes of [1, 5, 17, 45, 60]) {
      const resetMs = minutes * 60_000;
      const decision = nextPoll({
        mode: "UNAUTHENTICATED_PUBLIC_READ",
        signals: { status: 200, limit: 60, remaining, resetAtSeconds: resetIn(resetMs) },
        consecutiveFailures: 0,
        nowMs: now,
      });
      const requestsBeforeReset = Math.floor(resetMs / decision.delayMs);
      expect(
        requestsBeforeReset,
        `${remaining} remaining over ${minutes}min gave ${decision.delayMs}ms, ` +
          `which is ${requestsBeforeReset} requests`,
      ).toBeLessThanOrEqual(remaining);
    }
  });

  it("does not over-poll when the reset timestamp is already in the past", () => {
    // A stale or skewed reset makes the remaining-budget arithmetic meaningless, so it falls back
    // to the target rather than to something computed from a negative interval.
    const decision = nextPoll({
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      signals: { status: 200, limit: 60, remaining: 1, resetAtSeconds: resetIn(-60_000) },
      consecutiveFailures: 0,
      nowMs: now,
    });
    expect(decision.delayMs).toBeGreaterThanOrEqual(TARGET_INTERVAL_MS);
  });

  it("ignores a nonsensical remaining count rather than trusting it", () => {
    // remaining > limit should not produce a faster cadence than the target.
    const decision = nextPoll({
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      signals: { status: 200, limit: 60, remaining: 5000, resetAtSeconds: resetIn(HOUR) },
      consecutiveFailures: 0,
      nowMs: now,
    });
    expect(decision.delayMs).toBeGreaterThanOrEqual(TARGET_INTERVAL_MS);
  });
});

describe("a parse failure keeps the budget it already knows", () => {
  it("does not fall back to geometric backoff when the budget is exhausted", () => {
    // The refuted claim, and the one that mattered most: I had recorded that losing the signals
    // "errs toward waiting longer". It does the opposite. With remaining zero and a reset an hour
    // out, discarding the numbers drops the cycle onto geometric backoff — ninety seconds instead
    // of an hour, polling FASTER than the budget allows in the one case where that costs most.
    const withSignals = nextPoll({
      mode: "AUTHENTICATED_API",
      signals: { status: 200, limit: 5000, remaining: 0, resetAtSeconds: resetIn(HOUR) },
      consecutiveFailures: 1,
      nowMs: now,
    });
    const withoutSignals = nextPoll({
      mode: "AUTHENTICATED_API",
      signals: {},
      consecutiveFailures: 1,
      nowMs: now,
    });
    expect(withSignals.delayMs).toBeGreaterThan(HOUR - 60_000);
    expect(withoutSignals.delayMs).toBeLessThan(withSignals.delayMs);
    // Which is exactly why the adapter must not throw the signals away on a parse failure.
  });
});

describe("what the server explicitly asks for wins", () => {
  it("does not let a short Retry-After undercut the unauthenticated floor", () => {
    // A review found `Retry-After: 1` returning 45 seconds on the unauthenticated path, straight
    // through the floor that exists because 45s is 80 requests an hour against a ceiling of 60.
    // "Wait at least this long" can raise the interval and must never lower it.
    const decision = decide("UNAUTHENTICATED_PUBLIC_READ", { status: 429, retryAfterSeconds: 1 });
    expect(decision.delayMs).toBeGreaterThan(60_000);
  });

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

/**
 * A reviewer claim that was rejected by reproduction, kept as coverage anyway.
 *
 * The claim was that `gh api --paginate` emits consecutive JSON arrays, so one `JSON.parse` throws
 * past the first page. Run against gh 2.97.0 with `per_page=5` over twelve comments, it returned a
 * single merged array of twelve — which is why `--slurp` exists, to opt OUT of merging. The claim
 * was wrong for this version and the code was not changed to satisfy it.
 *
 * The tolerant parse was added regardless, because merging is a property of the TOOL rather than
 * of this code, and the installed version is not the only one that will ever run it. Cheap
 * insurance against a difference nobody would otherwise notice until the issue passed 100 comments.
 */
describe("gh pagination output", () => {
  /**
   * A rejected claim, then a fix for it that was worse than the claim.
   *
   * The review said `--paginate` concatenates arrays. It does not, for gh 2.97.0 — reproduced,
   * rejected. I added concatenation handling anyway as version-tolerance, and the next review
   * found it corrupted data: the merge rewrote `][` into `],[` including inside JSON strings, so
   * a comment body containing those two characters came back altered.
   *
   * Text-surgery on a format with string literals — the same mistake that moved the attestation
   * parser off Markdown, one module over. Deleted rather than defended with a JSON-aware scanner,
   * because it guarded a shape no known version emits and was reachable from comment content.
   */
  it("reads the merged array gh actually produces", () => {
    expect(parseGhPages('[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("does not alter a body containing the old separator pattern", () => {
    // The corruption case, pinned. This is legitimate content and must survive untouched.
    const tricky = JSON.stringify([{ id: 1, body: "see figure ][ below" }]);
    expect(parseGhPages(tricky)).toEqual([{ id: 1, body: "see figure ][ below" }]);
  });

  it("throws loudly on anything it cannot parse, rather than salvaging it", () => {
    // Loud and wrong-shaped beats quiet and altered. `parseGhPages` throws on each of these; the
    // adapter catches it and hands the unparsed body on, so the cycle ends as MALFORMED_RESPONSE
    // with its rate-limit signals intact (IR-080) rather than READ_FAILED. Either way the cursor
    // does not move and nothing is admitted — the difference is whether the budget survives.
    expect(() =>
      parseGhPages(["warning: something", '[{"id":1}]'].join(String.fromCharCode(10))),
    ).toThrow();
    expect(() => parseGhPages('[{"id":1}] [{"id":2}]')).toThrow();
    expect(() => parseGhPages('[{"id":1}')).toThrow();
    expect(() => parseGhPages("")).toThrow();
  });
});

/**
 * The adapter itself, not just the scheduler it feeds.
 *
 * The parse-failure fix was covered only by a `nextPoll` test, which meant reverting the adapter's
 * catch would have left the suite green — the third vacuous test found in this session by asking
 * the same question each time: would this fail if the thing it names were removed? These exercise
 * `ghFetchComments` through `runCycle`, which is where the behaviour actually lives.
 */
describe("the gh adapter keeps its signals when the body will not parse", () => {
  let root: string;
  let paths: ReturnType<typeof storePaths>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "adapter-"));
    paths = storePaths(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A stand-in for the `gh` CLI: comments call gets junk, rate_limit reports an exhausted budget. */
  const ghWithUnparseableComments = (args: string[]): string => {
    if (args.includes("rate_limit")) {
      return JSON.stringify({
        resources: { core: { limit: 5000, remaining: 0, reset: Math.floor(now / 1000) + 3600 } },
      });
    }
    return "warning: something went sideways";
  };

  it("reports MALFORMED_RESPONSE rather than READ_FAILED, and waits for the reset", async () => {
    const result = await runCycle({
      state: emptyState(2),
      paths,
      fetchComments: ghFetchComments(ghWithUnparseableComments),
      mode: "AUTHENTICATED_API",
      now: new Date(now).toISOString(),
    });

    // READ_FAILED would have discarded the signals and fallen to geometric backoff — 90 seconds
    // against an exhausted budget with an hour to run. That was IR-080.
    expect(result.outcome).toBe("MALFORMED_RESPONSE");
    expect(result.pollState).toBe("RATE_LIMITED_AUTHENTICATED");
    expect(result.nextDelayMs).toBeGreaterThan(HOUR - 60_000);

    // And it is still a failure: nothing admitted, cursor unmoved, the failure counted.
    expect(result.admitted).toHaveLength(0);
    expect(result.state.lastRemoteCommentId).toBeNull();
    expect(result.state.consecutiveFailures).toBe(1);
  });

  it("still succeeds normally when the body parses", async () => {
    const comment = {
      id: 7,
      body: "[CHATGPT_DECISION][ESC-777] hello",
      created_at: "2026-08-20T00:00:00Z",
      user: { login: "jyun121388-spec" },
    };
    const gh = (args: string[]) =>
      args.includes("rate_limit")
        ? JSON.stringify({
            resources: {
              core: { limit: 5000, remaining: 4999, reset: Math.floor(now / 1000) + 3600 },
            },
          })
        : JSON.stringify([comment]);

    const result = await runCycle({
      state: emptyState(2),
      paths,
      fetchComments: ghFetchComments(gh),
      mode: "AUTHENTICATED_API",
      now: new Date(now).toISOString(),
    });
    expect(result.outcome).toBe("ADMITTED");
    expect(result.admitted.map((a) => a.protocolId)).toEqual(["ESC-777"]);
    expect(result.nextDelayMs).toBe(TARGET_INTERVAL_MS);
  });
});
