import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assessDecision, impliedActions } from "@/server/controlbus/consumer";
import {
  acquireLock,
  heartbeat,
  lockIsStale,
  readLock,
  releaseLock,
  storePaths,
} from "@/server/controlbus/store";
import { GOVERNED_ACTIONS } from "@/server/governance/policy";
import { preflight } from "@/server/release/preflight";

/**
 * Second review cycle: the fixes from the first one, reviewed.
 *
 * `gpt-5.6-terra`, read-only, against the six modules the previous round changed. The question put
 * to it was not "is this correct" but "what does this fix now ASSUME, and where does that
 * assumption fail" — nine issues, one P0, and all nine reproduced before anything was touched.
 *
 * Sol refused the first attempt: the prompt was written in attack language and its provider
 * flagged it. Same review, defensive framing, narrower groups, and it ran. Worth recording because
 * the refusal looked exactly like a tool failure and was not one.
 *
 * The lesson from cycle one held and sharpened. Cycle one found defects beneath comments claiming
 * the opposite; cycle two found **the fixes reproducing the defects they fixed, one boundary
 * further out**:
 *
 * - `acquireLock` was `existsSync`-then-write. `writeAtomic` made the file CONTENTS atomic, which
 *   sounds like it covers acquisition and does not: two watchers both saw no lock, both wrote,
 *   both returned `acquired: true`. Fixed with an exclusive `wx` create, the primitive that
 *   actually decides a winner.
 * - The pagination loop, written to remove a silent truncation, silently truncated at its own
 *   ceiling: a full page at page 50 returned normally and reported a healthy poll.
 * - `heartbeat` and `releaseLock` checked for a nonce MISMATCH, so a corrupt lock — which reads as
 *   null — passed as "not somebody else's". Absence of a mismatch is not proof of a match, the
 *   same fail-open shape as an unsupplied allowlist.
 * - The prose gate switched off the moment any action was declared, so naming one harmless action
 *   bought silence for everything else in the sentence.
 *
 * Three of my own probes were wrong during this round, each in the direction of reporting a fix as
 * broken: one wrote an empty lock file and called the recovery a double acquisition, one read
 * `readLock() === null` as "deleted" when it also means "unreadable", and one printed a verdict
 * when the property under test was what got extracted. A script's output is a claim.
 */

const trusted = ["chatgpt-operator"];
const entry = (body: string, author = trusted[0]) => ({
  protocolId: "ESC-009",
  githubCommentId: 1,
  receivedAt: "2026-08-19T00:00:00Z",
  author,
  body,
  status: "RECEIVED_UNVALIDATED" as const,
});
const context = { openEscalationIds: ["ESC-009"], appliedIds: [], trustedAuthors: trusted };

