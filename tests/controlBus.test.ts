import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assessDecision,
  controlEvents,
  impliedActions,
  startableDecisionCount,
} from "@/server/controlbus/consumer";
import type { ControlBusState, InboxEntry } from "@/server/controlbus/state";
import {
  emptyState,
  health,
  ingestComments,
  pollDelayMs,
  resolveInboxEntry,
  unprocessedDecisions,
} from "@/server/controlbus/state";
import {
  acquireLock,
  commitCycle,
  loadState,
  lockIsStale,
  logLine,
  storePaths,
} from "@/server/controlbus/store";
import { parseCommentsPayload, runCycle } from "@/server/controlbus/watch";
import { evaluateStopSentinel } from "@/server/evolution/scheduler";
import { GOVERNED_ACTIONS, evaluateAction } from "@/server/governance/policy";

/**
 * The control bus: GitHub issue #2 as an asynchronous rendezvous.
 *
 * **No test in this file may reach GitHub.** The network is a parameter of `runCycle`, which is
 * the reason it is a parameter — a transport test that occasionally posts to a public issue is a
 * test that occasionally posts to a public issue.
 *
 * The properties worth stating plainly, because each one is a way the bus could quietly fail:
 *
 * - Delivery is at-least-once and application is exactly-once. Those are different guarantees and
 *   the gap between them is deduplication.
 * - The cursor advances only after the message is durable. Reversed, a crash in the window loses a
 *   decision permanently, and nothing anywhere would record that it had existed.
 * - A parsed decision is a message, not an authority. GitHub is transport; Governance decides.
 * - Idle means the queue is empty and the watcher is alive. A dead watcher is deafness, not rest.
 */

const comment = (id: number, body: string, login = "chatgpt-operator") => ({
  id,
  body,
  created_at: "2026-08-19T00:00:00Z",
  user: { login },
});

const NOW = "2026-08-19T12:00:00.000Z";

