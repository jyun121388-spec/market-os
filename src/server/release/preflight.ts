/**
 * Release-candidate preflight: current repository evidence in, release status out.
 *
 * Read-only by construction. It cannot merge, push, deploy, migrate, activate anything or buy
 * anything, and it holds no code that could — a preflight that can act on its own conclusion is a
 * release process with no human in it.
 *
 * Two rules do most of the work here.
 *
 * **Missing evidence is never PASS.** Every input is optional and every absent one resolves toward
 * `EVIDENCE_INSUFFICIENT`, because "we did not check" and "it passed" are different facts and only
 * one of them is a release. This is the same fail-closed discipline as the stop sentinel, for the
 * same reason: the convenient default is always the wrong one.
 *
 * **Evidence belongs to a commit.** A green suite is a statement about the tree it ran against. If
 * HEAD has moved and the change could have invalidated it, the evidence is `EVIDENCE_STALE` rather
 * than green — and a docs-only commit does not invalidate a build, which is the other half of the
 * rule. Re-running everything constantly and trusting a proof forever are both failures.
 */

export type EvidenceState = "PASS" | "FAIL" | "STALE" | "MISSING";

/** What changed since a piece of evidence was gathered, which decides whether it still holds. */
export type ChangeKind =
  | "APPLICATION_CODE"
  | "UI_OR_REQUEST_PATH"
  | "MIGRATION_OR_SCHEMA"
  | "VERIFY_LAYER"
  | "TEST_ONLY"
  | "DOCS_ONLY";

export interface Evidence {
  /** The commit this evidence was gathered against. */
  commit: string;
  state: "PASS" | "FAIL";
  detail?: string;
}

/**
 * Which change kinds invalidate which evidence.
 *
 * Stated as data so the reasoning is reviewable rather than buried in conditionals, and so adding
 * a check means deciding — once, visibly — what makes it stale.
 */
const INVALIDATED_BY: Record<string, ChangeKind[]> = {
  tests: ["APPLICATION_CODE", "MIGRATION_OR_SCHEMA", "VERIFY_LAYER", "TEST_ONLY"],
  typecheck: ["APPLICATION_CODE", "MIGRATION_OR_SCHEMA", "VERIFY_LAYER", "TEST_ONLY"],
  lint: ["APPLICATION_CODE", "VERIFY_LAYER", "TEST_ONLY"],
  format: ["APPLICATION_CODE", "VERIFY_LAYER", "TEST_ONLY", "DOCS_ONLY"],
  build: ["APPLICATION_CODE", "UI_OR_REQUEST_PATH", "MIGRATION_OR_SCHEMA"],
  e2e: ["APPLICATION_CODE", "UI_OR_REQUEST_PATH", "MIGRATION_OR_SCHEMA"],
  migrations: ["MIGRATION_OR_SCHEMA"],
  verifyCoverage: ["VERIFY_LAYER", "APPLICATION_CODE"],
};

export interface PreflightInput {
  head: string;
  /**
   * What changed between the evidence and HEAD, by kind.
   *
   * Optional, and the three states are distinct. Omitted means nobody established it, which is
   * unknown. An empty array means "nothing changed" only when the evidence commit already equals
   * HEAD; against a different commit an empty array is still unknown, because a caller who has not
   * classified the intervening commits cannot assert that none of them mattered.
   *
   * It was required at runtime while the file claimed every input was optional, and omitting it
   * threw a TypeError instead of returning EVIDENCE_INSUFFICIENT — a preflight that crashes gives
   * no verdict at all, which is worse than an unhelpful one.
   */
  changesSinceEvidence?: ChangeKind[];
  treeClean: boolean;
  /** Whether HEAD exists on the remote. A release candidate that exists only locally is not one. */
  pushedToRemote: boolean;

  tests?: Evidence;
  typecheck?: Evidence;
  lint?: Evidence;
  format?: Evidence;
  build?: Evidence;
  e2e?: Evidence;
  migrations?: Evidence;
  verifyCoverage?: Evidence;

