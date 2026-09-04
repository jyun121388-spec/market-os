import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  transmitAndCommit,
  type OutboundDeps,
  type OutboundTransport,
} from "@/server/controlbus/outbound";
import {
  bodyDigest,
  CONTROL_BUS_REPOSITORY,
  emptyState,
  isTransmitted,
  type ControlBusState,
} from "@/server/controlbus/state";
import { storePaths, writeState } from "@/server/controlbus/store";
import { processStart, selfIdentity } from "@/server/controlbus/owner";

/**
 * IR-125: the outbound path must own the publication BEFORE it publishes.
 *
 * The lifecycle took the canonical write authority only at commit, after the network round trip.
 * A foreign watcher arriving during the POST left an externally visible comment with no local
 * record, and the CLI — truthfully describing the local store — printed "nothing written". The
 * operator posted again. Reproduced on the exact tree before repair with the seam below: a live
 * foreign lock installed inside `find` gave `posts === 1, outbox.length === 0`.
 *
 * The invariant these controls bind, in the order the code now runs it:
 *
 *     canonical authority -> durable intent -> replay discrimination (`find`) -> POST
 *         -> exact read-back -> durable proof, fenced by the intent's nonce
 *
 * WHAT "AUTHORITY" MEANS HERE, because a Codex read-only review (finding 4) asked. The authority is
 * the right to write `state.json`. It is held for microseconds at BEGIN to write the intent and
 * again at COMMIT to write the proof; it is never held across the network, because the watcher's
 * heartbeat needs the same right and EXITS if it cannot get it. The durable, fenced intent is the
 * transferable publication authorisation: a foreign watcher that takes the LOCK after BEGIN does
 * not revoke it, the POST still happens, the commit is then refused, and the outcome says
 * POSTED_UNRECORDED with the comment id. The next attempt finds and adopts. Zero duplicates, and
 * never a comment without a local record — which is the property the incident lacked.
 *
 * Every control runs the PRODUCTION `transmitAndCommit`; nothing here re-implements the algorithm.
 */

const ISSUE = 2;
const NOW = "2026-09-04T00:00:00.000Z";
const BODY = "[ESCALATION][ESC-990]\n\nA question.";
const DRAFT = { protocolId: "ESC-990", kind: "ESCALATION" as const, body: BODY, composedAt: NOW };
const REMOTE = {
  commentId: 4300,
  body: BODY,
  repository: CONTROL_BUS_REPOSITORY,
  issueNumber: ISSUE,
};
const EXPECT = { repository: CONTROL_BUS_REPOSITORY, issueNumber: ISSUE };
const GONE_PID = 2_147_483_647;

/** Read once: on Windows every identity question spawns PowerShell (~450ms measured). */
let cachedSelf: ReturnType<typeof selfIdentity> | undefined;
const me = () => (cachedSelf === undefined ? (cachedSelf = selfIdentity()) : cachedSelf);

const kids: ChildProcess[] = [];
afterEach(() => {
  for (const kid of kids.splice(0)) if (kid.exitCode === null) kid.kill();
});

/** A real, separately scheduled process, waited for by yielding — never by blocking the loop. */
async function liveChild(): Promise<ChildProcess> {
  const kid = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" });
  kids.push(kid);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !("startedAt" in processStart(kid.pid!))) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return kid;
}

function deps(over: Partial<OutboundDeps> = {}): OutboundDeps {
  return {
    now: () => NOW,
    heartbeatStaleMs: 45_000,
    nowMs: () => Date.parse(NOW),
    claim: { pid: process.pid, startedAt: NOW, nonce: "ours", owner: me() ?? undefined },
    attemptNonce: "attempt-1",
    ...over,
  };
}

/** Counts every call, so "did it post" is a fact and not an inference from the outcome. */
function transport(over: Partial<OutboundTransport> = {}) {
  const calls = { find: 0, post: 0, readBack: 0 };
  const t: OutboundTransport = {
    find: async () => {
      calls.find += 1;
      return null;
    },
    post: async () => {
      calls.post += 1;
      return { commentId: REMOTE.commentId };
    },
    readBack: async () => {
      calls.readBack += 1;
      return REMOTE;
    },
    ...over,
  };
  return { t, calls };
}

