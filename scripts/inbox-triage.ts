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
 *   npx tsx scripts/inbox-triage.ts [--bus-root <dir>] [--json]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Verdict =
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

export interface TriageRow {
  protocolId: string;
  receivedAt: string;
  githubCommentId: number | string;
  verdict: Verdict;
  detail: string;
  /** Anchors found in the body, with what the object store says about each. */
  anchors: { sha: string; resolved: boolean; behindHead?: number }[];
}

export const THIS_REPOSITORY = "jyun121388-spec/market-os";

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

export function triageEntry(
  entry: { protocolId: string; receivedAt: string; githubCommentId: number | string; body: string },
  git: GitOracle,
): TriageRow {
  const base = {
    protocolId: entry.protocolId,
    receivedAt: entry.receivedAt,
    githubCommentId: entry.githubCommentId,
  };

  const foreign = foreignRepositories(entry.body);
  if (foreign.length > 0) {
    return {
      ...base,
      verdict: "NOT_THIS_REPOSITORY",
      detail: `names ${foreign.join(", ")}`,
      anchors: [],
    };
  }

  const head = git.head();
  const seen = new Set<string>();
  const anchors: TriageRow["anchors"] = [];
  for (const [sha] of entry.body.matchAll(SHA_LIKE)) {
    if (seen.has(sha)) continue;
    seen.add(sha);
    if (!git.isCommit(sha)) continue;
    const behind = git.distanceToHead(sha);
    anchors.push({ sha, resolved: true, ...(behind === null ? {} : { behindHead: behind }) });
  }

  if (anchors.length === 0) {
    // Every hex run either was not a commit or there were none. Both are "cannot judge", and they
    // are distinguished only in the detail — neither is allowed to read as fine.
    const hexRuns = [...new Set([...entry.body.matchAll(SHA_LIKE)].map(([s]) => s))];
    return hexRuns.length === 0
      ? {
          ...base,
          verdict: "NO_ANCHOR",
          detail: "no commit-shaped anchor in the body",
          anchors: [],
        }
      : {
          ...base,
          verdict: "ANCHOR_UNVERIFIABLE",
          detail: `${hexRuns.length} commit-shaped run(s), none present in this object store`,
          anchors: hexRuns.map((sha) => ({ sha, resolved: false })),
        };
  }

  if (anchors.some((a) => a.sha === head || head.startsWith(a.sha))) {
    return { ...base, verdict: "CURRENT", detail: `anchored to HEAD ${head.slice(0, 8)}`, anchors };
  }

  const behind = anchors.filter((a) => a.behindHead !== undefined);
  if (behind.length === 0) {
    return {
      ...base,
      verdict: "ANCHOR_UNVERIFIABLE",
      detail: "anchors resolve but none is an ancestor of HEAD — a divergent line, not a distance",
      anchors,
    };
  }
  const nearest = Math.min(...behind.map((a) => a.behindHead!));
  return {
    ...base,
    verdict: "STALE_REFRESH_REQUIRED",
    detail: `nearest anchor is ${nearest} commit(s) behind HEAD`,
    anchors,
  };
}

export function triageInbox(root: string, git: GitOracle): TriageRow[] | null {
  const statePath = join(root, "state.json");
  if (!existsSync(statePath)) return null;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    inbox: {
      protocolId: string;
      receivedAt: string;
      githubCommentId: number | string;
      body: string;
      status: string;
    }[];
  };
  return state.inbox
    .filter((e) => e.status === "RECEIVED_UNVALIDATED")
    .map((e) => triageEntry(e, git));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const flag = process.argv.indexOf("--bus-root");
  const root = flag === -1 ? ".local/control-bus" : process.argv[flag + 1];
  const rows = triageInbox(root, localGit());
  if (rows === null) {
    console.log(`no state.json under ${root} — the inbox has not been read from here`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const counts = new Map<Verdict, number>();
    for (const r of rows) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
    console.log(`${rows.length} unjudged decision(s) under ${root}\n`);
    for (const r of rows) {
      console.log(
        `  ${r.verdict.padEnd(22)} ${r.protocolId.padEnd(34)} ${r.receivedAt.slice(0, 10)}`,
      );
      console.log(`      ${r.detail}`);
    }
    console.log();
    for (const [v, n] of [...counts].sort()) console.log(`  ${String(n).padStart(3)}  ${v}`);
    console.log(
      "\nNothing was applied, resolved or refreshed. UNVERIFIABLE is not CURRENT: an anchor this\n" +
        "repository does not have may be a branch never fetched here, and 'I cannot check' must\n" +
        "never read as 'it checks out'.",
    );
  }
}
