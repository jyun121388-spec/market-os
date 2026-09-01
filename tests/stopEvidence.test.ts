import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateStopSentinel, scheduleNextWork } from "@/server/evolution/scheduler";
import { gatherStopEvidence, HEARTBEAT_STALE_MS } from "../scripts/stop-evidence";

/**
 * `evaluateStopSentinel()` is named by `CLAUDE.md` as the only normal completion sentinel. It was
 * carefully written and thoroughly tested, and nothing in the repository could answer it: the sole
 * non-test caller supplied one of nine inputs, so eight conditions had never been evaluated against
 * reality and `MAY STOP` was false by construction rather than by finding.
 *
 * These controls bind the GATHERER, and the one property that matters most is negative — it must
 * never manufacture a zero. `loadState()` returns `emptyState()` for a missing file, so the obvious
 * one-liner would report "no decisions waiting" about an inbox that was never read.
 */
describe("gathering evidence for the stop sentinel", () => {
  const withRoot = <T>(fn: (root: string) => T): T => {
    const dir = mkdtempSync(join(tmpdir(), "stop-evidence-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const writeState = (root: string, inbox: unknown) =>
    writeFileSync(join(root, "state.json"), JSON.stringify({ issueNumber: 2, inbox }), "utf8");

  const writeLock = (root: string, pid: number, startedAt: string) =>
    writeFileSync(
      join(root, "watcher.lock.json"),
      JSON.stringify({ pid, startedAt, nonce: "n" }),
      "utf8",
    );

  const unestablishedFields = (root: string, now?: number) =>
    gatherStopEvidence(root, now).unestablished.map((u) => u.field);

  it("refuses to call an unread inbox an empty one", () => {
    // THE control. A missing state file is not zero decisions, and `loadState` would say it was.
    withRoot((root) => {
      const evidence = gatherStopEvidence(root);
      expect(evidence.supplied.receivedDecisions).toBeUndefined();
      expect(unestablishedFields(root)).toContain("receivedDecisions");
      const reason = evidence.unestablished.find((u) => u.field === "receivedDecisions")!.because;
      expect(reason).toMatch(/not the same as it being empty/);
    });
  });

  it("counts only the decisions nobody has judged yet", () => {
    withRoot((root) => {
      writeState(root, [
        { protocolId: "A", status: "RECEIVED_UNVALIDATED" },
        { protocolId: "B", status: "APPLIED" },
        { protocolId: "C", status: "RECEIVED_UNVALIDATED" },
      ]);
      expect(gatherStopEvidence(root).supplied.receivedDecisions).toBe(2);
    });
  });

  it("establishes a real zero when the inbox is readable and empty", () => {
    // The other half of the first control: refusing everything would be just as useless as
    // guessing. A file that exists and holds an empty inbox IS an established zero.
    withRoot((root) => {
      writeState(root, []);
      const evidence = gatherStopEvidence(root);
      expect(evidence.supplied.receivedDecisions).toBe(0);
      expect(unestablishedFields(root)).not.toContain("receivedDecisions");
    });
  });

  it("refuses a corrupt or wrongly shaped state file rather than reading a zero out of it", () => {
    withRoot((root) => {
      writeFileSync(join(root, "state.json"), "{not json", "utf8");
      expect(gatherStopEvidence(root).supplied.receivedDecisions).toBeUndefined();
    });
    withRoot((root) => {
      // Shape drift is the quieter version: valid JSON whose inbox is not a list would make
      // `.filter` throw, or worse, make some future implementation answer 0.
      writeState(root, { nope: true });
      expect(gatherStopEvidence(root).supplied.receivedDecisions).toBeUndefined();
    });
  });

  it("cannot tell a stopped watcher from a wrong runtime root", () => {
    // The watcher writes its directory relative to ITS cwd. Run from another worktree, the absence
    // of the directory says nothing about whether a watcher is running.
    const evidence = gatherStopEvidence(join(tmpdir(), "stop-evidence-does-not-exist"));
    expect(evidence.supplied.controlBusWatcher).toBeUndefined();
    expect(evidence.unestablished.map((u) => u.field)).toContain("controlBusWatcher");
  });

  it("reads a live heartbeat as ALIVE and a lapsed one as STOPPED", () => {
    withRoot((root) => {
      const now = Date.parse("2026-09-01T12:00:00Z");
      // This process is certainly running, so the pid half is satisfied and the heartbeat decides.
      writeLock(root, process.pid, new Date(now - 1_000).toISOString());
      expect(gatherStopEvidence(root, now).supplied.controlBusWatcher).toBe("ALIVE");

      // Three missed heartbeats. Same live pid, so it is the staleness rule answering, not the pid.
      writeLock(root, process.pid, new Date(now - HEARTBEAT_STALE_MS * 4).toISOString());
      expect(gatherStopEvidence(root, now).supplied.controlBusWatcher).toBe("STOPPED");
    });
  });

  it("reads a dead pid as STOPPED even with a fresh heartbeat", () => {
    withRoot((root) => {
      const now = Date.parse("2026-09-01T12:00:00Z");
      // A pid nothing can be running under, with a heartbeat one second old, so only the liveness
      // half can be answering.
      writeLock(root, 0x7ffffff0, new Date(now - 1_000).toISOString());
      expect(gatherStopEvidence(root, now).supplied.controlBusWatcher).toBe("STOPPED");

      // And pid 0 specifically, which MEASURED as alive: `process.kill(0, 0)` addresses the current
      // process group, not a process, so it succeeds and `processAlive(0)` answers true. A lock
      // holding pid 0 is malformed, and reading it as a live watcher would be the worst possible
      // direction to be wrong in — the sentinel would believe a decision could still arrive.
      writeLock(root, 0, new Date(now - 1_000).toISOString());
      expect(gatherStopEvidence(root, now).supplied.controlBusWatcher).toBe("STOPPED");
    });
  });

  it("reads an existing runtime dir with no lock as STOPPED", () => {
    withRoot((root) => {
      mkdirSync(join(root, "sub"), { recursive: true });
      expect(gatherStopEvidence(root).supplied.controlBusWatcher).toBe("STOPPED");
    });
  });

  it("says why it did not attempt the facts it did not attempt", () => {
    // A listed gap is a decision; an unlisted one reads as an oversight. Every field the sentinel
    // takes must be either supplied or explained — nothing may silently go missing.
    withRoot((root) => {
      writeState(root, []);
      writeLock(root, process.pid, new Date().toISOString());
      const evidence = gatherStopEvidence(root);
      const accounted = new Set([
        ...Object.keys(evidence.supplied),
        ...evidence.unestablished.map((u) => u.field),
      ]);
      for (const field of [
        "receivedDecisions",
        "controlBusWatcher",
        "unresolvedFailures",
        "advanceableBlockers",
        "unhandledReviewFindings",
        "discoveryCandidates",
        "orphanedDocumentedWork",
        "trueIdleEscalation",
      ]) {
        expect(accounted.has(field), `${field} is neither supplied nor explained`).toBe(true);
      }
      for (const u of evidence.unestablished) expect(u.because.length).toBeGreaterThan(20);
    });
  });

  it("keeps the heartbeat budget in step with the watcher that writes it", () => {
    // Three copies of 45s now exist -- store.ts, scripts/control-bus.ts, and this module -- and a
    // third copy that drifts would make the gatherer call a live watcher dead. Product code is
    // frozen, so the duplication is made self-checking instead of removed.
    const source = readFileSync("scripts/control-bus.ts", "utf8");
    const match = source.match(/const HEARTBEAT_MS = ([0-9_]+);/);
    expect(match, "scripts/control-bus.ts no longer declares HEARTBEAT_MS").not.toBeNull();
    expect(Number(match![1].replace(/_/g, ""))).toBe(HEARTBEAT_STALE_MS);
  });
});

/**
 * The point of gathering at all: the sentinel must be able to CHANGE its answer.
 *
 * A predicate that returns false whatever the world does is not a sentinel, and this is the
 * property that was actually missing — not any individual condition.
 */
describe("the sentinel with gathered evidence", () => {
  it("still refuses to stop while real evidence is absent", () => {
    const queue = scheduleNextWork();
    const evidence = gatherStopEvidence(join(tmpdir(), "stop-evidence-does-not-exist"));
    expect(evaluateStopSentinel({ queue, ...evidence.supplied }).mayStop).toBe(false);
  });

  it("cannot be pushed into stopping by the gatherer alone", () => {
    // Safety by construction, asserted rather than assumed: even with BOTH gathered fields at their
    // most permissive, the conditions this module deliberately does not attempt keep it false. So
    // adding a gatherer can never cause a premature stop.
    const empty = { actionable: [], deferred: [] } as unknown as ReturnType<
      typeof scheduleNextWork
    >;
    const best = { receivedDecisions: 0, controlBusWatcher: "ALIVE" } as const;
    expect(evaluateStopSentinel({ queue: empty, ...best }).mayStop).toBe(false);
  });
});
