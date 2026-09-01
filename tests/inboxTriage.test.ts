import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { bodyDigest } from "@/server/controlbus/state";
import {
  controlBusStanding,
  foreignRepositories,
  type GitOracle,
  type IdStanding,
  localGit,
  NO_ID_AUTHORITY,
  type OpenIdAuthority,
  THIS_REPOSITORY,
  triageEntry,
} from "../scripts/inbox-triage";

/**
 * Triaging the durable inbox is the mechanical half of a rule `CLAUDE.md` states and nothing
 * enforced: a decision is not applied on sight, and a stale one is answered with
 * `[ESCALATION_REFRESH_REQUIRED]` rather than guessed at.
 *
 * The property these controls exist for is negative. UNVERIFIABLE must never collapse into CURRENT
 * — an anchor missing from the local object store may be a branch nobody fetched, and "I cannot
 * check" reading as "it checks out" is precisely how a stale decision gets applied.
 */
describe("triaging an unjudged decision", () => {
  const HEAD = "3e2c1bf3e7de9ef570a6eeac45271b74c9740e0e";

  /** Only the named commits exist; distances are whatever the fixture says. */
  const oracle = (known: Record<string, number | null>): GitOracle => ({
    isCommit: (sha) => sha in known,
    distanceToHead: (sha) => known[sha] ?? null,
    head: () => HEAD,
  });

  /**
   * Holds the id question constant so the controls below are about ANCHORS only. The standing
   * question gets its own block, where the anchors are held constant instead.
   */
  const OPEN: OpenIdAuthority = {
    source: () => "test double: ESC-999 is open",
    standing: () => "OPEN",
  };

  const entry = (body: string) => ({
    protocolId: "ESC-999",
    receivedAt: "2026-08-21T00:00:00.000Z",
    githubCommentId: 1,
    body,
  });

  it("calls a decision anchored to an ancestor stale, with the distance", () => {
    const row = triageEntry(entry("reviewed head: `abc1234`"), oracle({ abc1234: 211 }), OPEN);
    expect(row.anchorVerdict).toBe("STALE_REFRESH_REQUIRED");
    expect(row.detail).toContain("211");
  });

  it("calls a decision anchored to HEAD current", () => {
    const row = triageEntry(entry(`reviewed head: \`${HEAD}\``), oracle({ [HEAD]: 0 }), OPEN);
    expect(row.anchorVerdict).toBe("CURRENT");
  });

  it("refuses to judge an anchor this repository does not have", () => {
    // THE control. The commit is well formed and simply absent; nothing about that is reassuring.
    const row = triageEntry(entry("reviewed head: `deadbee`"), oracle({}), OPEN);
    expect(row.anchorVerdict).toBe("ANCHOR_UNVERIFIABLE");
    expect(row.anchors).toEqual([{ sha: "deadbee", resolved: false }]);
  });

  it("refuses to judge an anchor on a divergent line rather than calling it a distance", () => {
    // Resolves, but is not an ancestor. `rev-list --count` would still return a number, and that
    // number would mean something else entirely.
    const row = triageEntry(entry("reviewed head: `abc1234`"), oracle({ abc1234: null }), OPEN);
    expect(row.anchorVerdict).toBe("ANCHOR_UNVERIFIABLE");
    expect(row.detail).toContain("divergent");
  });

  it("uses the NEAREST anchor when a body names several", () => {
    // These packets cite a chain of commits. Judging by whichever appeared first in the prose would
    // report a staleness that depends on sentence order.
    const row = triageEntry(
      entry("parent `aaaaaaa`, then `bbbbbbb`, head `ccccccc`"),
      oracle({ aaaaaaa: 200, bbbbbbb: 12, ccccccc: 90 }),
      OPEN,
    );
    expect(row.anchorVerdict).toBe("STALE_REFRESH_REQUIRED");
    expect(row.detail).toContain("12 commit(s)");
  });

  it("says a body with no anchor cannot be judged for staleness", () => {
    const row = triageEntry(entry("please proceed as discussed"), oracle({}), OPEN);
    expect(row.anchorVerdict).toBe("NO_ANCHOR");
  });

  it("does not invent an anchor out of short hex in prose", () => {
    // `deadbe` is six. Below seven this pattern matches ordinary words and every decision would
    // arrive carrying imaginary anchors.
    expect(triageEntry(entry("see item deadbe"), oracle({}), OPEN).anchorVerdict).toBe("NO_ANCHOR");
  });

  it("routes a decision that names another repository away from here", () => {
    const row = triageEntry(entry("apply in github.com/other-owner/other-repo"), oracle({}), OPEN);
    expect(row.anchorVerdict).toBe("NOT_THIS_REPOSITORY");
    expect(row.detail).toContain("other-owner/other-repo");
  });

  it("does not read a path fragment as a repository", () => {
    // `src/server` and `docs/ARCHITECTURE.md` are in almost every packet. Treating any `a/b` as a
    // repository slug would route the entire inbox to NOT_THIS_REPOSITORY and look decisive.
    expect(foreignRepositories("touch src/server and docs/ARCHITECTURE.md")).toEqual([]);
    expect(foreignRepositories(`repo: ${THIS_REPOSITORY}`)).toEqual([]);
    expect(foreignRepositories("github.com/someone/else")).toEqual(["someone/else"]);
  });
});

