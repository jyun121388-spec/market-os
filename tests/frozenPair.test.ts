import { describe, expect, it } from "vitest";
import { verifyFrozenPair, type GitReader } from "@/server/release/frozenPair";

/**
 * Verifying a frozen pair from git objects rather than from the working tree.
 *
 * The failure this guards against is subtle and was live: once follow-up work starts, the branch
 * you are standing on is not the candidate, and the preflight's HEAD-based answers stop describing
 * the release. A dirty tool worktree reported as a dirty candidate is a fact about one thing
 * presented as a fact about another.
 *
 * The reader is injected, so every one of these cases is exercised without constructing a
 * repository — including the ones a real repository makes awkward to produce, like an attestation
 * that names a different commit than the one it sits on.
 */

const REVIEWED = "c03aa73e2ced798dd65a17c013c4a11051a74b4c";
const ATTESTATION = "fb3a72193ade11da265fbc496ffd1a38bdd734e4";
const JSON_PATH = "docs/REVIEW_ATTESTATION.json";
const MD_PATH = "docs/REVIEW_ATTESTATION.md";

function attestation(sha: string, verdict: "CLEAN" | "NOT_CLEAN" = "CLEAN"): string {
  return JSON.stringify({ reviewedCodeSha: sha, verdict }, null, 2);
}

/** A reader describing a sound pair, with individual facts overridable per test. */
function reader(overrides: Partial<GitReader> = {}): GitReader {
  return {
    exists: () => true,
    isAncestor: () => true,
    changedPaths: () => [JSON_PATH, MD_PATH],
    commitCount: () => 1,
    fileAt: (_sha, path) => (path === JSON_PATH ? attestation(REVIEWED) : null),
    ...overrides,
  };
}

const failed = (report: ReturnType<typeof verifyFrozenPair>) =>
  report.checks.filter((c) => c.state !== "PASS").map((c) => c.name);

describe("verifyFrozenPair", () => {
  it("accepts a sound pair", () => {
    const report = verifyFrozenPair(REVIEWED, ATTESTATION, reader());
    expect(failed(report)).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("reads the attestation from the commit tree, not from disk", () => {
    // The whole point. If it read the checkout, an edited file would speak for a frozen commit.
    const seen: string[] = [];
    verifyFrozenPair(
      REVIEWED,
      ATTESTATION,
      reader({
        fileAt: (sha, path) => {
          seen.push(`${sha}:${path}`);
          return path === JSON_PATH ? attestation(REVIEWED) : null;
        },
      }),
    );
    expect(seen).toContain(`${ATTESTATION}:${JSON_PATH}`);
  });

  it("refuses when a named commit does not exist", () => {
    const report = verifyFrozenPair(
      REVIEWED,
      ATTESTATION,
      reader({ exists: (sha) => sha === REVIEWED }),
    );
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("attestation SHA exists");
  });

  it("refuses an attestation that is not downstream of the code", () => {
    // Attest a DESCENDANT and the diff back to the candidate holds only the attestation, so a
    // review of code that does not exist yet would read as covering the code that does. A diff
    // has no direction of its own.
    const report = verifyFrozenPair(REVIEWED, ATTESTATION, reader({ isAncestor: () => false }));
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("reviewed SHA is an ancestor of the attestation SHA");
  });

  it("refuses an executable change between the pair", () => {
    const report = verifyFrozenPair(
      REVIEWED,
      ATTESTATION,
      reader({ changedPaths: () => [JSON_PATH, MD_PATH, "src/server/domain/askMarket.ts"] }),
    );
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("no executable change between them");
  });

  it("refuses an unclassified path between the pair", () => {
    // The fail-closed default that matters: a path nobody has classified is not thereby harmless.
    const report = verifyFrozenPair(
      REVIEWED,
      ATTESTATION,
      reader({ changedPaths: () => [JSON_PATH, MD_PATH, "docs/something-new.md"] }),
    );
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("no executable change between them");
  });

  it("refuses more than one commit between the pair", () => {
    const report = verifyFrozenPair(REVIEWED, ATTESTATION, reader({ commitCount: () => 3 }));
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("attestation is a single commit");
  });

  it("refuses an attestation naming a different candidate", () => {
    const report = verifyFrozenPair(
      REVIEWED,
      ATTESTATION,
      reader({ fileAt: (_s, path) => (path === JSON_PATH ? attestation("0".repeat(40)) : null) }),
    );
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("attestation names this candidate");
  });

  it("refuses a NOT_CLEAN verdict", () => {
    const report = verifyFrozenPair(
      REVIEWED,
      ATTESTATION,
      reader({
        fileAt: (_s, path) => (path === JSON_PATH ? attestation(REVIEWED, "NOT_CLEAN") : null),
      }),
    );
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("verdict is CLEAN");
  });

  it("treats an unparseable attestation as unknown, not as negative and not as clean", () => {
    const report = verifyFrozenPair(
      REVIEWED,
      ATTESTATION,
      reader({ fileAt: (_s, path) => (path === JSON_PATH ? "{ not json" : null) }),
    );
    expect(report.valid).toBe(false);
    const parseCheck = report.checks.find((c) => c.name === "attestation parses");
    expect(parseCheck?.state).toBe("UNKNOWN");
  });

  it("refuses when the attestation is absent from that commit", () => {
    const report = verifyFrozenPair(REVIEWED, ATTESTATION, reader({ fileAt: () => null }));
    expect(report.valid).toBe(false);
    expect(failed(report)).toContain("attestation present at that commit");
  });

  it("says nothing about the working tree", () => {
    // Scope, asserted. Nothing in the report may depend on the checkout, because the checkout is
    // where follow-up work happens and the pair is frozen elsewhere.
    const report = verifyFrozenPair(REVIEWED, ATTESTATION, reader());
    // "clean" alone would match "verdict is CLEAN", which is the attestation's verdict and has
    // nothing to do with the checkout — so the pattern names worktree concepts specifically.
    const names = report.checks.map((c) => c.name).join(" ");
    expect(names).not.toMatch(/worktree|working tree|uncommitted|tree clean|staged/i);
  });

  it("says nothing about external gates or the escalation queue", () => {
    // It answers one question. A check that can fail for reasons outside that question makes the
    // answer useless — which is exactly what happened when the queue check lived here: at the
    // frozen commit the queue document predates the structured format, so a structurally perfect
    // pair came back NOT VALID.
    const report = verifyFrozenPair(REVIEWED, ATTESTATION, reader());
    const names = report.checks.map((c) => c.name).join(" ");
    expect(names).not.toMatch(/queue|human gate|provider|deploy|merge/i);
  });
});
