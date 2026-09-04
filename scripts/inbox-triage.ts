/**
 * Triage the durable control-bus inbox. READ ONLY — nothing here mutates transport state.
 *
 * ## WHY
 *
 * Wiring `evaluateStopSentinel()` to real evidence (IR-114) turned "never established" into
 * `11 received decisions`: entries the consumer never judged, some of them weeks old. A number is
 * not a decision, and `CLAUDE.md` is explicit that a decision is not applied on sight — it has to
 * be confirmed to target THIS repository, to match an open id, and not to have gone stale against
 * the current HEAD, with `[ESCALATION_REFRESH_REQUIRED]` as the answer when it has.
 *
 * That check was written down and never mechanised, so this does the mechanical part and refuses to
 * do the rest. It produces a decision-ready list; it does not decide, and it does not apply.
 *
 * ## THE RULE, WHICH IS THE SAME ONE THE REST OF THIS BRANCH KEEPS RELEARNING
 *
 * An anchor this cannot resolve is UNVERIFIABLE, never CURRENT. A commit absent from the local
 * object store may be a branch that was never fetched, and treating "I cannot check" as "it checks
 * out" is how a stale decision gets applied. Absence of evidence is reported as absence.
 *
 * ## AND IT MECHANISED TWO OF THREE, WHICH IS THIS BRANCH'S SIGNATURE MISTAKE
 *
 * The rule quoted above names THREE independent facts — targets this repository, matches an OPEN
 * id, is not stale — and the first version of this file checked the first and the third. It carried
 * `protocolId` from input to output without ever asking whether that id was open, so a closed,
 * superseded or never-open decision earned `STALE_REFRESH_REQUIRED` on the strength of its commit
 * anchors alone. Reproduced before repairing, against a state whose id is recorded APPLIED:
 *
 *     before   STALE_REFRESH_REQUIRED   nearest anchor is 3 commit(s) behind HEAD
 *     after    NOT_ACTIONABLE           already judged (APPLIED)
 *
 * The two questions are now answered separately and combined at the end, because they are genuinely
 * independent: an id can be open with a current anchor, closed with a stale one, or anything else.
 * Openness comes from the canonical control-bus state, never from body prose, recency, or the mere
 * fact that a row is sitting in the inbox — an unjudged row means nobody judged it, which is not
 * the same as this repository having an outstanding question.
 *
 *   npx tsx scripts/inbox-triage.ts [--bus-root <dir>] [--json]
 */

import { execFileSync } from "node:child_process";
import {
  CONTROL_BUS_REPOSITORY,
  isTransmitted,
  type OutboxEntry,
} from "../src/server/controlbus/state";
import { storePaths } from "../src/server/controlbus/store";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** What the COMMIT ANCHORS say. Nothing here is a statement about the protocol id. */
export type AnchorVerdict =
  /** Names a repository that is not this one. Nothing to do here. */
  | "NOT_THIS_REPOSITORY"
  /** Anchored to a commit this repository does not have. Cannot be judged from here. */
  | "ANCHOR_UNVERIFIABLE"
  /** Anchored to a real ancestor of HEAD, which has since moved on. Needs a refresh. */
  | "STALE_REFRESH_REQUIRED"
  /** Anchored to exactly the current HEAD. */
  | "CURRENT"
  /** Carries no commit anchor at all, so staleness is not a question this can answer. */
  | "NO_ANCHOR";

/** What the CONTROL-BUS STATE says about the protocol id. Nothing here is about commits. */
export type IdStanding =
  /** This repository posted an escalation with that id and nothing has closed it. */
  | "OPEN"
  /** Validated, applied, rejected, or answered by a `CLAUDE_APPLIED` this repository posted. */
  | "ALREADY_JUDGED"
  /** No canonical record either way. Fails closed: unknown is not open. */
  | "STANDING_UNVERIFIABLE";

/** The two answers combined. This, and only this, says whether anything may happen. */
export type Disposition =
  /** Open id, anchored to HEAD. */
  | "RUNNABLE"
  /** Open id, anchored behind HEAD: answer `[ESCALATION_REFRESH_REQUIRED]` with the difference. */
  | "REFRESH_REQUIRED"
  /** Anything else, for any reason. The reason is in the two components, not flattened away. */
  | "NOT_ACTIONABLE";

export interface TriageRow {
  protocolId: string;
  receivedAt: string;
  githubCommentId: number | string;
  anchorVerdict: AnchorVerdict;
  standing: IdStanding;
  disposition: Disposition;
  detail: string;
  /** Anchors found in the body, with what the object store says about each. */
  anchors: { sha: string; resolved: boolean; behindHead?: number }[];
}