/**
 * The oracle above is a fixture; this asserts the real one agrees with git about this very tree.
 * Without it the whole module could be exercising a self-consistent fiction.
 */
describe("the git oracle it actually runs against", () => {
  const git = localGit();

  it("resolves HEAD and knows its own first parent is an ancestor", () => {
    const head = git.head();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(git.isCommit(head)).toBe(true);
    expect(git.distanceToHead(head)).toBe(0);
  });

  it("refuses a well-formed sha that is not in the object store", () => {
    expect(git.isCommit("0123456789abcdef0123456789abcdef01234567")).toBe(false);
  });
});

/**
 * AN UNJUDGED ROW IS NOT AN OPEN ID, which is the half the first version of this module skipped.
 *
 * Its own governing rule names three independent facts — targets this repository, matches an OPEN
 * id, is not stale — and it mechanised the first and the third. `protocolId` went from input to
 * output untouched, so a closed or never-open decision earned `STALE_REFRESH_REQUIRED` from its
 * commit anchors alone. Reproduced against the committed implementation before repairing, with a
 * state that records the id as APPLIED:
 *
 *     before   STALE_REFRESH_REQUIRED   nearest anchor is 3 commit(s) behind HEAD
 *     after    NOT_ACTIONABLE           ALREADY_JUDGED / STALE_REFRESH_REQUIRED
 *
 * Every control here holds the BODY AND ANCHORS IDENTICAL and varies only the standing, so nothing
 * can pass because the anchor logic happened to refuse.
 */
describe("whether the protocol id is one this repository still has open", () => {
  const HEAD = "3e2c1bf3e7de9ef570a6eeac45271b74c9740e0e";
  const STALE = "abc1234";

  const git: GitOracle = {
    isCommit: (sha) => sha === STALE || sha === HEAD,
    distanceToHead: (sha) => (sha === HEAD ? 0 : 7),
    head: () => HEAD,
  };

  const standingOf = (s: IdStanding): OpenIdAuthority => ({
    source: () => `test double: ${s}`,
    standing: () => s,
  });

  const row = (body: string, s: OpenIdAuthority) =>
    triageEntry(
      { protocolId: "ESC-555", receivedAt: "2026-08-21T00:00:00.000Z", githubCommentId: 1, body },
      git,
      s,
    );

  const stale = `reviewed head: \`${STALE}\``;
  const current = `reviewed head: \`${HEAD}\``;

  it("asks for a refresh only when the id is open and the anchor is behind", () => {
    const r = row(stale, standingOf("OPEN"));
    expect(r.anchorVerdict).toBe("STALE_REFRESH_REQUIRED");
    expect(r.disposition).toBe("REFRESH_REQUIRED");
  });

  it("calls an open decision anchored to HEAD runnable", () => {
    const r = row(current, standingOf("OPEN"));
    expect(r.disposition).toBe("RUNNABLE");
  });

  it("refuses a judged id whatever its anchor says", () => {
    // The reproduction, as a control. Identical bodies to the two above; only the standing moved,
    // and staleness must not promote an id that had no standing to begin with.
    for (const body of [stale, current]) {
      const r = row(body, standingOf("ALREADY_JUDGED"));
      expect(r.disposition, `${body} must not be actionable`).toBe("NOT_ACTIONABLE");
      expect(r.detail).toContain("already judged");
    }
    // And the anchor answer is still reported rather than flattened away, so the row stays legible.
    expect(row(current, standingOf("ALREADY_JUDGED")).anchorVerdict).toBe("CURRENT");
  });

  it("refuses an id whose standing it could not establish", () => {
    for (const body of [stale, current]) {
      expect(row(body, standingOf("STANDING_UNVERIFIABLE")).disposition).toBe("NOT_ACTIONABLE");
    }
  });

  it("refuses everything when no authority is available at all", () => {
    // The fail-closed default, and the direction matters: an unavailable authority must never be
    // read as "then presumably it is open".
    expect(row(current, NO_ID_AUTHORITY).disposition).toBe("NOT_ACTIONABLE");
    expect(row(current, NO_ID_AUTHORITY).standing).toBe("STANDING_UNVERIFIABLE");
    expect(NO_ID_AUTHORITY.source()).toMatch(/none/);
  });

  it("keeps a foreign repository non-actionable even for an open id", () => {
    const r = row("apply in github.com/other-owner/other-repo", standingOf("OPEN"));
    expect(r.anchorVerdict).toBe("NOT_THIS_REPOSITORY");
    expect(r.disposition).toBe("NOT_ACTIONABLE");
  });
});

