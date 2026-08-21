/**
 * Verifying a frozen release pair from the git objects it names, not from the working tree.
 *
 * The preflight normally reports on HEAD, and that is right when HEAD is the candidate. It stops
 * being right the moment follow-up work starts: the release pair is frozen at two commits, the
 * branch you are standing on is somewhere else, and a dirty tool worktree is not evidence that the
 * frozen candidate is dirty. Reporting it as such would be the same confusion as reading a skip as
 * a pass — a fact about one thing, presented as a fact about another.
 *
 * So this takes two explicit SHAs and asks git about THEM. Every input is a git object: the trees
 * are read with `git show <sha>:<path>`, the diff comes from `git diff <a> <b>`, and the ancestry
 * is `merge-base --is-ancestor`. Nothing here consults the checkout, so it answers the same way
 * from any branch and with any amount of uncommitted work in progress.
 *
 * Pure apart from the reader it is handed, which is what makes it testable without a repository.
 */

import { parseAttestation } from "./attestation";
import { isEvidenceOnlyPath } from "./preflight";

/** The git facts this needs, injected so the checks can be exercised without a real repository. */
export interface GitReader {
  /** True when the object exists. */
  exists(sha: string): boolean;
  /** True when `ancestor` is an ancestor of `descendant`. */
  isAncestor(ancestor: string, descendant: string): boolean;
  /** Paths differing between two commits. */
  changedPaths(from: string, to: string): string[];
  /** Number of commits in `from..to`. */
  commitCount(from: string, to: string): number;
  /** File content at a commit, or null when the path does not exist there. */
  fileAt(sha: string, path: string): string | null;
}

export type CheckState = "PASS" | "FAIL" | "UNKNOWN";

export interface FrozenPairCheck {
  name: string;
  state: CheckState;
  detail: string;
}

export interface FrozenPairReport {
  reviewedCodeSha: string;
  attestationSha: string;
  checks: FrozenPairCheck[];
  /** True only when every check passed. UNKNOWN never counts as passing. */
  valid: boolean;
}

const ATTESTATION_JSON = "docs/REVIEW_ATTESTATION.json";
const ATTESTATION_MD = "docs/REVIEW_ATTESTATION.md";

/**
 * Whether the two named commits really are a valid reviewed/attestation pair.
 *
 * Deliberately says nothing about external gates, deployment, merge readiness, or the state of the
 * escalation queue. It answers one question — is this pair structurally sound — so that a caller
 * reporting release state cannot accidentally borrow its authority for anything else.
 *
 * The queue check lived here for one revision and was wrong to. At the frozen commit the queue
 * document predates the structured-record format, so the parser correctly reports it unreadable,
 * and a structurally perfect pair came back NOT VALID for a reason that has nothing to do with
 * whether the pair is sound. A check that can fail for reasons outside the question it answers
 * makes the answer useless. The caller reports queue state separately, and labels which tree it
 * read it from.
 */
export function verifyFrozenPair(
  reviewedCodeSha: string,
  attestationSha: string,
  git: GitReader,
): FrozenPairReport {
  const checks: FrozenPairCheck[] = [];
  const add = (name: string, state: CheckState, detail: string) =>
    checks.push({ name, state, detail });

  const reviewedExists = git.exists(reviewedCodeSha);
  const attestationExists = git.exists(attestationSha);
  add(
    "reviewed SHA exists",
    reviewedExists ? "PASS" : "FAIL",
    reviewedExists
      ? `${reviewedCodeSha} is a commit in this repository.`
      : `${reviewedCodeSha} is not an object here.`,
  );
  add(
    "attestation SHA exists",
    attestationExists ? "PASS" : "FAIL",
    attestationExists
      ? `${attestationSha} is a commit in this repository.`
      : `${attestationSha} is not an object here.`,
  );

  if (!reviewedExists || !attestationExists) {
    return { reviewedCodeSha, attestationSha, checks, valid: false };
  }

  // Direction, not merely difference. Attest a DESCENDANT and the diff back to the candidate holds
  // only the attestation, so a review of code that does not exist yet would read as covering the
  // code that does.
  const ancestor = git.isAncestor(reviewedCodeSha, attestationSha);
  add(
    "reviewed SHA is an ancestor of the attestation SHA",
    ancestor ? "PASS" : "FAIL",
    ancestor
      ? "The attestation is downstream of the code it attests."
      : "The attestation is not downstream of the reviewed code. A diff has no direction of its own.",
  );

  const changed = git.changedPaths(reviewedCodeSha, attestationSha);
  const nonEvidence = changed.filter((path) => !isEvidenceOnlyPath(path));
  add(
    "no executable change between them",
    nonEvidence.length === 0 ? "PASS" : "FAIL",
    nonEvidence.length === 0
      ? `Changed: ${changed.join(", ") || "nothing"} — all on the evidence-only allowlist.`
      : `Changed outside the allowlist: ${nonEvidence.join(", ")}.`,
  );

  const expected = [ATTESTATION_JSON, ATTESTATION_MD].sort().join(", ");
  const actual = [...changed].sort().join(", ");
  add(
    "diff is exactly the two attestation files",
    actual === expected ? "PASS" : "FAIL",
    actual === expected ? expected : `Expected ${expected}; found ${actual || "nothing"}.`,
  );

  const commits = git.commitCount(reviewedCodeSha, attestationSha);
  add(
    "attestation is a single commit",
    commits === 1 ? "PASS" : "FAIL",
    `${commits} commit(s) between the pair.`,
  );

  // The attestation is read from the ATTESTATION COMMIT'S TREE. Reading the working copy would let
  // an edited file speak for a frozen commit, which is the entire failure this function exists to
  // avoid.
  const rawAttestation = git.fileAt(attestationSha, ATTESTATION_JSON);
  if (rawAttestation === null) {
    add("attestation present at that commit", "FAIL", `${ATTESTATION_JSON} does not exist there.`);
    return { reviewedCodeSha, attestationSha, checks, valid: false };
  }
  add(
    "attestation present at that commit",
    "PASS",
    `${ATTESTATION_JSON} read from the commit tree.`,
  );

  const parsed = parseAttestation(rawAttestation);
  if (!parsed) {
    // Unreadable is not negative, and it is certainly not positive.
    add(
      "attestation parses",
      "UNKNOWN",
      "The document could not be parsed. Unreadable is not clean.",
    );
    return { reviewedCodeSha, attestationSha, checks, valid: false };
  }
  add(
    "attestation parses",
    "PASS",
    `verdict ${parsed.verdict}, reviewedCodeSha ${parsed.reviewedCodeSha}.`,
  );

  add(
    "attestation names this candidate",
    parsed.reviewedCodeSha === reviewedCodeSha ? "PASS" : "FAIL",
    parsed.reviewedCodeSha === reviewedCodeSha
      ? "The attested SHA is the candidate being verified."
      : `The attestation names ${parsed.reviewedCodeSha}, not ${reviewedCodeSha}.`,
  );

  add("verdict is CLEAN", parsed.clean ? "PASS" : "FAIL", `verdict: ${parsed.verdict}.`);

  return {
    reviewedCodeSha,
    attestationSha,
    checks,
    valid: checks.every((check) => check.state === "PASS"),
  };
}