/**
 * Which protocol ids this repository currently has an open question about.
 *
 * An interface so the controls can vary the standing while holding the body and anchors identical
 * — the discrimination the correction is about.
 */
export interface OpenIdAuthority {
  /** The canonical record consulted, reported so a standing is never anonymous. */
  source(): string;
  standing(protocolId: string): IdStanding;
}

/** Knows nothing, so nothing is open. The fail-closed default. */
export const NO_ID_AUTHORITY: OpenIdAuthority = {
  source: () => "none — no canonical record of open ids was available",
  standing: () => "STANDING_UNVERIFIABLE",
};

/** Statuses that mean the consumer has finished with an entry. */
const TERMINAL_STATUSES = new Set(["VALIDATED", "APPLIED", "REJECTED"]);

/**
 * The canonical authority: the control-bus state's own inbox statuses and outbox postings.
 *
 * Judged beats open, deliberately. A historical id must not re-enter through a stale inbox row, so
 * a terminal status anywhere for that id closes it however many unjudged rows also mention it.
 *
 * OPEN requires POSITIVE evidence that this repository asked. A `RECEIVED_UNVALIDATED` row is not
 * that evidence — it means the watcher wrote something down and nobody judged it, which is a
 * statement about this machine, not about an outstanding question.
 *
 * ## AND NEITHER IS A QUEUED ESCALATION, WHICH IS WHERE THIS WAS STILL WRONG
 *
 * The first version accepted any outbox `ESCALATION` as proof of an open question. It is not. An
 * outbox row is composed locally; a transmission proof is written only after a READ-BACK proves the
 * comment exists remotely, and never on a successful POST. So a queued, failed or never-sent
 * escalation granted OPEN standing and promoted an incoming decision to `RUNNABLE`. Reproduced
 * against the committed implementation before repairing:
 *
 *     standing    OPEN
 *     disposition RUNNABLE
 *
 * `CLAUDE.md` states this invariant in as many words — `REMOTE_POST_NOT_CONFIRMED =>
 * CHATGPT_NOT_YET_NOTIFIED`, only read-back proves transmission — and the authority built to
 * enforce openness ignored it. Local intent to send is not evidence that a remote escalation
 * exists.
 *
 * CLOSURE is treated differently, and deliberately. A `CLAUDE_APPLIED` closes an id whether or not
 * it was read back, because closing fails CLOSED: the consequence is `NOT_ACTIONABLE`, which is the
 * safe direction. Requiring read-back to OPEN and not to CLOSE is not an inconsistency; it is the
 * same rule — never let unproven evidence make something actionable — applied to both.
 */
export function controlBusStanding(state: {
  issueNumber?: number;
  inbox?: { protocolId: string; status: string }[];
  outbox?: (Partial<OutboxEntry> & { protocolId: string; kind: string })[];
}): OpenIdAuthority {
  // No canonical issue in the state means no binding target, so nothing can be proven against it.
  const expect =
    typeof state.issueNumber === "number"
      ? { repository: CONTROL_BUS_REPOSITORY, issueNumber: state.issueNumber }
      : null;
  const judged = new Set<string>();
  const asked = new Set<string>();
  let queued = 0;
  for (const entry of state.inbox ?? []) {
    if (TERMINAL_STATUSES.has(entry.status)) judged.add(entry.protocolId);
  }
  for (const entry of state.outbox ?? []) {
    if (entry.kind === "CLAUDE_APPLIED") judged.add(entry.protocolId);
    else if (entry.kind === "ESCALATION") {
      // `isTransmitted` is the SHARED predicate, the same one `health()` uses. The local copy this
      // replaced checked only the comment id, so a proof could have been attached to a different
      // body, a different issue, or another repository entirely.
      if (expect !== null && isTransmitted(entry as OutboxEntry, expect))
        asked.add(entry.protocolId);
      else queued += 1;
    }
  }
  return {
    source: () =>
      `control-bus state: ${judged.size} judged id(s), ${asked.size} escalation(s) read back from ` +
      // IR-115 is closed: `outbound.ts` is the producer, so an empty outbox now means nothing has
      // been transmitted-and-committed yet, which is a fact rather than the silence it used to be.
      `the remote issue, ${queued} composed but never confirmed`,
    standing: (protocolId) => {
      if (judged.has(protocolId)) return "ALREADY_JUDGED";
      if (asked.has(protocolId)) return "OPEN";
      return "STANDING_UNVERIFIABLE";
    },
  };
}

