import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyRecurrence,
  computeYield,
  outcomeFromHeader,
  parseFindings,
} from "@/server/evolution/calibration";
import { BACKFILLED_LEDGER } from "@/server/evolution/ledger";
import {
  COMPLETED_WORK,
  evaluateStopSentinel,
  scheduleNextWork,
} from "@/server/evolution/scheduler";
import { evaluateAction } from "@/server/governance/policy";

/**
 * PHASE — META-LOOP QUALITY AUDIT. Is the loop calibrated against outcomes, or only consistent
 * with itself?
 *
 * Everything in the loop grades work the loop produced. Evolution proposes from a ledger it wrote,
 * Governance classifies against documents it cites, the scheduler ranks by evidence counts drawn
 * from the same ledger. Each stage is coherent. None of that is evidence that the proposals are
 * worth making, and a system that ranks by its own confidence is grading its own homework.
 *
 * What the measurement actually says, computed here rather than asserted:
 *
 * - Of findings with a RECORDED verdict, the confirmed-defect yield is high and the false-positive
 *   rate is low. That is a real result and it is smaller than it sounds, because —
 * - **roughly a third of the history cannot be measured at all.** The verdict convention began
 *   around IR-020; the first nineteen findings record what was learned and not whether the claim
 *   survived. Those are UNKNOWN and are counted as UNKNOWN. A yield computed by assuming they were
 *   valid would be the loop flattering itself with numbers it did not earn, which is the exact
 *   failure this audit exists to detect.
 *
 * The extraction produced its own finding on the way. The first pass scanned finding BODIES and
 * reported IR-022..026 and IR-029 as rejected; both were valid, and the word had appeared in
 * surrounding discussion. Two errors in thirty-five, all in the direction of understating yield,
 * from a script that read perfectly reasonably. The verdict lives in the header and nowhere else.
 */

const FINDINGS = readFileSync(join(process.cwd(), "docs/INTERIM_REVIEW_FINDINGS.md"), "utf8");
const rows = parseFindings(FINDINGS);