/**
 * The real authority, against the canonical schema rather than a double.
 */
describe("reading open standing out of the control-bus state", () => {
  it("treats a terminal inbox status as judged, however many unjudged rows repeat the id", () => {
    // A historical id must not re-enter through a stale row, so judged beats open deliberately.
    const a = controlBusStanding({
      inbox: [
        { protocolId: "ESC-1", status: "APPLIED" },
        { protocolId: "ESC-1", status: "RECEIVED_UNVALIDATED" },
      ],
      outbox: [{ protocolId: "ESC-1", kind: "ESCALATION" }],
    });
    expect(a.standing("ESC-1")).toBe("ALREADY_JUDGED");
  });

  it("counts an escalation READ BACK from the remote issue as what makes an id open", () => {
    const a = controlBusStanding({
      inbox: [],
      issueNumber: 2,
      outbox: [
        {
          protocolId: "ESC-2",
          kind: "ESCALATION",
          body: "ask",
          composedAt: "2026-09-01T00:00:00Z",
          transmission: {
            repository: THIS_REPOSITORY,
            issueNumber: 2,
            commentId: 5495740285,
            bodyDigest: bodyDigest("ask"),
            readBackAt: "2026-09-01T00:00:01Z",
          },
        },
      ],
    });
    expect(a.standing("ESC-2")).toBe("OPEN");
  });

  it("treats a CLAUDE_APPLIED posted from here as closing the id", () => {
    const a = controlBusStanding({
      inbox: [],
      outbox: [
        { protocolId: "ESC-3", kind: "ESCALATION" },
        { protocolId: "ESC-3", kind: "CLAUDE_APPLIED" },
      ],
    });
    expect(a.standing("ESC-3")).toBe("ALREADY_JUDGED");
  });

  it("does not make an id open just by sitting unjudged in the inbox", () => {
    // THE control for this half. `RECEIVED_UNVALIDATED` says the watcher wrote something down and
    // nobody judged it — a fact about this machine, not about an outstanding question.
    const a = controlBusStanding({
      inbox: [{ protocolId: "ESC-4", status: "RECEIVED_UNVALIDATED" }],
      outbox: [],
    });
    expect(a.standing("ESC-4")).toBe("STANDING_UNVERIFIABLE");
  });

  it("says nothing about an id it has never seen, and says which record it consulted", () => {
    const a = controlBusStanding({ inbox: [], outbox: [] });
    expect(a.standing("ESC-NEVER")).toBe("STANDING_UNVERIFIABLE");
    expect(a.source()).toContain("control-bus state");
  });

  it("survives a state with neither collection present", () => {
    expect(controlBusStanding({}).standing("ESC-5")).toBe("STANDING_UNVERIFIABLE");
  });
});

/**
 * A COMPOSED ESCALATION IS NOT A SENT ONE, which is where the open-id authority was still wrong.
 *
 * An outbox row is written locally. `OutboxEntry.transmittedCommentId` is the canonical marker that
 * the comment exists remotely, and its own doc says it is "set once a read-back proves the comment
 * exists remotely. Never set on a successful POST." The first authority accepted any `ESCALATION`
 * row, so a queued, failed or never-sent escalation granted OPEN standing and promoted an incoming
 * decision to RUNNABLE. Reproduced against the committed implementation before repairing:
 *
 *     standing    OPEN
 *     disposition RUNNABLE
 *
 * `CLAUDE.md` states the invariant in as many words — `REMOTE_POST_NOT_CONFIRMED =>
 * CHATGPT_NOT_YET_NOTIFIED` — and the authority built to enforce openness ignored it.
 *
 * Every control here holds the protocol id, body and commit anchor CONSTANT and varies only the
 * transmission evidence.
 */