  openP0?: number;
  openP1?: number;
  openP2?: number;
  /** Findings recorded but never reproduced, accepted or rejected. */
  unhandledReviewFindings?: number;
  /** Review owed but not yet performed. Not a blocker on its own; it is a named debt. */
  reviewDebtItems?: number;
  /**
   * Whether the final independent adversarial review has run, and against WHICH commit.
   *
   * A boolean was not enough (IR-055): it survived a change of HEAD and reported a review of an
   * earlier tree as a review of this one. A review is evidence about the code it read.
   */
  finalReviewDone?: boolean;
  finalReviewCommit?: string;
  /**
   * Paths changed between the reviewed commit and HEAD.
   *
   * This is what stops the review chain becoming a perpetual motion machine. Recording a review
   * creates a commit, that commit moves HEAD, and a naive freshness rule then declares the review
   * stale the instant it is written down — so the review can never be current and the release can
   * never close, no matter how clean the code is.
   *
   * The resolution is that not every commit invalidates a review. A review is evidence about
   * EXECUTABLE CODE. A commit touching only the attestation and the findings record changes
   * nothing the reviewer looked at.
   *
   * Undefined means nobody established it, and that is stale — the same fail-closed rule as
   * everywhere else here, and the important one, because this is precisely the field somebody
   * would be tempted to leave out to make a release close.
   */
  changedPathsSinceReview?: string[];

  /** Human Gates still open, by id. Each is external by definition. */
  openHumanGates?: string[];
  /** Providers whose capabilities remain unverified for want of a key. */
  unverifiedProviders?: string[];
  /** Escalations composed and not yet transmitted. External, and not an internal defect. */
  queuedEscalations?: number;
  controlBusWatcher?: "ALIVE" | "STOPPED";
}

export type ReleaseVerdict =
  | "RELEASE_CANDIDATE_READY"
  | "RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES"
  | "RELEASE_CANDIDATE_BLOCKED_INTERNAL"
  | "EVIDENCE_STALE"
  | "EVIDENCE_INSUFFICIENT";

export interface PreflightCheck {
  name: string;
  state: EvidenceState;
  detail: string;
  /** Whether failing this is something the team can fix, or something the world must supply. */
  kind: "INTERNAL" | "EXTERNAL";
}

export interface PreflightReport {
  verdict: ReleaseVerdict;
  checks: PreflightCheck[];
  /** Why the verdict is what it is, naming the checks that decided it. */
  rationale: string;
}

function evidenceState(
  name: string,
  evidence: Evidence | undefined,
  input: PreflightInput,
): EvidenceState {
  if (!evidence) return "MISSING";
  if (evidence.state === "FAIL") return "FAIL";
  if (evidence.commit === input.head) return "PASS";

  // Evidence from another commit, and nothing declared about what changed. The first review
  // (IR-053) found this returning PASS: an empty change list was read as "nothing changed" when it
  // equally means "nobody said". Those are the two readings this whole module exists to keep
  // apart, and it had them backwards on its own inputs.
  const changes = input.changesSinceEvidence ?? [];
  if (changes.length === 0) return "STALE";

  const invalidating = INVALIDATED_BY[name] ?? [];
  return changes.some((change) => invalidating.includes(change)) ? "STALE" : "PASS";
}

/**
 * The only paths whose contents a code review is not evidence about.
 *
 * An explicit list, not a prefix. The first version was `^docs/` and that was too generous by a
 * wide margin: `PROJECT_STATE.md` is read by a test, `HUMAN_GATE_QUEUE.md` supplies the preflight
 * its gate list, `SESSION_HANDOFF.md` is parsed by the orphan check, and `CLAUDE.md` is operating
 * policy. Editing any of them changes what the system does, which is exactly what a review is
 * evidence about.
 *
 * A file earns its place here only by being read by nothing — enforced by
 * `tests/evidencePathClassification.test.ts`, which fails if any source or test file references
 * one. Membership is a property that can be checked, rather than a judgement recorded once.
 *
 * Anything not on this list invalidates the review, including paths nobody has classified. That
 * default is the whole point: this is the field somebody would widen to make a release close.
 */
const EVIDENCE_ONLY_PATHS: readonly string[] = [
  "docs/REVIEW_ATTESTATION.json",
  "docs/REVIEW_ATTESTATION.md",
  "docs/escalation/PENDING_PR_UPDATE.md",
];

export function isEvidenceOnlyPath(path: string): boolean {
  return EVIDENCE_ONLY_PATHS.includes(path.split("\\").join("/"));
}

function reviewCoversHead(input: PreflightInput): boolean {
  if (input.finalReviewCommit === input.head) return true;
  if (input.changedPathsSinceReview === undefined) return false;
  // An empty list with a different commit means nobody classified the intervening changes, not
  // that there were none — the same distinction the evidence checks make.
  if (input.changedPathsSinceReview.length === 0) return false;
  return input.changedPathsSinceReview.every(isEvidenceOnlyPath);
}

function finalReviewState(input: PreflightInput): EvidenceState {
  if (input.finalReviewDone === undefined) return "MISSING";
  if (!input.finalReviewDone) return "FAIL";
  return reviewCoversHead(input) ? "PASS" : "STALE";
}

