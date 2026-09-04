import { describe, expect, it } from "vitest";
import {
  commentIdFromUrl,
  coordinatesFrom,
  ghTransport,
  type GhExec,
} from "../scripts/gh-transport";
import { bodyDigest } from "@/server/controlbus/state";

/**
 * The real transport, exercised entirely offline.
 *
 * The property worth stating plainly: `readBack` must derive the repository and issue number FROM
 * THE RESPONSE. If it echoed the values it was constructed with, every binding clause in
 * `isTransmitted` would be vacuous — the proof would say "this came from the repository we asked
 * about" because we told it so, and a comment on any issue anywhere would satisfy it.
 */
describe("reading GitHub's answer rather than our own question", () => {
  const REPO = "jyun121388-spec/market-os";
  const ISSUE = 2;
  const BODY = "[CLAUDE_APPLIED][ESC-014]\n\nbody text";

  const payload = (over: Record<string, unknown> = {}) => ({
    id: 5497449824,
    body: BODY,
    issue_url: `https://api.github.com/repos/${REPO}/issues/${ISSUE}`,
    ...over,
  });

  const execReturning = (map: Record<string, string>): GhExec => {
    return (args) => {
      const key = args.join(" ");
      const hit = Object.entries(map).find(([prefix]) => key.startsWith(prefix));
      if (!hit) throw new Error(`unexpected gh invocation: ${key}`);
      return hit[1];
    };
  };

  const transport = (map: Record<string, string>) =>
    ghTransport(REPO, ISSUE, () => "/tmp/body.md", execReturning(map));

  it("takes the coordinates from the issue_url, not from its own arguments", async () => {
    // Constructed for THIS repository and issue, handed a comment from somewhere else. It must
    // report where the comment actually is, so `isTransmitted` can refuse it.
    const elsewhere = payload({
      issue_url: "https://api.github.com/repos/other-owner/other-repo/issues/99",
    });
    const t = transport({
      "api repos/jyun121388-spec/market-os/issues/comments/5497449824": JSON.stringify(elsewhere),
    });
    const ref = await t.readBack(5497449824);
    expect(ref?.repository).toBe("other-owner/other-repo");
    expect(ref?.issueNumber).toBe(99);
  });

  it("refuses a response whose issue_url it cannot parse", async () => {
    // Not evidence about anything. Defaulting to the expected values here is exactly the vacuous
    // binding this module is arranged to avoid.
    for (const issue_url of ["", "https://example.invalid/nope", "/repos/only-owner/issues/2"]) {
      const t = transport({
        "api repos/jyun121388-spec/market-os/issues/comments/1": JSON.stringify(
          payload({ id: 1, issue_url }),
        ),
      });
      expect(await t.readBack(1), issue_url || "(empty)").toBeNull();
    }
  });

  it("refuses a response with a malformed comment id", async () => {
    for (const id of [0, -1, 1.5]) {
      const t = transport({
        "api repos/jyun121388-spec/market-os/issues/comments/7": JSON.stringify(payload({ id })),
      });
      expect(await t.readBack(7), String(id)).toBeNull();
    }
  });

  it("parses the coordinates GitHub actually returns", () => {
    expect(coordinatesFrom("https://api.github.com/repos/a/b/issues/12")).toEqual({
      repository: "a/b",
      issueNumber: 12,
    });
    expect(coordinatesFrom("https://api.github.com/repos/a/b/issues/12?x=1")?.issueNumber).toBe(12);
    expect(coordinatesFrom("https://api.github.com/repos/a/b/pulls/12")).toBeNull();
    expect(coordinatesFrom("https://api.github.com/repos/a/b/issues/0")).toBeNull();
  });

  it("finds an existing comment by digest, not merely by tag", async () => {
    // Replay safety. The channel carries many comments with the same protocol id — every rework
    // round posts one — so matching the tag alone would adopt the WRONG comment and record a proof
    // describing a body that was never sent.
    const others = [
      payload({ id: 11, body: "[CLAUDE_APPLIED][ESC-014]\n\nan earlier round" }),
      payload({ id: 12, body: "[CLAUDE_APPLIED][ESC-OTHER]\n\nbody text" }),
      payload({ id: 13, body: BODY }),
    ];
    const t = transport({
      "api repos/jyun121388-spec/market-os/issues/2/comments --paginate": JSON.stringify(others),
    });
    const found = await t.find("ESC-014", bodyDigest(BODY));
    expect(found?.commentId).toBe(13);
  });

  it("answers null only when nothing matches, and throws when it cannot tell", async () => {
    const empty = transport({
      "api repos/jyun121388-spec/market-os/issues/2/comments --paginate": "[]",
    });
    expect(await empty.find("ESC-014", bodyDigest(BODY))).toBeNull();

    // A transport that swallowed this would answer "not there" about a comment that is, and the
    // lifecycle would post a duplicate. Throwing is the only safe failure.
    const broken = ghTransport(
      REPO,
      ISSUE,
      () => "/tmp/body.md",
      () => {
        throw new Error("gh: not authenticated");
      },
    );
    await expect(broken.find("ESC-014", bodyDigest(BODY))).rejects.toThrow(/not authenticated/);
  });

  it("flattens the array-of-pages shape --paginate can return", async () => {
    const t = transport({
      "api repos/jyun121388-spec/market-os/issues/2/comments --paginate": JSON.stringify([
        [payload({ id: 21, body: "unrelated" })],
        [payload({ id: 22, body: BODY })],
      ]),
    });
    expect((await t.find("ESC-014", bodyDigest(BODY)))?.commentId).toBe(22);
  });

  it("reads the comment id out of the URL gh prints, and refuses anything else", async () => {
    expect(commentIdFromUrl("https://github.com/o/r/issues/2#issuecomment-5497449824\n")).toBe(
      5497449824,
    );
    expect(commentIdFromUrl("https://github.com/o/r/issues/2")).toBeNull();
    expect(commentIdFromUrl("")).toBeNull();
  });

  it("refuses to invent a comment id when the post prints no URL", async () => {
    // Without this the lifecycle would read back a fabricated id, get nothing, and record a
    // refusal for the wrong reason — hiding a broken post behind a plausible message.
    const t = transport({ "issue comment 2": "something else entirely\n" });
    await expect(t.post(BODY)).rejects.toThrow(/no comment URL/);
  });
});