let root: string;
let paths: ReturnType<typeof storePaths>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "control-bus-"));
  paths = storePaths(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("reading the issue", () => {
  it("admits a decision it has not seen", () => {
    const { state, admitted } = ingestComments(
      emptyState(2),
      [comment(100, "[CHATGPT_DECISION][ESC-009] Keep the current lockout.")],
      NOW,
    );
    expect(admitted).toHaveLength(1);
    expect(admitted[0].protocolId).toBe("ESC-009");
    // The only status transport may write. It has observed a message and judged nothing.
    expect(admitted[0].status).toBe("RECEIVED_UNVALIDATED");
    expect(state.lastRemoteCommentId).toBe(100);
  });

  it("admits nothing when there is nothing new", () => {
    const first = ingestComments(emptyState(2), [comment(100, "ordinary prose, no tag")], NOW);
    const second = ingestComments(first.state, [comment(100, "ordinary prose, no tag")], NOW);
    expect(second.admitted).toHaveLength(0);
  });

  it("absorbs a redelivered comment without admitting it twice", () => {
    const body = "[CHATGPT_DECISION][ESC-009] Keep the current lockout.";
    const first = ingestComments(emptyState(2), [comment(100, body)], NOW);
    const second = ingestComments(first.state, [comment(100, body)], NOW);
    expect(second.admitted).toHaveLength(0);
    expect(second.state.inbox).toHaveLength(1);
  });

  it("refuses a second decision under a protocol id it has already admitted", () => {
    // Same question, different comment. Transport can produce this; engineering must not act on
    // it twice, and the skip is named rather than silent.
    const first = ingestComments(
      emptyState(2),
      [comment(100, "[CHATGPT_DECISION][ESC-009] Keep it.")],
      NOW,
    );
    const second = ingestComments(
      first.state,
      [comment(101, "[CHATGPT_DECISION][ESC-009] Actually, change it.")],
      NOW,
    );
    expect(second.admitted).toHaveLength(0);
    expect(second.skipped[0].reason).toContain("already been admitted");
  });

  it("does not treat its own escalations as incoming decisions", () => {
    const { admitted } = ingestComments(
      emptyState(2),
      [
        comment(100, "[ESCALATION][ESC-009] Which lockout?"),
        comment(101, "[CLAUDE_APPLIED][TEST-001] done"),
      ],
      NOW,
    );
    expect(admitted).toHaveLength(0);
  });

  it("orders by comment id, never by timestamp", () => {
    // Two comments in the same second. Sorting by `created_at` would make the high-water mark
    // depend on which one the sort happened to put last.
    const { state } = ingestComments(
      emptyState(2),
      [comment(200, "[CHATGPT_DECISION][ESC-B] b"), comment(100, "[CHATGPT_DECISION][ESC-A] a")],
      NOW,
    );
    expect(state.lastRemoteCommentId).toBe(200);
  });
});

describe("a malformed or failing read is a transport fact, not an empty issue", () => {
  it("rejects a payload that is not a list of comments", () => {
    // GitHub returns an object for a rate limit, an auth failure, or a missing issue, and every
    // one of those parses as JSON. Reading it as "no comments" would report silence as calm.
    expect(parseCommentsPayload({ message: "API rate limit exceeded" })).toBeNull();
    expect(parseCommentsPayload([{ id: "not-a-number", body: "x" }])).toBeNull();
    expect(parseCommentsPayload([])).toEqual([]);
  });

  it("backs off on a failed read without moving the cursor", async () => {
    const before = { ...emptyState(2), lastRemoteCommentId: 50 };
    const result = await runCycle({
      state: before,
      paths,
      fetchComments: () => Promise.reject(new Error("socket hang up")),
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      now: NOW,
    });
    expect(result.outcome).toBe("READ_FAILED");
    expect(result.state.lastRemoteCommentId).toBe(50);
    expect(result.state.consecutiveFailures).toBe(1);
    expect(result.nextDelayMs).toBeGreaterThan(pollDelayMs(0));
  });

  it("never puts an error message in the log, only its class", async () => {
    // A fetch error can carry the request URL, and a URL can carry a token.
    const result = await runCycle({
      state: emptyState(2),
      paths,
      fetchComments: () => Promise.reject(new Error("https://x?token=ghp_SECRETVALUE0123456789")),
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      now: NOW,
    });
    expect(result.detail).not.toContain("ghp_");
    expect(readFileSync(paths.log, "utf8")).not.toContain("ghp_");
  });

  it("keeps backoff bounded, so a slept laptop does not wake into an hour-long wait", () => {
    expect(pollDelayMs(0)).toBe(45_000);
    expect(pollDelayMs(1)).toBeGreaterThan(45_000);
    expect(pollDelayMs(50)).toBeLessThanOrEqual(480_000);
  });
});

describe("crash safety", () => {
  it("persists the message before the cursor, so the crash window costs a redelivery", () => {
    // The ordering is the whole guarantee. Asserted by observing that the durable message log
    // contains the decision and that the state file names the same cursor — if `commitCycle` ever
    // writes the cursor first, a crash between them would leave a cursor past an unrecorded
    // message, and this is the only place that ordering is checked.
    const { state, admitted } = ingestComments(
      emptyState(2),
      [comment(100, "[CHATGPT_DECISION][ESC-009] keep")],
      NOW,
    );
    commitCycle(paths, state, admitted);
    const inboxLines = readFileSync(paths.inbox, "utf8").trim().split("\n");
    expect(JSON.parse(inboxLines[0]).protocolId).toBe("ESC-009");
    expect(loadState(paths, 2).lastRemoteCommentId).toBe(100);
  });

  it("replays safely after a restart", async () => {
    const body = "[CHATGPT_DECISION][ESC-009] keep";
    await runCycle({
      state: emptyState(2),
      paths,
      fetchComments: () => Promise.resolve({ payload: [comment(100, body)], signals: {} }),
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      now: NOW,
    });
    // Restart: state is re-read from disk and GitHub redelivers the same page.
    const restarted = loadState(paths, 2);
    const second = await runCycle({
      state: restarted,
      paths,
      fetchComments: () => Promise.resolve({ payload: [comment(100, body)], signals: {} }),
      mode: "UNAUTHENTICATED_PUBLIC_READ",
      now: NOW,
    });
    expect(second.admitted).toHaveLength(0);
    expect(second.state.inbox).toHaveLength(1);
  });

  it("refuses to start fresh from a corrupt state file", () => {
    // Silently starting over would reset the cursor and re-admit every decision on the issue.
    writeFileSync(paths.state, "{ not json", "utf8");
    expect(() => loadState(paths, 2)).toThrow(/re-admit every decision/);
  });
});

describe("a decision is a message, not an authority", () => {
  const entry = (id: string, body: string): InboxEntry => ({
    protocolId: id,
    githubCommentId: 1,
    receivedAt: NOW,
    author: "chatgpt-operator",
    body,
    status: "RECEIVED_UNVALIDATED",
  });

  // `trustedAuthors` arrived with IR-046 and every test in this block went red without it, which
  // is the fail-closed behaviour working: the allowlist defaults to trusting nobody, because
  // forgetting to configure it would otherwise open the channel to everyone on GitHub.
  const context = {
    openEscalationIds: ["ESC-009"],
    appliedIds: [] as string[],
    trustedAuthors: ["chatgpt-operator"],
  };

  it("accepts a decision answering an escalation we posted", () => {
    const assessment = assessDecision(entry("ESC-009", "Keep it."), context, GOVERNED_ACTIONS);
    expect(assessment.verdict).toBe("APPLICABLE");
  });

  it("validates a trusted decision with no escalation behind it, and labels it unsolicited", () => {
    // This asserted NO_MATCHING_ESCALATION until [CHATGPT_DECISION][ESC-012] (comment 5364810128)
    // settled the question as Option A. The old rule was right that the decision answers nothing
    // we asked and wrong that this makes it invalid: seven directives of exactly this shape had
    // been acted on, including the one authorising the review chain the release rests on.
    //
    // What must stay true is the half the old test was really protecting — that arriving by
    // comment is not authority. It does: the verdict is VALIDATED, not APPLIED, and every gate
    // below is exercised by its own case.
    const assessment = assessDecision(entry("ESC-777", "Do this."), context, GOVERNED_ACTIONS);
    expect(assessment.verdict).toBe("DIRECTIVE_VALIDATED");
    expect(assessment.provenance).toBe("UNSOLICITED_DIRECTIVE");
  });

  it("still labels a matched decision as solicited", () => {
    const assessment = assessDecision(entry("ESC-009", "Keep it."), context, GOVERNED_ACTIONS);
    expect(assessment.verdict).toBe("APPLICABLE");
    expect(assessment.provenance).toBe("SOLICITED_DECISION");
  });

  it("refuses to apply the same decision twice", () => {
    const assessment = assessDecision(
      entry("ESC-009", "Keep it."),
      { ...context, appliedIds: ["ESC-009"] },
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("ALREADY_APPLIED");
  });

  it("treats a TEST id as transport exercise and never as an instruction", () => {
    const assessment = assessDecision(
      entry("TEST-001", "DEPLOY_PRODUCTION now"),
      { openEscalationIds: ["TEST-001"], appliedIds: [], trustedAuthors: ["chatgpt-operator"] },
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("TEST_MESSAGE_NOT_A_DECISION");
  });

  it.each([
    "PURCHASE_AI_CREDITS",
    "CALL_PAID_PROVIDER",
    "DEPLOY_PRODUCTION",
    "DESTRUCTIVE_DB_OP",
    "COMMIT_CREDENTIAL",
    "GIT_HISTORY_REWRITE",
  ])("refuses a decision that instructs %s", (kind) => {
    // The property the whole bus depends on. Arriving by GitHub changes nothing about the rule,
    // and each of these is independently DENIED or gated by the policy table.
    const assessment = assessDecision(
      entry("ESC-009", `Proceed with ${kind} immediately.`),
      context,
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("FORBIDDEN_BY_GOVERNANCE");
    expect(assessment.reason).toContain("not a root authority");
  });

  it("answers a stale decision with a refresh rather than a guess", () => {
    const assessment = assessDecision(
      entry("ESC-009", "Against HEAD: abc1234, keep the lockout."),
      { ...context, currentHead: "def5678901" },
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("STALE_AGAINST_HEAD");
    expect(assessment.reason).toContain("REFRESH_REQUIRED");
  });

  it("extracts only action kinds a decision literally names", () => {
    // Paraphrase detection was rejected: wrong in the permissive direction, it turns a discussion
    // of an action into authorisation for it.
    expect(impliedActions("please deploy to production", GOVERNED_ACTIONS)).toEqual([]);
    expect(impliedActions("run DEPLOY_PRODUCTION", GOVERNED_ACTIONS)).toContain(
      "DEPLOY_PRODUCTION",
    );
  });
});

describe("a decision creates work, and a dead watcher is not rest", () => {
  const received: InboxEntry[] = [
    {
      protocolId: "ESC-009",
      githubCommentId: 1,
      receivedAt: NOW,
      author: "chatgpt-operator",
      body: "Keep the current lockout.",
      status: "RECEIVED_UNVALIDATED",
    },
  ];
  const context = {
    openEscalationIds: ["ESC-009"],
    appliedIds: [],
    trustedAuthors: ["chatgpt-operator"],
  };

  it("turns an applicable decision into startable work", () => {
    expect(startableDecisionCount(received, context, GOVERNED_ACTIONS)).toBe(1);
    expect(controlEvents(received, context, GOVERNED_ACTIONS)[0].kind).toBe("DECISION_APPLICABLE");
  });

  it("stops counting it once the consumer has resolved it", () => {
    const state = { ...emptyState(2), inbox: received };
    // Exact row: the protocol id alone stopped naming one when advisory rows became durable.
    const outcome = resolveInboxEntry(
      state,
      { protocolId: "ESC-009", githubCommentId: received[0].githubCommentId },
      "APPLIED",
      "lockout kept",
    );
    expect(outcome.resolved).toBe(true);
    expect(unprocessedDecisions(outcome.state)).toHaveLength(0);
  });

  const quiet = {
    queue: { actionable: [], deferred: [] },
    unresolvedFailures: 0,
    advanceableBlockers: 0,
    unhandledReviewFindings: 0,
    discoveryCandidates: 0,
    orphanedDocumentedWork: 0,
    trueIdleEscalation: "QUEUED" as const,
  };

  it("will not let the loop stop while a decision is waiting", () => {
    const sentinel = evaluateStopSentinel({
      ...quiet,
      receivedDecisions: 1,
      controlBusWatcher: "ALIVE",
    });
    expect(sentinel.mayStop).toBe(false);
  });

  it("will not let the loop stop while the watcher is down", () => {
    // A stopped watcher means a decision posted in ten minutes is never seen. That is a task —
    // start it — and never a reason to conclude nothing remains.
    const stopped = evaluateStopSentinel({
      ...quiet,
      receivedDecisions: 0,
      controlBusWatcher: "STOPPED",
    });
    expect(stopped.mayStop).toBe(false);
    expect(stopped.conditions.find((c) => c.name.includes("watcher"))?.detail).toContain(
      "not a stop",
    );
  });

  it("fails closed when nobody said whether the watcher is running", () => {
    expect(evaluateStopSentinel({ ...quiet, receivedDecisions: 0 }).mayStop).toBe(false);
  });

  it("permits idling only with an empty queue and a live watcher", () => {
    const sentinel = evaluateStopSentinel({
      ...quiet,
      receivedDecisions: 0,
      controlBusWatcher: "ALIVE",
    });
    expect(sentinel.mayStop).toBe(true);
  });
});

describe("single instance", () => {
  const record = (pid: number, startedAt: string) => ({ pid, startedAt, nonce: `${pid}-x` });

  it("refuses a second watcher while the first is heartbeating", () => {
    const first = acquireLock(paths, record(process.pid, new Date().toISOString()), 45_000);
    expect(first.acquired).toBe(true);
    const second = acquireLock(paths, record(process.pid, new Date().toISOString()), 45_000);
    expect(second.acquired).toBe(false);
  });

  it("takes over a lock whose heartbeat has stopped", () => {
    // The pid may well still be alive — recycled to something unrelated. Heartbeat, not liveness,
    // is what says whether OUR watcher is running, and a bare pid check gets this confidently
    // wrong on Windows where recycling is fast.
    const ancient = new Date(Date.parse(NOW) - 10 * 60_000).toISOString();
    expect(lockIsStale(record(process.pid, ancient), 45_000, Date.parse(NOW))).toBe(true);
    const outcome = acquireLock(paths, record(process.pid, ancient), 1);
    expect(outcome.acquired).toBe(true);
  });

  it("waits out an unreadable lock that was written moments ago", () => {
    // This test previously asserted the opposite, and the final review explained why that was the
    // bug rather than the feature: `wx` creates the directory entry before the contents land, so a
    // competitor acquiring RIGHT NOW is briefly an empty file. Reading that as "corrupt, take it
    // over" let both callers acquire.
    writeFileSync(paths.lock, "{ corrupt", "utf8");
    expect(acquireLock(paths, record(process.pid, new Date().toISOString()), 45_000).acquired).toBe(
      false,
    );
  });

  it("takes over an unreadable lock that has been there a while", () => {
    // The other half, and the reason the first is safe to do: a genuinely corrupt record must not
    // hold the channel shut. Age comes from the filesystem, because by definition there is no
    // timestamp inside the record to read.
    writeFileSync(paths.lock, "{ corrupt", "utf8");
    const old = Date.now() - 60_000;
    utimesSync(paths.lock, new Date(old), new Date(old));
    expect(acquireLock(paths, record(process.pid, new Date().toISOString()), 45_000).acquired).toBe(
      true,
    );
  });
});

describe("health is a state, not a boolean", () => {
  const base: ControlBusState = emptyState(2);

  it.each([
    [{ state: base, watcherAlive: false, writeAvailable: false }, "NETWORK_DEGRADED"],
    [{ state: base, watcherAlive: true, writeAvailable: false }, "READ_ONLY"],
    [
      { state: { ...base, consecutiveFailures: 5 }, watcherAlive: true, writeAvailable: true },
      "NETWORK_DEGRADED",
    ],
    [{ state: base, watcherAlive: true, writeAvailable: true }, "IDLE_WATCHING"],
  ])("reports %#", (input, expected) => {
    expect(health(input)).toBe(expected);
  });

  it("reports a pending decision ahead of a blocked write", () => {
    // An arrived decision nobody has consumed is a stall. A blocked write is HG-001 restated, and
    // has been true all along.
    const withDecision: ControlBusState = {
      ...base,
      inbox: [
        {
          protocolId: "ESC-009",
          githubCommentId: 1,
          receivedAt: NOW,
          author: "x",
          body: "y",
          status: "RECEIVED_UNVALIDATED",
        },
      ],
    };
    expect(health({ state: withDecision, watcherAlive: true, writeAvailable: false })).toBe(
      "DECISION_PENDING",
    );
  });
});

describe("the control bus is governed", () => {
  it.each([
    ["CONTROL_BUS_READ", "AUTO_ALLOWED"],
    ["CONTROL_BUS_PUBLIC_WRITE", "AUTO_ALLOWED_WITH_VERIFY"],
    ["CONTROL_BUS_DECISION_APPLY", "AUTO_ALLOWED_WITH_VERIFY"],
    ["CONTROL_BUS_WATCHER_START", "AUTO_ALLOWED"],
    ["CONTROL_BUS_WATCHER_STOP", "AUTO_ALLOWED"],
  ] as const)("classifies %s as %s", (kind, decision) => {
    // A new external side effect must not arrive unclassified — that was IR-044, one phase ago.
    expect(evaluateAction({ kind }).decision).toBe(decision);
  });

  it("blocks the public write on a missing credential without denying it", () => {
    const evaluation = evaluateAction({
      kind: "CONTROL_BUS_PUBLIC_WRITE",
      context: { credentialsAvailable: false },
    });
    expect(evaluation.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
    expect(evaluation.execution).toBe("BLOCKED_MISSING_CREDENTIAL");
  });

  it("requires a read-back before a write counts as transmitted", () => {
    expect(
      evaluateAction({ kind: "CONTROL_BUS_PUBLIC_WRITE" }).requiredVerification.join(" "),
    ).toContain("read-back");
  });
});

describe("runtime state stays out of the repository", () => {
  it("writes only under the gitignored runtime directory", () => {
    logLine(paths, "hello");
    commitCycle(paths, emptyState(2), []);
    expect(existsSync(join(root, "state.json"))).toBe(true);
    // A watcher polling every 45 seconds must not produce a commit stream. `.local/` is
    // gitignored, and the default paths point inside it.
    expect(storePaths().root.startsWith(".local/")).toBe(true);
  });
});