describe("whether an escalation was ever actually sent", () => {
  const HEAD = "2222222222222222222222222222222222222222";
  const OLD = "bbbbbbb";
  const git: GitOracle = {
    isCommit: (sha) => sha === HEAD || sha === OLD,
    distanceToHead: (sha) => (sha === HEAD ? 0 : 40),
    head: () => HEAD,
  };

  const BODY = "the escalation body";

  /** A proof for BODY, with any single field bent out of shape. */
  const proof = (over: Record<string, unknown> = {}) => ({
    repository: THIS_REPOSITORY,
    issueNumber: 2,
    commentId: 5495740285,
    bodyDigest: bodyDigest(BODY),
    readBackAt: "2026-09-01T00:00:01Z",
    ...over,
  });

  const escalated = (transmission?: Record<string, unknown>) =>
    controlBusStanding({
      issueNumber: 2,
      inbox: [],
      outbox: [
        {
          protocolId: "ESC-T",
          kind: "ESCALATION",
          body: BODY,
          composedAt: "2026-09-01T00:00:00Z",
          ...(transmission ? { transmission } : {}),
        } as never,
      ],
    });

  const at = (sha: string, ids: OpenIdAuthority) =>
    triageEntry(
      {
        protocolId: "ESC-T",
        receivedAt: "2026-09-01T00:00:00.000Z",
        githubCommentId: 1,
        body: `reviewed head: \`${sha}\``,
      },
      git,
      ids,
    );

  it("refuses to call a queued escalation evidence of an open question", () => {
    // THE control, and the reproduction. Same id, same body, same anchor as the positive below.
    const r = at(HEAD, escalated());
    expect(r.standing).toBe("STANDING_UNVERIFIABLE");
    expect(r.disposition).toBe("NOT_ACTIONABLE");
  });

  it("accepts one that was read back, and then lets the anchor decide", () => {
    expect(at(HEAD, escalated(proof())).standing).toBe("OPEN");
    expect(at(HEAD, escalated(proof())).disposition).toBe("RUNNABLE");
    // The two axes stay independent: same standing, older anchor, different disposition.
    expect(at(OLD, escalated(proof())).disposition).toBe("REFRESH_REQUIRED");
  });

  it("does not accept a malformed comment id as a read-back", () => {
    for (const commentId of [0, -1, 1.5, "5495740285", null, true, {}, NaN]) {
      expect(
        escalated(proof({ commentId })).standing("ESC-T"),
        `${String(commentId)} is not a comment id`,
      ).toBe("STANDING_UNVERIFIABLE");
    }
  });

  it("does not accept a proof bound to another repository, issue or body", () => {
    // Each field of the binding, bent one at a time. A bare comment id could be attached to any of
    // these and the previous rule would have taken it.
    expect(escalated(proof({ repository: "someone/else" })).standing("ESC-T")).toBe(
      "STANDING_UNVERIFIABLE",
    );
    expect(escalated(proof({ issueNumber: 3 })).standing("ESC-T")).toBe("STANDING_UNVERIFIABLE");
    expect(escalated(proof({ bodyDigest: bodyDigest("a different body") })).standing("ESC-T")).toBe(
      "STANDING_UNVERIFIABLE",
    );
    // And the intact proof still passes, so the controls above are not all failing for one reason.
    expect(escalated(proof()).standing("ESC-T")).toBe("OPEN");
  });

  it("refuses every proof when the state names no canonical issue", () => {
    const noIssue = controlBusStanding({
      inbox: [],
      outbox: [
        {
          protocolId: "ESC-T",
          kind: "ESCALATION",
          body: BODY,
          composedAt: "2026-09-01T00:00:00Z",
          transmission: proof(),
        } as never,
      ],
    });
    expect(noIssue.standing("ESC-T")).toBe("STANDING_UNVERIFIABLE");
  });

  it("still lets a judged id beat a transmitted escalation", () => {
    const a = controlBusStanding({
      issueNumber: 2,
      inbox: [{ protocolId: "ESC-T", status: "REJECTED" }],
      outbox: [
        {
          protocolId: "ESC-T",
          kind: "ESCALATION",
          body: BODY,
          composedAt: "x",
          transmission: proof(),
        } as never,
      ],
    });
    expect(a.standing("ESC-T")).toBe("ALREADY_JUDGED");
  });

  it("closes an id on an unconfirmed CLAUDE_APPLIED, because closing fails closed", () => {
    // Asymmetry on purpose, and it is the same rule rather than an exception to it: read-back is
    // required to make something ACTIONABLE, never to stop it being so.
    const a = controlBusStanding({
      inbox: [],
      issueNumber: 2,
      outbox: [
        {
          protocolId: "ESC-T",
          kind: "ESCALATION",
          body: BODY,
          composedAt: "x",
          transmission: proof(),
        } as never,
        { protocolId: "ESC-T", kind: "CLAUDE_APPLIED" },
      ],
    });
    expect(a.standing("ESC-T")).toBe("ALREADY_JUDGED");
  });

  it("reports how many escalations were composed but never confirmed", () => {
    const a = controlBusStanding({
      inbox: [],
      issueNumber: 2,
      outbox: [
        { protocolId: "ESC-A", kind: "ESCALATION" },
        {
          protocolId: "ESC-B",
          kind: "ESCALATION",
          body: BODY,
          composedAt: "x",
          transmission: proof(),
        } as never,
      ],
    });
    expect(a.source()).toContain("1 escalation(s) read back");
    expect(a.source()).toContain("1 composed but never confirmed");
  });
});