/**
 * The combination, kept in one place so neither answer can quietly override the other.
 *
 * Only an OPEN id can be actionable at all. A closed or unverifiable one is NOT_ACTIONABLE whatever
 * its anchors say, which is the whole of the correction: staleness must never promote an id that
 * had no standing to begin with.
 */
export function disposition(anchor: AnchorVerdict, standing: IdStanding): Disposition {
  if (standing !== "OPEN") return "NOT_ACTIONABLE";
  if (anchor === "CURRENT") return "RUNNABLE";
  if (anchor === "STALE_REFRESH_REQUIRED") return "REFRESH_REQUIRED";
  return "NOT_ACTIONABLE";
}

/**
 * One repository constant, imported rather than repeated.
 *
 * This file used to declare its own copy of the slug while `state.ts` had another. Same value, two
 * places, and the two were consulted by different halves of the same decision.
 */
export const THIS_REPOSITORY = CONTROL_BUS_REPOSITORY;

/**
 * `owner/repo`, but ONLY where something in the text makes it a repository coordinate.
 *
 * A general `a/b` pattern plus an adjacency test was tried first and was wrong in a way worth
 * keeping written down: against `github.com/someone/else` the slug pattern matched
 * `github.com/someone` — `.` is legal in the repo half — the adjacency check then failed, and the
 * regex had already consumed past the real slug, so a plainly foreign URL came back clean. The
 * prefix belongs INSIDE the pattern, not in a second test applied afterwards.
 *
 * An owner may not contain a dot; a repository name may.
 */
const REPO_COORDINATE =
  /(?:github\.com\/|\brepo(?:sitory)?[:\s]+)([A-Za-z0-9][\w-]*)\/([A-Za-z0-9][\w.-]*)/gi;

/**
 * Commit-shaped hex runs of 7 or more.
 *
 * The lower bound matters in both directions. Below 7 this matches ordinary hex in prose and every
 * decision would arrive carrying imaginary anchors; requiring 40 would miss the abbreviated forms
 * these packets actually use. Whether a match is a COMMIT is then settled by the object store
 * rather than by the pattern, which is the only authority that can settle it.
 */
const SHA_LIKE = /\b[0-9a-f]{7,40}\b/g;

export interface GitOracle {
  /** Does this repository have that object, and is it a commit? */
  isCommit(sha: string): boolean;
  /** Commits on HEAD that are not reachable from `sha`; `null` if it is not an ancestor. */
  distanceToHead(sha: string): number | null;
  head(): string;
}

export function localGit(cwd: string = process.cwd()): GitOracle {
  const git = (args: string[]): string | null => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
  return {
    isCommit: (sha) => git(["cat-file", "-t", sha]) === "commit",
    distanceToHead: (sha) => {
      // `--is-ancestor` first, because rev-list would happily count a divergent commit's distance
      // and that number would mean something else entirely.
      if (git(["merge-base", "--is-ancestor", sha, "HEAD"]) === null) return null;
      const n = git(["rev-list", "--count", `${sha}..HEAD`]);
      return n === null ? null : Number(n);
    },
    head: () => git(["rev-parse", "HEAD"]) ?? "",
  };
}

/** Repository slugs a decision body names, other than this one. */
export function foreignRepositories(body: string): string[] {
  const found = new Set<string>();
  for (const [, owner, repo] of body.matchAll(REPO_COORDINATE)) {
    const slug = `${owner}/${repo}`;
    if (slug.toLowerCase() !== THIS_REPOSITORY.toLowerCase()) found.add(slug);
  }
  return [...found];
}

/**
 * The ANCHOR half, unchanged in behaviour and now clearly only half an answer.
 *
 * Extracted so the id half cannot reach in and adjust it, and so a control can vary the standing
 * while holding this constant.
 */