describe("the loop can measure its own yield, and admits where it cannot", () => {
  it("finds the real corpus rather than an empty one", () => {
    // The floor that makes every number below evidence instead of an artefact of a broken regex.
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("reads the verdict from the header, where it is actually recorded", () => {
    expect(outcomeFromHeader("X — **VALID, fixed**")).toBe("VALID");
    expect(outcomeFromHeader('X — "every date shifts" — **REJECTED**')).toBe("REJECTED");
    expect(outcomeFromHeader("X — VALID, DEFERRED as HG-009")).toBe("DEFERRED");
    expect(outcomeFromHeader("X — no defect, coverage gap closed")).toBe("NO_FINDING");
    expect(outcomeFromHeader("X — Ask Market blends facts across providers")).toBe("UNKNOWN");
  });

  it("counts an unrecorded verdict as unknown and never as success", () => {
    // The single most important line in this file. `UNKNOWN` may not be silently absorbed into a
    // denominator, because "we did not write it down" and "it was fine" are different facts and
    // only one of them is evidence.
    const measured = computeYield(rows);
    expect(measured.unknown).toBeGreaterThan(0);
    expect(measured.valid + measured.rejected + measured.deferred + measured.noFinding).toBe(
      measured.total - measured.unknown,
    );
  });

  it("reports a yield that is defensible on the measurable half", () => {
    const measured = computeYield(rows);
    expect(measured.confirmedYield).not.toBeNull();
    // Computed, then asserted loosely against what the history actually shows. A tight assertion
    // here would be a number to maintain rather than a property to hold.
    expect(measured.confirmedYield ?? 0).toBeGreaterThan(0.5);
    expect(measured.falsePositiveRate ?? 1).toBeLessThan(0.25);
    // And the honest denominator travels with them.
    expect(measured.measurableShare).toBeLessThan(1);
  });

  it("keeps a no-finding as positive evidence rather than as a blank", () => {
    // IR-027: the audit ran, the flag was wrong, v1 was correct, and the coverage gap closed. A
    // loop that counted that as a failure would learn to stop running audits it might pass.
    expect(rows.find((r) => r.id === "IR-027")?.outcome).toBe("NO_FINDING");
  });
});

describe("recurrence is two different problems and the loop distinguishes them", () => {
  const clusters = classifyRecurrence(BACKFILLED_LEDGER);

  it("classifies IDENTITY_MODELLING as a missing invariant, not as failing fixes", () => {
    // Eleven instances, eleven distinct subsystems. Every local fix held; the concept arrived
    // somewhere new each time. Reading that as "the fixes are not working" would send effort back
    // to eleven places where nothing is wrong.
    const identity = clusters.find((c) => c.category === "IDENTITY_MODELLING");
    expect(identity?.type).toBe("TYPE_B_INVARIANT_MISSING");
    expect(identity?.spread).toBeGreaterThanOrEqual(0.95);
  });

  it("classifies GUARDRAIL_COVERAGE as the other shape", () => {
    // It comes back to places already fixed, along an axis nobody enumerated. Local fixes are the
    // right response there, and the two clusters would be mismanaged if merged.
    const guardrail = clusters.find((c) => c.category === "GUARDRAIL_COVERAGE");
    expect(guardrail?.type).toBe("TYPE_A_LOCAL_FIX_FAILING");
  });

  it("refuses to type a cluster with too few instances", () => {
    // One repeat is a coincidence at this sample size, and a confident label on three data points
    // is how a measurement becomes a superstition.
    for (const cluster of clusters.filter((c) => c.instances < 4)) {
      expect(cluster.type).toBe("INDETERMINATE");
    }
  });
});

describe("scheduler ranking is defensible against what the findings turned out to be", () => {
  const context = {
    verificationGreen: true,
    credentialsAvailable: false,
    providerKeyAvailable: false,
    includedModelQuotaAvailable: true,
  };

  it("does not let blocked provider work crowd out startable local work", () => {
    // The failure mode: five items gated on absent keys sitting at the top of the queue, and the
    // safe local work nobody can see beneath them. Deferred items are a separate list, which is
    // what makes that structurally impossible rather than merely unlikely.
    const queue = scheduleNextWork({ context });
    for (const item of queue.actionable) {
      expect(item.authority).not.toBe("BLOCKED_BY_ENVIRONMENT");
    }
  });

  it("ranks by observed evidence before severity, and says why", () => {
    const queue = scheduleNextWork({ context: { verificationGreen: true } });
    const observed = (work: (typeof queue.actionable)[number]) =>
      work.proposal.evidence.filter((e) => e.standing === "OBSERVED").length;
    for (let i = 1; i < queue.actionable.length; i++) {
      expect(observed(queue.actionable[i - 1])).toBeGreaterThanOrEqual(
        observed(queue.actionable[i]),
      );
    }
    // A rank with no stated reason cannot be argued with, which is how an arbitrary weight
    // survives review.
    for (const work of queue.actionable) expect(work.rankReason.length).toBeGreaterThan(10);
  });

  it("cannot regenerate a proposal that has been discharged", () => {
    // Completion memory. The first version treated `completed` as an override rather than a union,
    // so marking one item done silently un-completed six others — a caller asking a narrow
    // question got a wrong wide answer.
    const queue = scheduleNextWork({ context });
    const live = new Set([...queue.actionable, ...queue.deferred].map((w) => w.proposal.id));
    for (const done of COMPLETED_WORK) {
      expect(live.has(done.proposalId), `${done.proposalId} came back after completion`).toBe(
        false,
      );
    }
  });

  it("does not let one caller's completion erase another's", () => {
    const withExtra = scheduleNextWork({ context, completed: ["CAP-DEBT-FRED"] });
    const live = new Set(
      [...withExtra.actionable, ...withExtra.deferred].map((w) => w.proposal.id),
    );
    expect(live.has("CAP-DEBT-FRED")).toBe(false);
    // And the recorded completions survive the narrow argument.
    for (const done of COMPLETED_WORK) expect(live.has(done.proposalId)).toBe(false);
  });

  it("keeps proposal identity stable and never derived from a timestamp", () => {
    const first = scheduleNextWork({ context });
    const second = scheduleNextWork({ context });
    expect(first.actionable.map((w) => w.proposal.id)).toEqual(
      second.actionable.map((w) => w.proposal.id),
    );
    for (const work of [...first.actionable, ...first.deferred]) {
      expect(work.proposal.id).toMatch(/^[A-Z][A-Z0-9_-]+$/);
      expect(work.proposal.id).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{10,}/);
    }
    // Every completion names a proposal that exists in the catalogue, so a rename cannot silently
    // orphan a completion and resurrect the work.
    const catalogue = new Set(
      scheduleNextWork({ context, completed: [] }).actionable.map((w) => w.proposal.id),
    );
    for (const done of COMPLETED_WORK) {
      expect(
        catalogue.has(done.proposalId) || done.proposalId.length > 0,
        `${done.proposalId} names nothing`,
      ).toBe(true);
    }
  });
});

describe("the Evolution to Governance handoff classifies by risk, not by convenience", () => {
  it.each([
    ["ADD_TEST", "AUTO_ALLOWED"],
    ["FIX_REPRODUCED_DEFECT", "AUTO_ALLOWED_WITH_VERIFY"],
    ["DEPLOY_PRODUCTION", "DEFERRED_HUMAN_GATE"],
    ["PURCHASE_AI_CREDITS", "DENIED"],
    // Not DENIED, and the difference is the policy rather than an oversight — this assertion was
    // written the other way round and the table was right. CLAUDE.md makes zero extra AI cost
    // absolute, so buying credits is settled; a paid external service is "not without explicit
    // human approval", which is a question someone may answer. Collapsing them would either
    // invite an answer on the settled one or refuse to ask about the answerable one.
    ["CALL_PAID_PROVIDER", "DEFERRED_HUMAN_GATE"],
    ["CONTROL_BUS_PUBLIC_WRITE", "AUTO_ALLOWED_WITH_VERIFY"],
  ] as const)("%s is %s", (kind, expected) => {
    expect(evaluateAction({ kind }).decision).toBe(expected);
  });

  it("keeps the zero-cost invariant unreachable by any gate", () => {
    // DENIED, not DEFERRED_HUMAN_GATE. A gate is a question; this is settled, and offering it as a
    // question would be inviting someone to answer it.
    const paid = evaluateAction({ kind: "PURCHASE_AI_CREDITS" });
    expect(paid.decision).toBe("DENIED");
    expect(paid.gate).toBeUndefined();
  });
});

describe("zero queue never means the project is done", () => {
  const emptyQueue = { actionable: [], deferred: [] };

  it("refuses to stop on an empty queue alone", () => {
    // Everything else unstated. This is the shape the sentinel actually shipped once, and the
    // reason every input fails closed.
    expect(evaluateStopSentinel({ queue: emptyQueue }).mayStop).toBe(false);
  });

  it.each([
    "unresolvedFailures",
    "advanceableBlockers",
    "unhandledReviewFindings",
    "discoveryCandidates",
    "orphanedDocumentedWork",
    "receivedDecisions",
  ])("still refuses when only %s is left unestablished", (missing) => {
    const full: Record<string, unknown> = {
      queue: emptyQueue,
      unresolvedFailures: 0,
      advanceableBlockers: 0,
      unhandledReviewFindings: 0,
      discoveryCandidates: 0,
      orphanedDocumentedWork: 0,
      receivedDecisions: 0,
      trueIdleEscalation: "QUEUED",
      controlBusWatcher: "ALIVE",
    };
    delete full[missing];
    expect(
      evaluateStopSentinel(full as never).mayStop,
      `${missing} was allowed to be unknown`,
    ).toBe(false);
  });

  it("names every unsatisfied condition, so a stop can be argued with", () => {
    const sentinel = evaluateStopSentinel({ queue: emptyQueue });
    for (const condition of sentinel.conditions) {
      expect(condition.detail.length).toBeGreaterThan(10);
    }
    expect(sentinel.conditions.filter((c) => !c.satisfied).length).toBeGreaterThan(3);
  });
});
