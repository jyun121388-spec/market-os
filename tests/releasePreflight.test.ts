import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PreflightInput } from "@/server/release/preflight";
import { preflight } from "@/server/release/preflight";

/**
 * PHASE — RC PREFLIGHT AUTOMATION. Current repository evidence in, release status out.
 *
 * The two properties worth stating, because each replaces a habit that feels reasonable:
 *
 * **Missing evidence is never PASS.** Every input is optional and every absent one resolves toward
 * `EVIDENCE_INSUFFICIENT`. "We did not check" and "it passed" are different facts, and a release
 * process that treats them alike will eventually ship on the first one.
 *
 * **Evidence belongs to a commit.** A green suite is a statement about the tree it ran against, so
 * evidence gathered before a change that could invalidate it is STALE rather than green — and a
 * docs-only commit invalidates no build, which is the half that keeps this usable. Re-running
 * everything constantly and trusting a proof forever are both failures, and only one of them is
 * usually recognised as one.
 *
 * The verdict for the current repository is computed by the diagnostic script, never asserted
 * here. A test that hardcoded today's answer would go green on a broken tree the moment the
 * answer changed for a bad reason.
 */

const green = (commit: string) => ({ commit, state: "PASS" as const });

const allGreen = (head: string): PreflightInput => ({
  head,
  changesSinceEvidence: [],
  treeClean: true,
  pushedToRemote: true,
  tests: green(head),
  typecheck: green(head),
  lint: green(head),
  format: green(head),
  build: green(head),
  e2e: green(head),
  migrations: green(head),
  verifyCoverage: green(head),
  openP0: 0,
  openP1: 0,
  openP2: 5,
  unhandledReviewFindings: 0,
  finalReviewDone: true,
  openHumanGates: [],
  unverifiedProviders: [],
  queuedEscalations: 0,
  controlBusWatcher: "ALIVE",
});

describe("the preflight refuses to infer readiness", () => {
  it("reports READY only when every internal and external condition holds", () => {
    expect(preflight(allGreen("abc1234")).verdict).toBe("RELEASE_CANDIDATE_READY");
  });

  it("blocks internally on an open P1", () => {
    const report = preflight({ ...allGreen("abc1234"), openP1: 1 });
    expect(report.verdict).toBe("RELEASE_CANDIDATE_BLOCKED_INTERNAL");
    expect(report.rationale).toContain("open P1");
  });

  it("does not gate a release on deferred P2s", () => {
    // Each is recorded with a reason and pinned by a test that fails if it is fixed silently.
    // Blocking here would either stop the release forever or create pressure to reclassify them,
    // and the second is the one that quietly destroys the register.
    expect(preflight({ ...allGreen("abc1234"), openP2: 12 }).verdict).toBe(
      "RELEASE_CANDIDATE_READY",
    );
  });

  it.each(["tests", "typecheck", "build", "e2e", "migrations", "verifyCoverage"] as const)(
    "treats missing %s evidence as insufficient, not as passing",
    (missing) => {
      const input = { ...allGreen("abc1234") };
      delete input[missing];
      const report = preflight(input);
      expect(report.verdict).toBe("EVIDENCE_INSUFFICIENT");
      expect(report.rationale).toContain(missing);
    },
  );

  it("refuses when nobody counted the P1s", () => {
    const input = { ...allGreen("abc1234") };
    delete input.openP1;
    expect(preflight(input).verdict).toBe("EVIDENCE_INSUFFICIENT");
  });

  it("refuses when the final review status is unknown", () => {
    // A reviewer's absence is not a clean review, and this is the check most likely to be waved
    // through on the grounds that everything else is green.
    const input = { ...allGreen("abc1234") };
    delete input.finalReviewDone;
    expect(preflight(input).verdict).toBe("EVIDENCE_INSUFFICIENT");
  });
});