function anchorOf(
  body: string,
  git: GitOracle,
): { verdict: AnchorVerdict; detail: string; anchors: TriageRow["anchors"] } {
  const foreign = foreignRepositories(body);
  if (foreign.length > 0) {
    return { verdict: "NOT_THIS_REPOSITORY", detail: `names ${foreign.join(", ")}`, anchors: [] };
  }

  const head = git.head();
  const seen = new Set<string>();
  const anchors: TriageRow["anchors"] = [];
  for (const [sha] of body.matchAll(SHA_LIKE)) {
    if (seen.has(sha)) continue;
    seen.add(sha);
    if (!git.isCommit(sha)) continue;
    const behind = git.distanceToHead(sha);
    anchors.push({ sha, resolved: true, ...(behind === null ? {} : { behindHead: behind }) });
  }

  if (anchors.length === 0) {
    // Every hex run either was not a commit or there were none. Both are "cannot judge", and they
    // are distinguished only in the detail — neither is allowed to read as fine.
    const hexRuns = [...new Set([...body.matchAll(SHA_LIKE)].map(([s]) => s))];
    return hexRuns.length === 0
      ? { verdict: "NO_ANCHOR", detail: "no commit-shaped anchor in the body", anchors: [] }
      : {
          verdict: "ANCHOR_UNVERIFIABLE",
          detail: `${hexRuns.length} commit-shaped run(s), none present in this object store`,
          anchors: hexRuns.map((sha) => ({ sha, resolved: false })),
        };
  }

  if (anchors.some((a) => a.sha === head || head.startsWith(a.sha))) {
    return { verdict: "CURRENT", detail: `anchored to HEAD ${head.slice(0, 8)}`, anchors };
  }

  const behind = anchors.filter((a) => a.behindHead !== undefined);
  if (behind.length === 0) {
    return {
      verdict: "ANCHOR_UNVERIFIABLE",
      detail: "anchors resolve but none is an ancestor of HEAD — a divergent line, not a distance",
      anchors,
    };
  }
  const nearest = Math.min(...behind.map((a) => a.behindHead!));
  return {
    verdict: "STALE_REFRESH_REQUIRED",
    detail: `nearest anchor is ${nearest} commit(s) behind HEAD`,
    anchors,
  };
}

/**
 * @param ids the open-id authority. Required, with no default, so a caller that has no canonical
 *            record has to say so by passing `NO_ID_AUTHORITY` rather than by omission.
 */
export function triageEntry(
  entry: { protocolId: string; receivedAt: string; githubCommentId: number | string; body: string },
  git: GitOracle,
  ids: OpenIdAuthority,
): TriageRow {
  const anchor = anchorOf(entry.body, git);
  const standing = ids.standing(entry.protocolId);
  const detail =
    standing === "OPEN"
      ? anchor.detail
      : standing === "ALREADY_JUDGED"
        ? `already judged; ${anchor.detail}`
        : `id standing not established (${ids.source()}); ${anchor.detail}`;
  return {
    protocolId: entry.protocolId,
    receivedAt: entry.receivedAt,
    githubCommentId: entry.githubCommentId,
    anchorVerdict: anchor.verdict,
    standing,
    disposition: disposition(anchor.verdict, standing),
    detail,
    anchors: anchor.anchors,
  };
}

/**
 * @param ids injectable; by default the authority is built from the SAME state file being read, so
 *            the two halves cannot disagree about which control bus they describe.
 */
export function triageInbox(
  root: string,
  git: GitOracle,
  ids?: OpenIdAuthority,
): TriageRow[] | null {
  const statePath = join(root, "state.json");
  if (!existsSync(statePath)) return null;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    issueNumber?: number;
    inbox: {
      protocolId: string;
      receivedAt: string;
      githubCommentId: number | string;
      body: string;
      status: string;
    }[];
    outbox?: (Partial<OutboxEntry> & { protocolId: string; kind: string })[];
  };
  const authority = ids ?? controlBusStanding(state);
  return state.inbox
    .filter((e) => e.status === "RECEIVED_UNVALIDATED")
    .map((e) => triageEntry(e, git, authority));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const flag = process.argv.indexOf("--bus-root");
  // A fifth copy of the relative name used to live here. The bus is a property of the repository,
  // not of the directory this happens to be invoked from — `storePaths()` is the one rule.
  const root = flag === -1 ? storePaths().root : process.argv[flag + 1];
  const rows = triageInbox(root, localGit());
  if (rows === null) {
    console.log(`no state.json under ${root} — the inbox has not been read from here`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.disposition}  (${r.standing} / ${r.anchorVerdict})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    console.log(`${rows.length} unjudged decision(s) under ${root}\n`);
    for (const r of rows) {
      console.log(
        `  ${r.disposition.padEnd(17)} ${r.standing.padEnd(22)} ${r.anchorVerdict.padEnd(22)} ` +
          `${r.protocolId.padEnd(34)} ${r.receivedAt.slice(0, 10)}`,
      );
      console.log(`      ${r.detail}`);
    }
    console.log();
    for (const [v, n] of [...counts].sort()) console.log(`  ${String(n).padStart(3)}  ${v}`);
    console.log(
      "\nNothing was applied, resolved or refreshed. Two independent questions: UNVERIFIABLE is not\n" +
        "CURRENT for a commit anchor, and an unjudged inbox row is not an OPEN id. Neither unknown\n" +
        "may read as the reassuring answer, and only an OPEN id can be actionable at all.",
    );
  }
}
