import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  transmitAndCommit,
  type OutboundDeps,
  type OutboundTransport,
  type RemoteCommentRef,
} from "@/server/controlbus/outbound";
import {
  bodyDigest,
  CONTROL_BUS_REPOSITORY,
  emptyState,
  type ControlBusState,
} from "@/server/controlbus/state";
import { storePaths, writeState } from "@/server/controlbus/store";
import { controlBusStanding } from "../scripts/inbox-triage";

/**
 * The producer IR-115 said did not exist.
 *
 * `controlBusStanding` requires a verified transmission before an id counts as open. Nothing wrote
 * one: `appendOutbox` had no callers and `state.outbox` was written by nobody, so the predicate
 * could be green in tests and structurally unable to say `OPEN` in real operation.
 *
 * The property every control here is about: A SUCCESSFUL POST IS NOT EVIDENCE. Only a read-back
 * that matches the composed body, on the right issue, in the right repository, with a real comment
 * id, may write a proof. `CLAUDE.md` says it in as many words —
 * `REMOTE_POST_NOT_CONFIRMED => CHATGPT_NOT_YET_NOTIFIED`.
 */
describe("committing an outbound message only once it is proven to exist", () => {
  const BODY = "[ESCALATION][ESC-900]\n\nA question.";
  const ISSUE = 2;

  const deps: OutboundDeps = {
    now: () => "2026-09-02T00:00:00.000Z",
    heartbeatStaleMs: 45_000,
    nowMs: () => Date.parse("2026-09-02T00:00:00.000Z"),
    pid: process.pid,
  };

  const draft = {
    protocolId: "ESC-900",
    kind: "ESCALATION" as const,
    body: BODY,
    composedAt: "2026-09-01T23:59:00.000Z",
  };

  const remote = (over: Partial<RemoteCommentRef> = {}): RemoteCommentRef => ({
    commentId: 5496551940,
    body: BODY,
    repository: CONTROL_BUS_REPOSITORY,
    issueNumber: ISSUE,
    ...over,
  });

  /** Records what was asked of it, so "did it post twice" is a fact rather than an inference. */
  const transport = (over: Partial<OutboundTransport> = {}) => {
    const calls = { find: 0, post: 0, readBack: 0 };
    const t: OutboundTransport = {
      find: async () => {
        calls.find += 1;
        return null;
      },
      post: async () => {
        calls.post += 1;
        return { commentId: remote().commentId };
      },
      readBack: async () => {
        calls.readBack += 1;
        return remote();
      },
      ...over,
    };
    return { t, calls };
  };

  const withStore = async <T>(fn: (root: string, state: ControlBusState) => Promise<T>) => {
    const root = mkdtempSync(join(tmpdir(), "control-bus-outbound-"));
    try {
      const state = emptyState(ISSUE);
      writeState(storePaths(root), state);
      return await fn(root, state);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const persisted = (root: string) =>
    JSON.parse(readFileSync(join(root, "state.json"), "utf8")) as ControlBusState;

  it("commits a proof, and only then does the id read as open", async () => {
    // The end-to-end reachability IR-115 was about: not a fixture asserting OPEN, but the real
    // producer making the real predicate say it.
    await withStore(async (root, state) => {
      const { t, calls } = transport();
      const out = await transmitAndCommit(storePaths(root), state, draft, t, deps);

      expect(out.status).toBe("COMMITTED");
      expect(calls).toEqual({ find: 1, post: 1, readBack: 1 });

      const after = persisted(root);
      expect(after.outbox).toHaveLength(1);
      expect(after.outbox[0].transmission?.bodyDigest).toBe(bodyDigest(BODY));
      expect(controlBusStanding(after).standing("ESC-900")).toBe("OPEN");

      // The append-only log carries the same entry. One writer, both records, log first.
      const log = readFileSync(join(root, "outbox.jsonl"), "utf8").trim().split("\n");
      expect(log).toHaveLength(1);
      expect(JSON.parse(log[0]).protocolId).toBe("ESC-900");
    });
  });

  it("treats a successful POST with no read-back as not sent", async () => {
    // The crash window that matters most, and the invariant in one test: the comment may well
    // exist remotely, and this machine has no evidence of it, so the id stays closed.
    await withStore(async (root, state) => {
      const { t } = transport({ readBack: async () => null });
      const out = await transmitAndCommit(storePaths(root), state, draft, t, deps);

      expect(out.status).toBe("REFUSED");
      expect(out.status === "REFUSED" && out.reason).toMatch(/no read-back/);

      const after = persisted(root);
      // Committed WITHOUT proof: the attempt is a record, not a silence, and not an opening.
      expect(after.outbox).toHaveLength(1);
      expect(after.outbox[0].transmission).toBeUndefined();
      expect(controlBusStanding(after).standing("ESC-900")).toBe("STANDING_UNVERIFIABLE");
    });
  });

  it("refuses a read-back that does not match what was composed", async () => {
    for (const [label, ref] of [
      ["a different body", remote({ body: `${BODY} edited` })],
      ["another repository", remote({ repository: "someone/else" })],
      ["another issue", remote({ issueNumber: 3 })],
      ["a malformed comment id", remote({ commentId: 0 })],
    ] as const) {
      await withStore(async (root, state) => {
        const { t } = transport({ readBack: async () => ref });
        const out = await transmitAndCommit(storePaths(root), state, draft, t, deps);
        expect(out.status, label).toBe("REFUSED");
        expect(persisted(root).outbox[0].transmission, label).toBeUndefined();
      });
    }
  });

  it("adopts a comment a crashed attempt already posted, instead of posting twice", async () => {
    // Crash after POST, before the state was written. Replay must not duplicate the comment, and
    // must not lose the proof either — those are the only two failure modes available without this.
    await withStore(async (root, state) => {
      const { t, calls } = transport({ find: async () => remote() });
      const out = await transmitAndCommit(storePaths(root), state, draft, t, deps);

      expect(out.status).toBe("ADOPTED_EXISTING");
      expect(calls.post, "the comment was already there; posting again duplicates it").toBe(0);
      expect(controlBusStanding(persisted(root)).standing("ESC-900")).toBe("OPEN");
    });
  });

  it("is idempotent once a proof is durable", async () => {
    await withStore(async (root, state) => {
      const first = transport();
      await transmitAndCommit(storePaths(root), state, draft, first.t, deps);

      const again = transport();
      const out = await transmitAndCommit(storePaths(root), state, draft, again.t, deps);

      expect(out.status).toBe("ALREADY_PROVEN");
      expect(again.calls).toEqual({ find: 0, post: 0, readBack: 0 });
      expect(persisted(root).outbox).toHaveLength(1);
    });
  });

  it("refuses to write state while a live watcher holds the lock", async () => {
    // The watcher owns state.json. Rather than invent a second lock protocol, this fails closed —
    // and writing out of band is the one thing that could corrupt a poll cycle mid-rename.
    await withStore(async (root, state) => {
      writeFileSync(
        join(root, "watcher.lock.json"),
        JSON.stringify({ pid: process.pid + 1, startedAt: deps.now(), nonce: "n" }),
        "utf8",
      );
      const { t, calls } = transport();
      // Only meaningful if that pid is actually alive; otherwise the control proves nothing.
      let alive = true;
      try {
        process.kill(process.pid + 1, 0);
      } catch {
        alive = false;
      }
      const out = await transmitAndCommit(storePaths(root), state, draft, t, deps);
      if (!alive) {
        expect(out.status, "a dead pid must not block").not.toBe("REFUSED");
        return;
      }
      expect(out.status).toBe("REFUSED");
      expect(out.status === "REFUSED" && out.reason).toMatch(/live watcher/);
      expect(calls.post).toBe(0);
      expect(persisted(root).outbox).toHaveLength(0);
    });
  });

  it("proceeds when the lock is stale rather than live", async () => {
    await withStore(async (root, state) => {
      writeFileSync(
        join(root, "watcher.lock.json"),
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date(deps.nowMs() - 45_000 * 4).toISOString(),
          nonce: "n",
        }),
        "utf8",
      );
      const { t } = transport();
      const out = await transmitAndCommit(storePaths(root), state, { ...draft }, t, deps);
      expect(out.status).toBe("COMMITTED");
    });
  });

  it("writes nothing at all when it refuses on the lock", async () => {
    await withStore(async (root, state) => {
      writeFileSync(
        join(root, "watcher.lock.json"),
        JSON.stringify({ pid: process.pid + 1, startedAt: deps.now(), nonce: "n" }),
        "utf8",
      );
      let alive = true;
      try {
        process.kill(process.pid + 1, 0);
      } catch {
        alive = false;
      }
      if (!alive) return;
      const { t } = transport();
      await transmitAndCommit(storePaths(root), state, draft, t, deps);
      expect(existsSync(join(root, "outbox.jsonl"))).toBe(false);
    });
  });
});
