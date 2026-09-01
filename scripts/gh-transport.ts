/**
 * The real `OutboundTransport`, over the `gh` CLI. The piece that made IR-115's producer reachable
 * from production rather than only from tests.
 *
 * ## THE ONE DESIGN DECISION WORTH READING
 *
 * `readBack` derives the repository and issue number FROM THE API RESPONSE, never from the
 * arguments this transport was constructed with. Echoing the expected values back would make every
 * binding check in `isTransmitted` vacuous — the proof would say "this came from the repository we
 * asked about" because we told it so. The response's `issue_url` is the only thing that actually
 * knows, and a control asserts a transport that echoes is caught.
 *
 * `find` MUST THROW rather than answer `null` when it cannot tell. A false negative there posts a
 * duplicate comment, which is the one irreversible mistake available to this module.
 *
 * The credential stays in the OS keyring: `gh` is invoked, never read.
 */

import { execFileSync } from "node:child_process";
import { bodyDigest } from "../src/server/controlbus/state";
import type { OutboundTransport, RemoteCommentRef } from "../src/server/controlbus/outbound";

/** Runs `gh` and returns stdout. Throws on a non-zero exit, which callers must not swallow. */
export type GhExec = (args: string[]) => string;

export const ghExec: GhExec = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

interface CommentPayload {
  id: number;
  body: string;
  /** `https://api.github.com/repos/<owner>/<repo>/issues/<n>` — the only authority on both. */
  issue_url: string;
}

/**
 * `owner/repo` and issue number, taken from the response rather than assumed.
 *
 * Returns `null` when the URL is not the shape GitHub documents, because a URL this cannot parse is
 * not evidence about anything — and an unparsed URL silently defaulting to the expected values is
 * the vacuous-binding failure this whole module is arranged to avoid.
 */
export function coordinatesFrom(
  issueUrl: string,
): { repository: string; issueNumber: number } | null {
  const match = /\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)(?:$|[?#])/.exec(issueUrl);
  if (!match) return null;
  const issueNumber = Number(match[2]);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;
  return { repository: match[1], issueNumber };
}

function toRef(payload: CommentPayload): RemoteCommentRef | null {
  const where = coordinatesFrom(payload.issue_url ?? "");
  if (where === null) return null;
  if (!Number.isInteger(payload.id) || payload.id <= 0) return null;
  return { commentId: payload.id, body: payload.body ?? "", ...where };
}

/** The comment id out of the URL `gh issue comment` prints. */
export function commentIdFromUrl(url: string): number | null {
  const match = /#issuecomment-(\d+)\s*$/.exec(url.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function ghTransport(
  repository: string,
  issueNumber: number,
  bodyFileFor: (body: string) => string,
  exec: GhExec = ghExec,
): OutboundTransport {
  const commentsPath = `repos/${repository}/issues/${issueNumber}/comments`;

  return {
    async find(protocolId, digest) {
      // `--paginate` because the channel is long and a first-page-only scan would answer "not
      // there" about a comment that is, which posts a duplicate.
      const raw = exec(["api", commentsPath, "--paginate"]);
      const parsed = JSON.parse(raw) as CommentPayload[] | CommentPayload[][];
      const comments = (Array.isArray(parsed[0]) ? parsed.flat() : parsed) as CommentPayload[];
      for (const payload of comments) {
        if (!payload.body?.includes(`[${protocolId}]`)) continue;
        if (bodyDigest(payload.body) !== digest) continue;
        const ref = toRef(payload);
        if (ref !== null) return ref;
      }
      return null;
    },

    async post(body) {
      const url = exec([
        "issue",
        "comment",
        String(issueNumber),
        "--repo",
        repository,
        "--body-file",
        bodyFileFor(body),
      ]);
      const commentId = commentIdFromUrl(url);
      if (commentId === null) {
        throw new Error(`gh returned no comment URL to read back: ${url.trim().slice(0, 200)}`);
      }
      return { commentId };
    },

    async readBack(commentId) {
      const raw = exec(["api", `repos/${repository}/issues/comments/${commentId}`]);
      return toRef(JSON.parse(raw) as CommentPayload);
    },
  };
}