describe("evidence belongs to the commit it was gathered against", () => {
  it("goes stale when application code changed after the suite ran", () => {
    const report = preflight({
      ...allGreen("old1111"),
      head: "new2222",
      changesSinceEvidence: ["APPLICATION_CODE"],
    });
    expect(report.verdict).toBe("EVIDENCE_STALE");
    expect(report.rationale).toContain("tests");
  });

  it("stales the E2E on a request-path change without stalling the whole suite", () => {
    const report = preflight({
      ...allGreen("old1111"),
      head: "new2222",
      changesSinceEvidence: ["UI_OR_REQUEST_PATH"],
    });
    expect(report.verdict).toBe("EVIDENCE_STALE");
    const e2e = report.checks.find((c) => c.name === "e2e");
    const typecheck = report.checks.find((c) => c.name === "typecheck");
    expect(e2e?.state).toBe("STALE");
    // A route change does not invalidate a typecheck that already covered the tree it ran on.
    expect(typecheck?.state).toBe("PASS");
  });

  it("stales migration evidence only on a schema change", () => {
    const docsOnly = preflight({
      ...allGreen("old1111"),
      head: "new2222",
      changesSinceEvidence: ["DOCS_ONLY"],
    });
    expect(docsOnly.checks.find((c) => c.name === "migrations")?.state).toBe("PASS");

    const schema = preflight({
      ...allGreen("old1111"),
      head: "new2222",
      changesSinceEvidence: ["MIGRATION_OR_SCHEMA"],
    });
    expect(schema.checks.find((c) => c.name === "migrations")?.state).toBe("STALE");
  });

  it("does not invalidate a build for a documentation commit", () => {
    // The other half of the rule, and the half that decides whether anyone keeps using this. A
    // preflight that demands a full rebuild after a typo fix gets bypassed within a week.
    const report = preflight({
      ...allGreen("old1111"),
      head: "new2222",
      changesSinceEvidence: ["DOCS_ONLY"],
    });
    expect(report.checks.find((c) => c.name === "build")?.state).toBe("PASS");
    expect(report.verdict).not.toBe("RELEASE_CANDIDATE_BLOCKED_INTERNAL");
  });
});

describe("external waiting is not internal failure", () => {
  it("reports pending on an absent provider key with everything else green", () => {
    const report = preflight({
      ...allGreen("abc1234"),
      unverifiedProviders: ["FRED", "ECOS", "OPENDART"],
    });
    expect(report.verdict).toBe("RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES");
    expect(report.rationale).toContain("provider capability verified");
  });

  it("reports pending on an open human gate", () => {
    expect(preflight({ ...allGreen("abc1234"), openHumanGates: ["HG-009"] }).verdict).toBe(
      "RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES",
    );
  });

  it("reports pending while an escalation is queued and not transmitted", () => {
    expect(preflight({ ...allGreen("abc1234"), queuedEscalations: 3 }).verdict).toBe(
      "RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES",
    );
  });

  it("puts an internal defect ahead of any amount of external waiting", () => {
    // Precedence matters: there is no point waiting on the world for a build that is broken, and
    // reporting this as PENDING would make a defect look like patience.
    const report = preflight({
      ...allGreen("abc1234"),
      openP1: 2,
      openHumanGates: ["HG-009"],
      unverifiedProviders: ["FRED"],
    });
    expect(report.verdict).toBe("RELEASE_CANDIDATE_BLOCKED_INTERNAL");
  });

  it("treats a dirty tree and an unpushed HEAD as internal", () => {
    expect(preflight({ ...allGreen("abc1234"), treeClean: false }).verdict).toBe(
      "RELEASE_CANDIDATE_BLOCKED_INTERNAL",
    );
    expect(preflight({ ...allGreen("abc1234"), pushedToRemote: false }).verdict).toBe(
      "RELEASE_CANDIDATE_BLOCKED_INTERNAL",
    );
  });

  it("notices a stopped control-bus watcher", () => {
    const report = preflight({ ...allGreen("abc1234"), controlBusWatcher: "STOPPED" });
    expect(report.verdict).toBe("RELEASE_CANDIDATE_PENDING_EXTERNAL_GATES");
    expect(report.checks.find((c) => c.name === "control bus watching")?.detail).toContain(
      "would not be seen",
    );
  });
});

describe("the report is auditable", () => {
  it("gives every check a stated reason", () => {
    for (const check of preflight(allGreen("abc1234")).checks) {
      expect(check.detail.length, check.name).toBeGreaterThan(10);
    }
  });

  it("names the checks that decided the verdict", () => {
    const report = preflight({ ...allGreen("abc1234"), openP0: 1 });
    expect(report.rationale).toContain("open P0");
  });

  it("cannot act on its own conclusion", () => {
    // The preflight is read-only by construction, not by convention. If it ever imports something
    // that can merge, push or deploy, this is where that shows up.
    const source = readFileSync(join(process.cwd(), "src/server/release/preflight.ts"), "utf8");
    expect(source).not.toMatch(/child_process|\bexecSync\b|\bfetch\(|prisma/);
  });
});
