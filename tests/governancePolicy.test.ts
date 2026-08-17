import { describe, expect, it } from "vitest";
import {
  evaluateAction,
  GOVERNED_ACTIONS,
  type ActionKind,
  type PolicyDecision,
} from "@/server/governance/policy";

/**
 * Governance OS — shadow-mode policy engine (docs/GOVERNANCE_OS.md).
 *
 * The engine logs what it WOULD decide and enforces nothing. Whether it could ever be promoted
 * depends on one thing: does it agree with the decisions a human already made?
 *
 * `docs/HUMAN_GATE_QUEUE.md` records eight of those with known outcomes, which makes a genuine
 * back-test possible rather than a self-consistency check. Those are the first block below.
 *
 * The second block is the one that decides whether this is useful at all. A policy engine that
 * defers everything is safe and worthless — it would stop exactly the routine engineering it
 * exists to unblock. So the AUTO_ALLOWED cases are asserted as forcefully as the DENIED ones.
 */

describe("Governance — replay of decisions a human actually made", () => {
  // Each row is a real entry in docs/HUMAN_GATE_QUEUE.md, with the outcome that was recorded.
  const recorded: { gate: string; kind: ActionKind; expected: PolicyDecision }[] = [
    { gate: "HG-001 GitHub push", kind: "GIT_PUSH", expected: "AUTO_ALLOWED_WITH_VERIFY" },
    {
      gate: "HG-007 production deployment",
      kind: "DEPLOY_PRODUCTION",
      expected: "DEFERRED_HUMAN_GATE",
    },
    {
      gate: "HG-008 payment activation",
      kind: "ACTIVATE_PAYMENTS",
      expected: "DEFERRED_HUMAN_GATE",
    },
    { gate: "zero-cost rule — paid provider", kind: "CALL_PAID_PROVIDER", expected: "DENIED" },
    { gate: "zero-cost rule — buy credits", kind: "PURCHASE_AI_CREDITS", expected: "DENIED" },
    { gate: "git safety — force push", kind: "GIT_HISTORY_REWRITE", expected: "DENIED" },
    { gate: "legal guardrail", kind: "PERSONALIZED_ADVICE_OUTPUT", expected: "DENIED" },
    { gate: "local AI calibration", kind: "LOCAL_MODEL_AS_VERIFIER", expected: "DENIED" },
  ];

  it.each(recorded)("$gate → $expected", ({ kind, expected }) => {
    expect(evaluateAction({ kind }).decision).toBe(expected);
  });

  it("cites a document for every decision it makes", () => {
    // A decision that cannot name the rule behind it is an opinion, and the whole point of this
    // layer is to replace scattered judgement calls with something auditable.
    for (const kind of GOVERNED_ACTIONS) {
      const evaluation = evaluateAction({ kind });
      expect(evaluation.citations.length, `${kind} cited nothing`).toBeGreaterThan(0);
      expect(evaluation.rationale.trim().length, `${kind} had no rationale`).toBeGreaterThan(0);
    }
  });
});

describe("Governance — must not defer ordinary engineering", () => {
  // The failure mode that would make this layer worse than useless. Autonomy is the goal;
  // safety is the constraint, not the objective.
  it.each<ActionKind>([
    "ADD_TEST",
    "EDIT_DOCS",
    "GIT_COMMIT",
    "CALL_FREE_PROVIDER",
    "LOCAL_MODEL_HYPOTHESIS",
  ])("%s is allowed outright", (kind) => {
    expect(evaluateAction({ kind }).decision).toBe("AUTO_ALLOWED");
  });

  it.each<ActionKind>(["FIX_REPRODUCED_DEFECT", "REFACTOR", "ADDITIVE_SCHEMA_MIGRATION"])(
    "%s is allowed subject to verification, not deferred",
    (kind) => {
      const evaluation = evaluateAction({ kind });
      expect(evaluation.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
      expect(evaluation.requiredVerification.length).toBeGreaterThan(0);
    },
  );

  it("requires a populated-database check for a migration, not just a fresh one", () => {
    // The H1 discipline. A migration that only ever ran against an empty database has not been
    // tested against the case that matters.
    const evaluation = evaluateAction({ kind: "ADDITIVE_SCHEMA_MIGRATION" });
    expect(evaluation.requiredVerification.join(" ")).toMatch(/populated/i);
  });
});

describe("Governance — DENIED and DEFERRED are different things", () => {
  it("does not treat settled policy as a pending question", () => {
    // A gate is a question awaiting an answer. A denial is already answered. Conflating them is
    // how a standing rule quietly degrades into "ask again later".
    for (const kind of [
      "PURCHASE_AI_CREDITS",
      "GIT_HISTORY_REWRITE",
      "COMMIT_CREDENTIAL",
    ] as ActionKind[]) {
      const evaluation = evaluateAction({ kind });
      expect(evaluation.decision).toBe("DENIED");
      expect(evaluation.gate, `${kind} offered a gate for settled policy`).toBeUndefined();
    }
  });

  it("gives every deferred action a question and a recommended default", () => {
    // An unattended agent must be able to record the gate and move on. A gate with no
    // recommendation forces the next reader to re-derive the whole decision.
    for (const kind of GOVERNED_ACTIONS) {
      const evaluation = evaluateAction({ kind });
      if (evaluation.decision !== "DEFERRED_HUMAN_GATE") continue;
      expect(evaluation.gate, `${kind} deferred with no gate`).toBeDefined();
      expect(evaluation.gate!.question.length).toBeGreaterThan(0);
      expect(evaluation.gate!.recommendedDefault.length).toBeGreaterThan(0);
    }
  });
});

describe("Governance — context tightens, never loosens", () => {
  it("denies destructive tests when no disposable database is configured", () => {
    expect(
      evaluateAction({
        kind: "RUN_DESTRUCTIVE_TESTS",
        context: { disposableTestDbConfigured: false },
      }).decision,
    ).toBe("DENIED");
  });

  it("allows destructive tests once a disposable database is validated", () => {
    expect(
      evaluateAction({
        kind: "RUN_DESTRUCTIVE_TESTS",
        context: { disposableTestDbConfigured: true },
      }).decision,
    ).toBe("AUTO_ALLOWED_WITH_VERIFY");
  });

  it("treats an unstated disposable database as not configured", () => {
    // Absent context resolves toward the safer answer. Failing open here is the exact condition
    // under which real ingested data was destroyed three times.
    expect(evaluateAction({ kind: "RUN_DESTRUCTIVE_TESTS" }).decision).toBe("DENIED");
  });

  it("denies a release-readiness claim while external gates are open", () => {
    expect(
      evaluateAction({
        kind: "DECLARE_RELEASE_CANDIDATE_READY",
        context: { releaseGatesClosed: false },
      }).decision,
    ).toBe("DENIED");
  });

  it("holds a verify-gated action when verification is known to be failing", () => {
    const evaluation = evaluateAction({
      kind: "GIT_PUSH",
      context: { verificationGreen: false },
    });
    expect(evaluation.decision).toBe("DEFERRED_HUMAN_GATE");
    expect(evaluation.gate?.id).toBe("HG-VERIFY-RED");
  });

  it("does not claim verification passed merely because nobody said it failed", () => {
    // Silence must leave the action gated on verification, not promote it to allowed.
    expect(evaluateAction({ kind: "GIT_PUSH" }).decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
  });
});