/**
 * IR-115, NOW CLOSED — and these controls are what noticed.
 *
 * The previous version of this block asserted that NOTHING wrote the evidence `OPEN` requires:
 * `appendOutbox` had no callers, no production code set a transmission marker, and so
 * `controlBusStanding` could be green in tests and structurally unable to say `OPEN` in real
 * operation. Those controls were written to FAIL the day a producer appeared, rather than to lock
 * the gap in place, and that is exactly what they did — they were the first thing to go red when
 * `src/server/controlbus/outbound.ts` landed.
 *
 * They now pin the other side of the same property: there must be exactly ONE producer. Two
 * writers of the same durable record is the split IR-115 was about, arriving from the other end.
 */
describe("IR-115: exactly one producer of transmission evidence", () => {
  const productionSources = () => {
    const dirs = ["src/server/controlbus", "scripts", "src/server/escalation"];
    const files = dirs.flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `${dir}/${name}`),
    );
    // The scan has to be looking at something. An empty list would make every control below pass
    // by finding nothing, which is the vacuous green this project keeps paying for.
    expect(files.length).toBeGreaterThan(10);
    return files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
  };

  it("has one caller of the append-only outbox log, and it is the committer", () => {
    const callers = productionSources()
      .filter(({ file, text }) => !file.endsWith("store.ts") && text.includes("appendOutboxLog("))
      .map((c) => c.file);
    expect(
      callers,
      "the outbox log must have exactly one caller. A second one writes the record without the " +
        "state array beside it, which is the two-independently-mutable-sources split of IR-115.",
    ).toEqual(["src/server/controlbus/outbound.ts"]);
  });

  it("has one writer of a transmission proof, and it is the same file", () => {
    const writers = productionSources()
      .filter(({ text }) => text.includes("transmission: {"))
      .map((w) => w.file);
    expect(
      writers,
      "a transmission proof may only be assembled where the read-back happens.",
    ).toEqual(["src/server/controlbus/outbound.ts"]);
  });

  it("has no trace of the weaker marker it replaced", () => {
    // `transmittedCommentId` was a bare id: attachable to the wrong body, issue or repository. A
    // leftover would be a second, weaker marker sitting beside the real one.
    const leftovers = productionSources()
      .filter(({ text }) => text.includes("transmittedCommentId"))
      .map((l) => l.file);
    expect(leftovers).toEqual([]);
  });

  it("has a production caller for the lifecycle, not only tests", () => {
    // The reachability question, asked one level further out than last time. A producer nothing
    // invokes leaves OPEN exactly as unreachable as no producer at all — the same shape, moved.
    const callers = productionSources()
      .filter(
        ({ file, text }) =>
          // `endsWith("outbound.ts")` also excluded `post-outbound.ts`, which is the very caller
          // this is looking for. The suffix has to name the whole path.
          file !== "src/server/controlbus/outbound.ts" && text.includes("transmitAndCommit("),
      )
      .map((c) => c.file);
    expect(
      callers,
      "the outbound lifecycle must be driven from production. If this is empty, OPEN is once again " +
        "reachable only from a test fixture.",
    ).toEqual(["scripts/post-outbound.ts"]);
  });

  it("no longer reports an empty outbox as unrecordable silence", () => {
    // The disclosure was true and is not any more; it must not linger as a stale reassurance in the
    // other direction.
    const source = controlBusStanding({ issueNumber: 2, inbox: [], outbox: [] }).source();
    expect(source).not.toContain("IR-115");
    expect(source).toContain("0 escalation(s) read back");
  });
});
