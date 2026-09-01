import { describe, expect, it } from "vitest";
import {
  foreignRepositories,
  type GitOracle,
  localGit,
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

  const entry = (body: string) => ({
    protocolId: "ESC-999",
    receivedAt: "2026-08-21T00:00:00.000Z",
    githubCommentId: 1,
    body,
  });

  it("calls a decision anchored to an ancestor stale, with the distance", () => {
    const row = triageEntry(entry("reviewed head: `abc1234`"), oracle({ abc1234: 211 }));
    expect(row.verdict).toBe("STALE_REFRESH_REQUIRED");
    expect(row.detail).toContain("211");
  });

  it("calls a decision anchored to HEAD current", () => {
    const row = triageEntry(entry(`reviewed head: \`${HEAD}\``), oracle({ [HEAD]: 0 }));
    expect(row.verdict).toBe("CURRENT");
  });

  it("refuses to judge an anchor this repository does not have", () => {
    // THE control. The commit is well formed and simply absent; nothing about that is reassuring.
    const row = triageEntry(entry("reviewed head: `deadbee`"), oracle({}));
    expect(row.verdict).toBe("ANCHOR_UNVERIFIABLE");
    expect(row.anchors).toEqual([{ sha: "deadbee", resolved: false }]);
  });

  it("refuses to judge an anchor on a divergent line rather than calling it a distance", () => {
    // Resolves, but is not an ancestor. `rev-list --count` would still return a number, and that
    // number would mean something else entirely.
    const row = triageEntry(entry("reviewed head: `abc1234`"), oracle({ abc1234: null }));
    expect(row.verdict).toBe("ANCHOR_UNVERIFIABLE");
    expect(row.detail).toContain("divergent");
  });

  it("uses the NEAREST anchor when a body names several", () => {
    // These packets cite a chain of commits. Judging by whichever appeared first in the prose would
    // report a staleness that depends on sentence order.
    const row = triageEntry(
      entry("parent `aaaaaaa`, then `bbbbbbb`, head `ccccccc`"),
      oracle({ aaaaaaa: 200, bbbbbbb: 12, ccccccc: 90 }),
    );
    expect(row.verdict).toBe("STALE_REFRESH_REQUIRED");
    expect(row.detail).toContain("12 commit(s)");
  });

  it("says a body with no anchor cannot be judged for staleness", () => {
    const row = triageEntry(entry("please proceed as discussed"), oracle({}));
    expect(row.verdict).toBe("NO_ANCHOR");
  });

  it("does not invent an anchor out of short hex in prose", () => {
    // `deadbe` is six. Below seven this pattern matches ordinary words and every decision would
    // arrive carrying imaginary anchors.
    expect(triageEntry(entry("see item deadbe"), oracle({})).verdict).toBe("NO_ANCHOR");
  });

  it("routes a decision that names another repository away from here", () => {
    const row = triageEntry(entry("apply in github.com/other-owner/other-repo"), oracle({}));
    expect(row.verdict).toBe("NOT_THIS_REPOSITORY");
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