async function withStore<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "exactly-once-"));
  try {
    writeState(storePaths(root), emptyState(ISSUE));
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const persisted = (root: string) =>
  JSON.parse(readFileSync(join(root, "state.json"), "utf8")) as ControlBusState;
const lockFile = (root: string) => join(root, "watcher.lock.json");
const foreignLive = () =>
  JSON.stringify({ pid: process.pid, startedAt: NOW, nonce: "a-foreign-watcher", owner: me() });
const proven = (root: string) => persisted(root).outbox.filter((e) => isTransmitted(e, EXPECT));
const unproven = (root: string) => persisted(root).outbox.filter((e) => !isTransmitted(e, EXPECT));

describe("IR-125: authority before the POST", () => {
  it("A: with a live foreign owner present, the POST is provably uncalled", async () => {
    await withStore(async (root) => {
      writeFileSync(lockFile(root), foreignLive(), "utf8");
      const { t, calls } = transport();
      const out = await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, t, deps());
      expect(out.status).toBe("REFUSED");
      expect(out.status === "REFUSED" && out.remoteSideEffect).toBe("NONE");
      expect(calls.post, "no POST without the canonical write authority").toBe(0);
      expect(calls.find, "not even a lookup: the transport was never touched").toBe(0);
      expect(persisted(root).outbox, "and nothing was written").toHaveLength(0);
    });
  });

  it("B: with the authority obtained, exactly one publication succeeds", async () => {
    await withStore(async (root) => {
      const { t, calls } = transport();
      const out = await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, t, deps());
      expect(out.status).toBe("COMMITTED");
      expect(calls).toEqual({ find: 1, post: 1, readBack: 1 });
      // ONE entry, carrying the proof AND the intent it was upgraded from — not an intent plus a
      // proof side by side.
      expect(persisted(root).outbox).toHaveLength(1);
      expect(proven(root)).toHaveLength(1);
      expect(proven(root)[0].publication?.attemptNonce).toBe("attempt-1");
    });
  });

  it("writes the intent BEFORE the transport is touched, and releases the right", async () => {
    // The order is the argument. At the moment the transport is first called, a durable intent
    // already exists for this exact digest — and the mutation right has already been released,
    // because a watcher's heartbeat would exit on finding it held.
    await withStore(async (root) => {
      let intentAtFind: number | undefined;
      let rightHeldAtFind: boolean | undefined;
      const { t } = transport({
        find: async () => {
          intentAtFind = unproven(root).filter(
            (e) => e.publication?.attemptNonce === "attempt-1",
          ).length;
          rightHeldAtFind = existsSync(`${lockFile(root)}.mutate`);
          return null;
        },
      });
      await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, t, deps());
      expect(intentAtFind, "the intent must be durable before find()").toBe(1);
      expect(rightHeldAtFind, "the mutation right must not be held across the network").toBe(false);
    });
  });

  it("C: retried after a durable proof exists, makes zero further POSTs", async () => {
    await withStore(async (root) => {
      const first = transport();
      await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, first.t, deps());
      const second = transport();
      const out = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        DRAFT,
        second.t,
        deps({ attemptNonce: "attempt-2" }),
      );
      expect(out.status).toBe("ALREADY_PROVEN");
      expect(second.calls, "no network at all once the proof is durable").toEqual({
        find: 0,
        post: 0,
        readBack: 0,
      });
      expect(persisted(root).outbox).toHaveLength(1);
    });
  });

  it("D: crashed after the POST, before local proof — restart reconciles, never re-posts", async () => {
    // The crash is simulated exactly: the first attempt's process is a real child that is gone by
    // the time of the retry, so its intent is takeable; the comment it posted is on the issue.
    const dead = await liveChild();
    const deadStart = processStart(dead.pid!);
    if (!("startedAt" in deadStart)) throw new Error("the OS could not describe the child");
    dead.kill();
    while (!("gone" in processStart(dead.pid!))) await new Promise((r) => setTimeout(r, 25));

    await withStore(async (root) => {
      // What the crashed attempt left behind: a durable intent owned by a now-absent process.
      const state = emptyState(ISSUE);
      state.outbox.push({
        ...DRAFT,
        publication: {
          attemptNonce: "crashed-attempt",
          owner: { pid: dead.pid!, startedAt: deadStart.startedAt },
          startedAt: NOW,
        },
      });
      writeState(storePaths(root), state);

      // The comment it posted IS on the issue.
      const { t, calls } = transport({ find: async () => REMOTE });
      const out = await transmitAndCommit(storePaths(root), state, DRAFT, t, deps());
      expect(out.status).toBe("ADOPTED_EXISTING");
      expect(calls.post, "a comment that exists is adopted, never re-posted").toBe(0);
      expect(proven(root)).toHaveLength(1);
      expect(
        persisted(root).outbox,
        "the crashed intent was upgraded, not duplicated",
      ).toHaveLength(1);
    });
  });

  it("E: an ambiguous POST that actually landed is discriminated by remote evidence on retry", async () => {
    await withStore(async (root) => {
      // First attempt: post() throws AFTER GitHub created the comment. Counted here, because an
      // override replaces the helper's counting `post`.
      let landed = false;
      let firstPosts = 0;
      const first = transport({
        post: async () => {
          firstPosts += 1;
          landed = true;
          throw new Error("socket hang up");
        },
        find: async () => (landed ? REMOTE : null),
      });
      const out1 = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        DRAFT,
        first.t,
        deps(),
      );
      expect(out1.status).toBe("REFUSED");
      // It cannot know, and it must say so — never "nothing written".
      expect(out1.status === "REFUSED" && out1.remoteSideEffect).toBe("UNKNOWN");
      expect(unproven(root), "the attempt is recorded, without proof").toHaveLength(1);

      // Retry in the same live process: its own abandoned intent must not wedge it, and remote
      // evidence must decide before any POST.
      const second = transport({ find: async () => REMOTE });
      const out2 = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        DRAFT,
        second.t,
        deps({ attemptNonce: "attempt-2" }),
      );
      expect(out2.status).toBe("ADOPTED_EXISTING");
      expect(second.calls.post).toBe(0);
      expect(firstPosts + second.calls.post, "one POST across both attempts").toBe(1);
      expect(persisted(root).outbox).toHaveLength(1);
    });
  });

  it("F: a POST that truly did not happen is retried, and publishes exactly once", async () => {
    await withStore(async (root) => {
      const first = transport({
        find: async () => {
          const error = new Error("rate limited before posting") as Error & { beforePost: boolean };
          error.beforePost = true;
          throw error;
        },
      });
      const out1 = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        DRAFT,
        first.t,
        deps(),
      );
      expect(out1.status).toBe("REFUSED");
      expect(out1.status === "REFUSED" && out1.remoteSideEffect).toBe("NONE");
      expect(first.calls.post).toBe(0);

      const second = transport();
      const out2 = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        DRAFT,
        second.t,
        deps({ attemptNonce: "attempt-2" }),
      );
      expect(out2.status).toBe("COMMITTED");
      expect(second.calls.post).toBe(1);
      expect(proven(root)).toHaveLength(1);
      expect(persisted(root).outbox).toHaveLength(1);
    });
  });

  it("G: a stale intent whose owner is GONE does not wedge the channel", async () => {
    await withStore(async (root) => {
      const state = emptyState(ISSUE);
      state.outbox.push({
        ...DRAFT,
        publication: {
          attemptNonce: "long-dead-attempt",
          owner: { pid: GONE_PID, startedAt: "whenever-it-was" },
          startedAt: "2026-08-01T00:00:00.000Z",
        },
      });
      writeState(storePaths(root), state);
      expect(processStart(GONE_PID), "the fixture premise").toEqual({ gone: true });

      const { t, calls } = transport();
      const out = await transmitAndCommit(storePaths(root), state, DRAFT, t, deps());
      expect(out.status).toBe("COMMITTED");
      expect(calls.post).toBe(1);
      expect(persisted(root).outbox, "taken over in place, not appended beside").toHaveLength(1);
    });
  });

  it("H: an intent held by a genuinely ALIVE foreign process is never replaced", async () => {
    const other = await liveChild();
    const start = processStart(other.pid!);
    if (!("startedAt" in start)) throw new Error("the OS could not describe the child");

    await withStore(async (root) => {
      const state = emptyState(ISSUE);
      state.outbox.push({
        ...DRAFT,
        publication: {
          attemptNonce: "their-attempt",
          owner: { pid: other.pid!, startedAt: start.startedAt },
          startedAt: NOW,
        },
      });
      writeState(storePaths(root), state);
      const before = readFileSync(join(root, "state.json"), "utf8");

      const { t, calls } = transport();
      const out = await transmitAndCommit(storePaths(root), state, DRAFT, t, deps());
      expect(out.status).toBe("REFUSED");
      expect(out.status === "REFUSED" && out.reason).toMatch(/in flight/);
      expect(calls.post).toBe(0);
      expect(readFileSync(join(root, "state.json"), "utf8"), "their intent, byte for byte").toBe(
        before,
      );
    });
  });

  it("I: no refusal may say NONE when a remote write actually occurred", async () => {
    // The incident, replayed against the repaired path: a live foreign watcher takes the lock
    // AFTER the intent is written and before the POST. The POST happens under the transferable
    // intent, the commit is refused, and the outcome must say exactly what is on the issue.
    await withStore(async (root) => {
      const { t, calls } = transport({
        find: async () => {
          writeFileSync(lockFile(root), foreignLive(), "utf8");
          return null;
        },
      });
      const out = await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, t, deps());
      expect(out.status).toBe("REFUSED");
      expect(calls.post).toBe(1);
      expect(out.status === "REFUSED" && out.remoteSideEffect).toBe("POSTED_UNRECORDED");
      expect(out.status === "REFUSED" && out.commentId).toBe(REMOTE.commentId);
      // Never a comment without a local record: the intent stays, naming the digest.
      const left = unproven(root);
      expect(left).toHaveLength(1);
      expect(bodyDigest(left[0].body)).toBe(bodyDigest(BODY));
      expect(
        left[0].publication?.abandonedAt,
        "still in flight, not abandoned: the proof is owed",
      ).toBeUndefined();
    });
  });

  it("I (continued): the same process, retrying, adopts the unrecorded comment once the lock is free", async () => {
    await withStore(async (root) => {
      const first = transport({
        find: async () => {
          writeFileSync(lockFile(root), foreignLive(), "utf8");
          return null;
        },
      });
      await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, first.t, deps());
      rmSync(lockFile(root));

      const second = transport({ find: async () => REMOTE });
      const out = await transmitAndCommit(
        storePaths(root),
        emptyState(ISSUE),
        DRAFT,
        second.t,
        deps({ attemptNonce: "attempt-2" }),
      );
      expect(out.status).toBe("ADOPTED_EXISTING");
      expect(second.calls.post).toBe(0);
      expect(proven(root)).toHaveLength(1);
      expect(persisted(root).outbox).toHaveLength(1);
    });
  });

  it("J: two attempts racing for the same unit produce at most one remote side effect", async () => {
    await withStore(async (root) => {
      // Both attempts are genuinely concurrent: whichever reaches `find` waits there until the
      // other has arrived too — or until a short grace has passed, which is how it learns the other
      // was refused at BEGIN and is never coming. BEGIN is where they must serialise; if they did
      // not, both would reach `find`, both would POST, and the count below would be 2.
      let arrived = 0;
      let release: () => void = () => {};
      const bothArrived = new Promise<void>((r) => (release = r));
      const grace = new Promise<void>((r) => setTimeout(r, 300));
      const mk = () =>
        transport({
          find: async () => {
            arrived += 1;
            if (arrived === 2) release();
            await Promise.race([bothArrived, grace]);
            return null;
          },
        });
      const a = mk();
      const b = mk();
      const [outA, outB] = await Promise.all([
        transmitAndCommit(
          storePaths(root),
          emptyState(ISSUE),
          DRAFT,
          a.t,
          deps({ attemptNonce: "A" }),
        ),
        transmitAndCommit(
          storePaths(root),
          emptyState(ISSUE),
          DRAFT,
          b.t,
          deps({ attemptNonce: "B" }),
        ),
      ]);
      const statuses = [outA.status, outB.status];
      expect(a.calls.post + b.calls.post, "at most one POST").toBeLessThanOrEqual(1);
      expect(arrived, "at most one attempt obtained publication authority").toBe(1);
      expect(
        statuses.filter((s) => s === "REFUSED"),
        "the other was refused at BEGIN",
      ).toHaveLength(1);
      expect(statuses.filter((s) => s === "COMMITTED" || s === "ADOPTED_EXISTING")).toHaveLength(1);
      expect(persisted(root).outbox).toHaveLength(1);
      expect(proven(root)).toHaveLength(1);
    });
  });

  it("preserves everything else in the state file across BEGIN and COMMIT", async () => {
    // Codex finding 5: the intent write must mutate the freshly reloaded state, so a cursor the
    // watcher advanced during the round trip is never regressed by the whole-file write.
    await withStore(async (root) => {
      const { t } = transport({
        find: async () => {
          const s = persisted(root);
          s.lastRemoteCommentId = 9999;
          s.consecutiveFailures = 2;
          writeState(storePaths(root), s);
          return null;
        },
      });
      const out = await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, t, deps());
      expect(out.status).toBe("COMMITTED");
      const after = persisted(root);
      expect(after.lastRemoteCommentId, "the cursor the watcher advanced meanwhile").toBe(9999);
      expect(after.consecutiveFailures).toBe(2);
      expect(after.outbox).toHaveLength(1);
    });
  });

  it("binds the kind through the digest, so (protocolId, digest) is the whole identity", () => {
    // Codex finding 6. `find` keys on (protocolId, digest); the kind tag is the first line of the
    // body, so two bodies that differ only in kind have different digests — and a transport that
    // normalised line endings would fail the read-back digest check rather than pass silently.
    const escalation = "[ESCALATION][ESC-990]\n\nA question.";
    const applied = "[CLAUDE_APPLIED][ESC-990]\n\nA question.";
    expect(bodyDigest(escalation)).not.toBe(bodyDigest(applied));
    expect(bodyDigest(escalation)).not.toBe(bodyDigest(escalation.replace(/\n/g, "\r\n")));
    expect(bodyDigest(escalation)).toBe(bodyDigest(`${escalation}`));
  });

  it("fences the commit on the intent's nonce, so a superseded attempt cannot clobber its successor", async () => {
    // Codex finding 3. Attempt 1 writes its intent and goes to the network. While it is away, a
    // permitted recovery replaces the intent with attempt 2's (what a takeover of a crashed owner
    // does). Attempt 1 comes back with a verified read-back and must NOT write its proof over
    // attempt 2's state: the store still belongs to attempt 2, and attempt 1 is told so.
    await withStore(async (root) => {
      const { t, calls } = transport({
        find: async () => {
          const s = persisted(root);
          const at = s.outbox.findIndex((e) => e.publication?.attemptNonce === "attempt-1");
          s.outbox[at] = {
            ...s.outbox[at],
            publication: { attemptNonce: "attempt-2", owner: me() ?? undefined, startedAt: NOW },
          };
          writeState(storePaths(root), s);
          return null;
        },
      });
      const out = await transmitAndCommit(storePaths(root), emptyState(ISSUE), DRAFT, t, deps());
      expect(calls.post, "attempt 1 did post — the comment exists").toBe(1);
      expect(out.status).toBe("REFUSED");
      expect(out.status === "REFUSED" && out.reason).toMatch(/superseded by attempt attempt-2/);
      expect(out.status === "REFUSED" && out.remoteSideEffect).toBe("POSTED_UNRECORDED");
      const after = persisted(root).outbox;
      expect(after).toHaveLength(1);
      expect(after[0].publication?.attemptNonce, "attempt 2 still owns the record").toBe(
        "attempt-2",
      );
      expect(after[0].transmission, "and no proof was written over it").toBeUndefined();
    });
  });
});
