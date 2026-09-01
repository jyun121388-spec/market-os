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
    claim: { pid: process.pid, startedAt: "2026-09-02T00:00:00.000Z", nonce: "outbound-run" },
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
          claim: { pid: process.pid, startedAt: "2026-09-02T00:00:00.000Z", nonce: "outbound-run" },
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

/**
 * THE AWAIT GAP, which is where the serialisation actually lives.
 *
 * The first version checked the watcher lock once, went away for a network round trip, and then
 * wrote the state object it had captured before leaving. Review was right that a snapshot test is
 * not a serialisation primitive: `store.ts` says in its own header that atomic rename gives content
 * atomicity and never writer exclusion.
 *
 * Two things can happen in that gap and both are exercised here by mutating the store from inside
 * the fake `readBack` — which is exactly when a real network call would be in flight.
 */
describe("what happens while the remote call is in flight", () => {
  const BODY = "[ESCALATION][ESC-901]\n\nA question.";
  const ISSUE = 2;
  const OURS = { pid: process.pid, startedAt: "2026-09-02T00:00:00.000Z", nonce: "ours" };

  const deps: OutboundDeps = {
    now: () => "2026-09-02T00:00:00.000Z",
    heartbeatStaleMs: 45_000,
    nowMs: () => Date.parse("2026-09-02T00:00:00.000Z"),
    claim: OURS,
  };

  const draft = {
    protocolId: "ESC-901",
    kind: "ESCALATION" as const,
    body: BODY,
    composedAt: "2026-09-01T23:59:00.000Z",
  };

  const ref = {
    commentId: 777,
    body: BODY,
    repository: CONTROL_BUS_REPOSITORY,
    issueNumber: ISSUE,
  };

  const withStore = async <T>(fn: (root: string, state: ControlBusState) => Promise<T>) => {
    const root = mkdtempSync(join(tmpdir(), "control-bus-interleave-"));
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

  /** A transport that runs `duringAwait` at the moment the read-back would be outstanding. */
  const interleaving = (duringAwait: () => void) => {
    const calls = { post: 0 };
    return {
      calls,
      transport: {
        find: async () => null,
        post: async () => {
          calls.post += 1;
          return { commentId: ref.commentId };
        },
        readBack: async () => {
          duringAwait();
          return ref;
        },
      } as OutboundTransport,
    };
  };

  const writeLock = (root: string, pid: number, nonce: string) =>
    writeFileSync(
      join(root, "watcher.lock.json"),
      JSON.stringify({ pid, startedAt: "2026-09-02T00:00:00.000Z", nonce }),
      "utf8",
    );

  it("writes nothing when a watcher takes ownership during the await", async () => {
    // Absent at the first check, live and foreign by commit time. The pre-flight cannot see this;
    // only the commit-time authority can.
    await withStore(async (root, state) => {
      const { transport, calls } = interleaving(() => writeLock(root, process.pid, "the-watcher"));
      const out = await transmitAndCommit(storePaths(root), state, draft, transport, deps);

      expect(out.status).toBe("REFUSED");
      expect(calls.post, "the comment was posted before ownership changed").toBe(1);
      expect(persisted(root).outbox, "nothing may be written without authority").toHaveLength(0);
    });
  });

  it("does not treat a different lease with the same pid as itself", async () => {
    // The pid-only shortcut this replaced would accept this: same process, different run. The
    // nonce is what `acquireLock` already treats as the sufficient identity.
    await withStore(async (root, state) => {
      const { transport } = interleaving(() => writeLock(root, OURS.pid, "a-different-lease"));
      const out = await transmitAndCommit(storePaths(root), state, draft, transport, deps);
      expect(out.status).toBe("REFUSED");
      expect(out.status === "REFUSED" && out.reason).toMatch(/ownership changed|live watcher/);
      expect(persisted(root).outbox).toHaveLength(0);
    });
  });

  it("proceeds when the lease that appeared is our own", async () => {
    // The other side of the same control: if refusing were unconditional, the two above would pass
    // for the wrong reason and this module could never write at all.
    await withStore(async (root, state) => {
      const { transport } = interleaving(() => writeLock(root, OURS.pid, OURS.nonce));
      const out = await transmitAndCommit(storePaths(root), state, draft, transport, deps);
      expect(out.status).toBe("COMMITTED");
      expect(persisted(root).outbox).toHaveLength(1);
    });
  });

  it("never regresses state the watcher advanced while we were away", async () => {
    // A -> B during the await. The captured object still says A; writing it back would silently
    // undo a cursor advance and a durably stored decision, which is the worse half of the finding.
    await withStore(async (root, state) => {
      const { transport } = interleaving(() => {
        const advanced = persisted(root);
        advanced.lastRemoteCommentId = 4242;
        advanced.inbox.push({
          protocolId: "ESC-INBOUND",
          githubCommentId: 4242,
          receivedAt: "2026-09-02T00:04:00.000Z",
          author: "jyun121388-spec",
          body: "arrived while we were posting",
          status: "RECEIVED_UNVALIDATED",
        });
        writeState(storePaths(root), advanced);
      });

      const out = await transmitAndCommit(storePaths(root), state, draft, transport, deps);
      expect(out.status).toBe("COMMITTED");

      const after = persisted(root);
      expect(after.lastRemoteCommentId, "the cursor was regressed to the captured snapshot").toBe(
        4242,
      );
      expect(after.inbox.map((e) => e.protocolId)).toEqual(["ESC-INBOUND"]);
      expect(after.outbox).toHaveLength(1);
      expect(after.outbox[0].transmission?.commentId).toBe(ref.commentId);
    });
  });

  it("adopts rather than re-posts after a refused commit", async () => {
    // The remote comment exists and the local write was refused. A retry must find it by digest and
    // record it under authority — never post a second one to compensate.
    await withStore(async (root, state) => {
      const blocked = interleaving(() => writeLock(root, OURS.pid, "the-watcher"));
      expect(
        (await transmitAndCommit(storePaths(root), state, draft, blocked.transport, deps)).status,
      ).toBe("REFUSED");

      rmSync(join(root, "watcher.lock.json"));
      let posts = 0;
      const retry: OutboundTransport = {
        find: async () => ref,
        post: async () => {
          posts += 1;
          return { commentId: 999 };
        },
        readBack: async () => ref,
      };
      const out = await transmitAndCommit(storePaths(root), state, draft, retry, deps);

      expect(out.status).toBe("ADOPTED_EXISTING");
      expect(posts, "a refused local commit must never cause a second comment").toBe(0);
      expect(controlBusStanding(persisted(root)).standing("ESC-901")).toBe("OPEN");
    });
  });
});

/**
 * The window between winning the write right and reading ownership back.
 *
 * It is microseconds wide, contains no await, and nothing in the fixtures above could open it — so
 * `M-AUTH-NO-RECHECK` came back MISSED and the branch guarding it was, in effect, an assertion
 * about itself. Rather than delete a defence the review explicitly asked for, `store.ts` grew a
 * seam that fires exactly there, so the branch is exercised for the reason it exists.
 */
describe("ownership replaced between taking the write right and reading it back", () => {
  const ISSUE = 2;
  const BODY = "[ESCALATION][ESC-902]\n\nA question.";
  const OURS = { pid: process.pid, startedAt: "2026-09-02T00:00:00.000Z", nonce: "ours" };

  it("fails closed and writes nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "control-bus-window-"));
    try {
      writeState(storePaths(root), emptyState(ISSUE));
      const deps: OutboundDeps = {
        now: () => "2026-09-02T00:00:00.000Z",
        heartbeatStaleMs: 45_000,
        nowMs: () => Date.parse("2026-09-02T00:00:00.000Z"),
        claim: OURS,
        afterRightTaken: () =>
          writeFileSync(
            join(root, "watcher.lock.json"),
            JSON.stringify({
              pid: process.pid,
              startedAt: "2026-09-02T00:00:00.000Z",
              nonce: "a-successor",
            }),
            "utf8",
          ),
      };
      const out = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        { protocolId: "ESC-902", kind: "ESCALATION", body: BODY, composedAt: deps.now() },
        {
          find: async () => null,
          post: async () => ({ commentId: 4242 }),
          readBack: async () => ({
            commentId: 4242,
            body: BODY,
            repository: CONTROL_BUS_REPOSITORY,
            issueNumber: ISSUE,
          }),
        },
        deps,
      );

      expect(out.status).toBe("REFUSED");
      expect(out.status === "REFUSED" && out.reason).toMatch(/ownership changed/);
      const after = JSON.parse(readFileSync(join(root, "state.json"), "utf8")) as ControlBusState;
      expect(after.outbox).toHaveLength(0);
      expect(existsSync(join(root, "outbox.jsonl"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * THE SCREEN BELONGS TO THE OPERATION, NOT TO ONE CALLER.
 *
 * `CLAUDE.md`: "Everything outbound passes `screenPublicComment` first; issue #2 is publicly
 * readable." It did — in `post-outbound.ts`. The lifecycle that actually posts did not screen at
 * all, so the guarantee held for the CLI and not for the operation, and a second caller or a
 * refactor of the first would have published unscreened with nothing to notice. Same one-sided
 * invariant this branch keeps finding, this time in a module written two units earlier.
 *
 * The fixture secrets below are shaped to match the rules and are not real: `ghp_` followed by
 * filler, and a connection string with an obviously fake password.
 */
describe("screening, inside the lifecycle rather than beside it", () => {
  const ISSUE = 2;
  const deps: OutboundDeps = {
    now: () => "2026-09-02T00:00:00.000Z",
    heartbeatStaleMs: 45_000,
    nowMs: () => Date.parse("2026-09-02T00:00:00.000Z"),
    claim: { pid: process.pid, startedAt: "2026-09-02T00:00:00.000Z", nonce: "screen-run" },
  };

  const attempt = async (body: string) => {
    const root = mkdtempSync(join(tmpdir(), "control-bus-screen-"));
    try {
      writeState(storePaths(root), emptyState(ISSUE));
      const calls = { find: 0, post: 0, readBack: 0 };
      const t: OutboundTransport = {
        find: async () => {
          calls.find += 1;
          return null;
        },
        post: async () => {
          calls.post += 1;
          return { commentId: 5150 };
        },
        readBack: async () => {
          calls.readBack += 1;
          return { commentId: 5150, body, repository: CONTROL_BUS_REPOSITORY, issueNumber: ISSUE };
        },
      };
      const out = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        { protocolId: "ESC-903", kind: "ESCALATION", body, composedAt: deps.now() },
        t,
        deps,
      );
      const state = JSON.parse(readFileSync(join(root, "state.json"), "utf8")) as ControlBusState;
      return {
        out,
        calls,
        outbox: state.outbox.length,
        logged: existsSync(join(root, "outbox.jsonl")),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("refuses a body the screen rejects, before touching the transport", async () => {
    const { out, calls, outbox, logged } = await attempt(
      "[ESCALATION][ESC-903]\n\nuse token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA to reproduce",
    );
    expect(out.status).toBe("REFUSED");
    expect(out.status === "REFUSED" && out.reason).toMatch(/public screen/);
    // Not even `find`. An unscreened body should not reach the network to be compared with
    // anything, let alone posted.
    expect(calls).toEqual({ find: 0, post: 0, readBack: 0 });
    expect(outbox).toBe(0);
    expect(logged).toBe(false);
  });

  it("names the category and line, so the finding is actionable without a search", async () => {
    const { out } = await attempt(
      "[ESCALATION][ESC-903]\n\nfirst line is fine\npostgres://user:hunter2@db.example/market",
    );
    expect(out.status === "REFUSED" && out.reason).toMatch(/CONNECTION_STRING at line 4/);
  });

  it("still posts a clean body, so the refusal is not unconditional", async () => {
    const { out, calls, outbox } = await attempt("[ESCALATION][ESC-903]\n\nan ordinary question.");
    expect(out.status).toBe("COMMITTED");
    expect(calls).toEqual({ find: 1, post: 1, readBack: 1 });
    expect(outbox).toBe(1);
  });
});