function finalReviewDetail(input: PreflightInput): string {
  if (input.finalReviewDone === undefined) {
    return "Never established. A reviewer's absence is not a clean review.";
  }
  if (!input.finalReviewDone) return "Final adversarial review has not run against this HEAD.";
  if (input.finalReviewCommit === input.head) {
    return `Final adversarial review completed against ${input.head}.`;
  }
  if (reviewCoversHead(input)) {
    return (
      `Reviewed at ${input.finalReviewCommit}; every change since is non-executable ` +
      `(${input.changedPathsSinceReview?.join(", ")}), so the review still describes this code.`
    );
  }
  return (
    `Review was of ${input.finalReviewCommit ?? "an unnamed commit"}, not ${input.head}, and the ` +
    "change since is either executable or unclassified."
  );
}

export function preflight(input: PreflightInput): PreflightReport {
  const checks: PreflightCheck[] = [];

  const gate = (name: string, evidence: Evidence | undefined) => {
    const state = evidenceState(name, evidence, input);
    checks.push({
      name,
      state,
      kind: "INTERNAL",
      detail:
        state === "MISSING"
          ? `No ${name} evidence for this HEAD. Absent is not passing.`
          : state === "STALE"
            ? `${name} passed at ${evidence?.commit}, not ${input.head}` +
              `${(input.changesSinceEvidence ?? []).length > 0 ? ` (${(input.changesSinceEvidence ?? []).join(", ")})` : " and no change classification was supplied"}.`
            : state === "FAIL"
              ? (evidence?.detail ?? `${name} failed.`)
              : `${name} passed at ${evidence?.commit}.`,
    });
  };

  gate("tests", input.tests);
  gate("typecheck", input.typecheck);
  gate("lint", input.lint);
  gate("format", input.format);
  gate("build", input.build);
  gate("e2e", input.e2e);
  gate("migrations", input.migrations);
  gate("verifyCoverage", input.verifyCoverage);

  const counted = (name: string, value: number | undefined, kind: "INTERNAL" | "EXTERNAL") =>
    checks.push({
      name,
      kind,
      state: value === undefined ? "MISSING" : value === 0 ? "PASS" : "FAIL",
      detail:
        value === undefined
          ? `${name} was never counted, and unknown is not zero.`
          : value === 0
            ? `${name}: none outstanding at this HEAD.`
            : `${name}: ${value} outstanding, which blocks the candidate.`,
    });

  counted("open P0", input.openP0, "INTERNAL");
  counted("open P1", input.openP1, "INTERNAL");
  counted("unhandled review findings", input.unhandledReviewFindings, "INTERNAL");

  // P2 is deliberately not a BLOCKER. It is still evidence, and the first version conflated the
  // two: an omitted count reported PASS with the sentence "0 deferred P2, each recorded with a
  // reason" — a claim about a register nobody had looked at. Not blocking and not measured are
  // different, and only the first is a decision.
  checks.push({
    name: "open P2",
    kind: "INTERNAL",
    state: input.openP2 === undefined ? "MISSING" : "PASS",
    detail:
      input.openP2 === undefined
        ? "The deferred-P2 register was never counted, so nothing here can vouch for it."
        : `${input.openP2} deferred P2, each recorded with a reason. Not a release gate.`,
  });

  // Declared and then ignored, which is its own small failure: a field that looks like a check and
  // is not one reads as coverage that does not exist. Non-blocking like P2, and measured.
  checks.push({
    name: "review debt",
    kind: "INTERNAL",
    state: input.reviewDebtItems === undefined ? "MISSING" : "PASS",
    detail:
      input.reviewDebtItems === undefined
        ? "Review debt was never counted, and an unread register is not an empty one."
        : `${input.reviewDebtItems} review-debt item(s) recorded. Not a release gate.`,
  });

  checks.push({
    name: "tree clean",
    kind: "INTERNAL",
    state: input.treeClean ? "PASS" : "FAIL",
    detail: input.treeClean ? "No uncommitted changes." : "Uncommitted changes at HEAD.",
  });

  checks.push({
    name: "pushed to remote",
    kind: "INTERNAL",
    state: input.pushedToRemote ? "PASS" : "FAIL",
    detail: input.pushedToRemote
      ? "HEAD exists on the remote."
      : "HEAD is local only, so the candidate exists on one machine.",
  });

  checks.push({
    name: "final independent review",
    kind: "INTERNAL",
    state: finalReviewState(input),
    detail: finalReviewDetail(input),
  });

  // External conditions. Real, and categorically different from a defect — they cannot be fixed by
  // working harder, and reporting them as internal failures would make a release look broken when
  // it is waiting.
  // Every external input fails closed, which it did not until the adversarial review pointed out
  // (IR-054) that this module states "missing evidence is never PASS" at the top of the file and
  // then wrote `?? []` and `?? 0` for exactly these three. An unsupplied gate list was read as no
  // gates. The rule was right and the code did not follow it.
  checks.push({
    name: "human gates",
    kind: "EXTERNAL",
    state:
      input.openHumanGates === undefined
        ? "MISSING"
        : input.openHumanGates.length === 0
          ? "PASS"
          : "FAIL",
    detail:
      input.openHumanGates === undefined
        ? "Open gates were never enumerated, and unknown is not none."
        : input.openHumanGates.length === 0
          ? "No open gates."
          : `Open: ${input.openHumanGates.join(", ")}.`,
  });

  checks.push({
    name: "provider capability verified",
    kind: "EXTERNAL",
    state:
      input.unverifiedProviders === undefined
        ? "MISSING"
        : input.unverifiedProviders.length === 0
          ? "PASS"
          : "FAIL",
    detail:
      input.unverifiedProviders === undefined
        ? "Provider verification state was never established."
        : input.unverifiedProviders.length === 0
          ? "Every provider verified against a live response."
          : `Unverified for want of a key: ${input.unverifiedProviders.join(", ")}.`,
  });

  checks.push({
    name: "escalations transmitted",
    kind: "EXTERNAL",
    state:
      input.queuedEscalations === undefined
        ? "MISSING"
        : input.queuedEscalations === 0
          ? "PASS"
          : "FAIL",
    detail:
      input.queuedEscalations === undefined
        ? "The outbound queue was never inspected."
        : input.queuedEscalations === 0
          ? "Nothing queued untransmitted."
          : `${input.queuedEscalations} escalation(s) queued and not transmitted.`,
  });

  checks.push({
    name: "control bus watching",
    kind: "EXTERNAL",
    state:
      input.controlBusWatcher === undefined
        ? "MISSING"
        : input.controlBusWatcher === "ALIVE"
          ? "PASS"
          : "FAIL",
    detail:
      input.controlBusWatcher === undefined
        ? "Watcher state was never established, which is not the same as knowing it is down."
        : input.controlBusWatcher === "ALIVE"
          ? "Watcher alive; a decision would be read."
          : "Watcher not running, so a decision posted now would not be seen.",
  });

  // Order matters and encodes the precedence. A failing internal check outranks a stale one,
  // because a red suite is a defect whereas a stale suite is an unanswered question; both outrank
  // an external gate, because there is no point waiting on the world for a build that is broken.
  const internal = checks.filter((c) => c.kind === "INTERNAL");
  const failing = internal.filter((c) => c.state === "FAIL");
  const stale = internal.filter((c) => c.state === "STALE");
  const missing = internal.filter((c) => c.state === "MISSING");
  const externalMissing = checks.filter((c) => c.kind === "EXTERNAL" && c.state === "MISSING");
  const external = checks.filter(
    (c) => c.kind === "EXTERNAL" && c.state !== "PASS" && c.state !== "MISSING",
  );

  const name = (list: PreflightCheck[]) => list.map((c) => c.name).join(", ");

  if (failing.length > 0) {
    return {
      verdict: "RELEASE_CANDIDATE_BLOCKED_INTERNAL",
      checks,
      rationale: `Blocked by ${name(failing)} — defects, not waiting.`,
    };
  }
  // Missing outranks stale, which is the reverse of the first version. Stale evidence says "it
  // passed, elsewhere"; missing says nothing at all, and the weaker claim should decide the
  // verdict. Reporting EVIDENCE_STALE while a check was never run describes the better half of
  // the situation.
  if (missing.length > 0 || externalMissing.length > 0) {
    return {
      verdict: "EVIDENCE_INSUFFICIENT",
      checks,
      rationale:
        `Never established for this HEAD: ${name([...missing, ...externalMissing])}. ` +
        "Absent evidence is not passing evidence.",
    };
  }
  if (stale.length > 0) {
    return {
      verdict: "EVIDENCE_STALE",
      checks,
      rationale: `${name(stale)} passed against an earlier commit; the change since could have invalidated it.`,
    };
  }
  if (external.length > 0) {
    return {
      verdict: "RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES",
      checks,
      rationale: `Every internal check is green against ${input.head}. Waiting on ${name(external)}.`,
    };
  }
  return {
    verdict: "RELEASE_CANDIDATE_READY",
    checks,
    rationale: `Every internal and external condition satisfied against ${input.head}.`,
  };
}