describe("the lock actually excludes", () => {
  let root: string;
  let paths: ReturnType<typeof storePaths>;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cycle2-"));
    paths = storePaths(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const rec = (nonce: string, startedAt = new Date().toISOString()) => ({
    pid: process.pid,
    startedAt,
    nonce,
  });

  it("refuses a second acquisition while the first is held", () => {
    // The P0. Previously both callers got `acquired: true`, because check-then-write is not
    // acquisition however atomic the write is.
    expect(acquireLock(paths, rec("A"), 45_000).acquired).toBe(true);
    expect(acquireLock(paths, rec("B"), 45_000).acquired).toBe(false);
  });

  it("still takes over a lock whose holder stopped heartbeating", () => {
    // The negative control. An exclusive create that never yields would strand the channel after
    // any crash, which is a worse failure than the one it fixes.
    const ancient = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(paths.lock, JSON.stringify(rec("dead", ancient)), "utf8");
    expect(acquireLock(paths, rec("fresh"), 1_000).acquired).toBe(true);
  });

  it("does not let a non-owner delete a lock it cannot read", () => {
    // A corrupt lock read as null, and `held && mismatch` passed, so a stranger deleted a lock
    // while a live process was still polling behind it.
    acquireLock(paths, rec("A"), 45_000);
    writeFileSync(paths.lock, "{ corrupt", "utf8");
    releaseLock(paths, rec("stranger"));
    expect(existsSync(paths.lock)).toBe(true);
  });

  it("does not let a non-owner heartbeat an unreadable lock", () => {
    acquireLock(paths, rec("A"), 45_000);
    writeFileSync(paths.lock, "{ corrupt", "utf8");
    expect(heartbeat(paths, rec("A"), new Date().toISOString())).toBe(false);
  });

  it("still lets the owner release its own lock", () => {
    const owner = rec("OWNER");
    acquireLock(paths, owner, 45_000);
    releaseLock(paths, owner);
    expect(readLock(paths)).toBeNull();
  });

  it("does not destroy a live lock while clearing a stale one", () => {
    // The third cycle's critical. Clearing by pathname deletes whatever is there, including the
    // live lock a competitor legitimately created in between:
    //   A reads stale S · B reads S, clears, claims · A clears B's LIVE lock · A claims.
    // `wx` only arbitrates the creation, and by then the damage is done. Removal is now a rename
    // to a name only one caller can have chosen, so exactly one racer wins and the loser never
    // touches what the winner put back.
    const ancient = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(paths.lock, JSON.stringify(rec("dead", ancient)), "utf8");
    expect(acquireLock(paths, rec("B"), 1_000).acquired).toBe(true);
    expect(acquireLock(paths, rec("A"), 1_000).acquired).toBe(false);
    expect(readLock(paths)?.nonce).toBe("B");
  });

  it("does not let a displaced watcher delete or refresh its replacement's lock", () => {
    // The confirmation review's two failing claims, both the same read-then-write shape that
    // acquireLock had already been fixed for. heartbeat read, wrote, read back, and a competitor
    // arriving after the read-back still won; releaseLock read then unlinked. Both now take the
    // record by rename first, which is what makes the ownership check mean anything: exactly one
    // caller can move a given path, so nothing else is looking at the record while it decides.
    const a = rec("A");
    acquireLock(paths, a, 45_000);
    // B legitimately replaces a stale A.
    writeFileSync(paths.lock, JSON.stringify(rec("B")), "utf8");

    expect(heartbeat(paths, a, new Date().toISOString())).toBe(false);
    expect(readLock(paths)?.nonce, "A refreshed B's lock").toBe("B");

    releaseLock(paths, a);
    expect(readLock(paths)?.nonce, "A deleted B's lock").toBe("B");
  });

  it("does not let a queued takeover replace a lock that became live meanwhile", () => {
    // The final review's critical, and the third time the same mistake appeared one indirection
    // out. Renaming the lock away does not arbitrate anything — it moves whatever is at the path,
    // competitor's fresh lock included:
    //   A and B both read stale S · B takes over and installs B · A renames B's LIVE lock away.
    // Takeover now happens under an exclusive-create mutation right, and re-reads the record
    // INSIDE it, so a lock that became live while queuing is seen rather than replaced.
    const ancient = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(paths.lock, JSON.stringify(rec("dead", ancient)), "utf8");
    expect(acquireLock(paths, rec("B"), 1_000).acquired).toBe(true);
    // A still believes the stale record is there. It must not win.
    expect(acquireLock(paths, rec("A"), 1_000).acquired).toBe(false);
    expect(readLock(paths)?.nonce).toBe("B");
  });

  it("refuses to release when given no record at all", () => {
    // The optional parameter was a live-lock destroyer behind a default argument, and the easiest
    // of the whole set to trigger because it needs no concurrency.
    const owner = rec("OWNER");
    acquireLock(paths, owner, 45_000);
    releaseLock(paths);
    expect(readLock(paths)?.nonce).toBe("OWNER");
  });

  it("does not wedge when a mutation right is orphaned by a crash", () => {
    // The right has to expire. A process dying while holding it would otherwise block every future
    // takeover, and a deadlock is not an improvement on a race.
    const owner = rec("OWNER");
    acquireLock(paths, owner, 45_000);
    const orphaned = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(`${paths.lock}.mutate`, JSON.stringify({ nonce: "ghost", at: orphaned }), "utf8");
    expect(heartbeat(paths, owner, new Date().toISOString())).toBe(true);
  });

  it("treats a heartbeat from the future as stale rather than eternal", () => {
    // `nowMs - started` goes negative, so a lock stamped 2099 stayed "current" for decades — a
    // dead watcher holding the channel shut with a typo.
    expect(
      lockIsStale({ pid: 1, startedAt: "2099-01-01T00:00:00Z", nonce: "x" }, 45_000, Date.now()),
    ).toBe(true);
  });
});

describe("declaring one action does not silence the rest of the sentence", () => {
  it("refuses prose describing an action alongside a declared one", () => {
    // Naming one harmless action made `actions` non-empty and switched the gate off entirely.
    const assessment = assessDecision(
      entry("CONTROL_BUS_READ; also deploy to production."),
      context,
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("ACTIONS_NOT_DECLARED");
  });

  it("accepts a decision whose only action-shaped word is the action it declared", () => {
    // The negative control, and the reason the check strips declared tokens rather than scanning
    // the raw body: `DEPLOY_PRODUCTION` contains "deploy", so a naive scan would refuse every
    // correctly-declared deployment decision and the gate would be removed within a week.
    const assessment = assessDecision(
      entry("Proceed with DEPLOY_PRODUCTION."),
      context,
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("FORBIDDEN_BY_GOVERNANCE");
  });

  it("does not extract an action the decision explicitly declined", () => {
    expect(impliedActions("Do not CONTROL_BUS_READ.", GOVERNED_ACTIONS)).toEqual([]);
    expect(impliedActions("Run CONTROL_BUS_READ.", GOVERNED_ACTIONS)).toContain("CONTROL_BUS_READ");
  });

  it("names a forbidden decision forbidden even when it is also stale", () => {
    // Both refuse, so nothing was misapplied — but reporting "stale" invites a refresh and a
    // retry, and the same forbidden instruction then arrives looking current.
    const assessment = assessDecision(
      entry("HEAD: deadbee DEPLOY_PRODUCTION"),
      { ...context, currentHead: "cafebabe0" },
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("FORBIDDEN_BY_GOVERNANCE");
  });
});

describe("the preflight has no remaining permissive default", () => {
  const green = (commit: string) => ({ commit, state: "PASS" as const });
  const at = (head: string) => ({
    head,
    changesSinceEvidence: [],
    treeClean: true,
    pushedToRemote: true,
    tests: green(head),
    typecheck: green(head),
    lint: green(head),
    format: green(head),
    build: green(head),
    e2e: green(head),
    migrations: green(head),
    verifyCoverage: green(head),
    openP0: 0,
    openP1: 0,
    openP2: 13,
    reviewDebtItems: 3,
    unhandledReviewFindings: 0,
    finalReviewDone: true,
    finalReviewCommit: head,
    openHumanGates: [],
    unverifiedProviders: [],
    queuedEscalations: 0,
    controlBusWatcher: "ALIVE" as const,
  });

  it.each(["openP2", "reviewDebtItems", "controlBusWatcher"] as const)(
    "refuses to read an unsupplied %s as a satisfied condition",
    (field) => {
      const input: Record<string, unknown> = { ...at("AAAA") };
      delete input[field];
      expect(preflight(input as never).verdict).toBe("EVIDENCE_INSUFFICIENT");
    },
  );

  it("does not claim a register it never counted is documented", () => {
    // The detail string said "0 deferred P2, each recorded with a reason" for an input that
    // carried no count — a claim about a register nobody had opened.
    const input: Record<string, unknown> = { ...at("AAAA") };
    delete input.openP2;
    const check = preflight(input as never).checks.find((c) => c.name === "open P2");
    expect(check?.state).toBe("MISSING");
    expect(check?.detail).not.toContain("each recorded with a reason");
  });

  it("returns a verdict instead of throwing when the change list is omitted", () => {
    // It was required at runtime while the file said every input was optional. A preflight that
    // crashes gives no verdict at all, which is worse than an unhelpful one.
    const input: Record<string, unknown> = { ...at("AAAA"), head: "BBBB" };
    delete input.changesSinceEvidence;
    expect(() => preflight(input as never)).not.toThrow();
    expect(preflight(input as never).verdict).toBe("EVIDENCE_STALE");
  });

  it("reports missing evidence ahead of stale evidence", () => {
    // Stale says "it passed, elsewhere"; missing says nothing at all. The weaker claim decides.
    const input: Record<string, unknown> = {
      ...at("AAAA"),
      head: "BBBB",
      finalReviewCommit: "BBBB",
    };
    delete input.lint;
    expect(preflight(input as never).verdict).toBe("EVIDENCE_INSUFFICIENT");
  });

  it("still reports READY when every input is genuinely supplied and green", () => {
    expect(preflight(at("CCCC")).verdict).toBe("RELEASE_CANDIDATE_READY");
  });
});

describe("the pagination ceiling is loud", () => {
  it("throws rather than returning a truncated page set", () => {
    // The fix reproducing the defect it fixed, one boundary out: a full page at the ceiling was
    // returned as a normal result and the watcher reported a healthy quiet poll. Throwing routes
    // it through READ_FAILED, where the cursor does not move and it retries.
    const source = readFileSync(join(process.cwd(), "src/server/controlbus/watch.ts"), "utf8");
    expect(source).toContain("PaginationCeilingReached");
    expect(source).toMatch(/if \(page === 50\)/);
  });
});
