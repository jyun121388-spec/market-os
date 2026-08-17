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
    // HG-001 is recorded as blocked on the USER authenticating this machine, so a faithful
    // replay must supply that context. Asserting a bare auto-allow and calling it "HG-001" was
    // not a replay of the recorded decision at all (independent review, `gpt-5.6-terra`).
    { gate: "git push, policy only", kind: "GIT_PUSH", expected: "AUTO_ALLOWED_WITH_VERIFY" },
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
    { gate: "HG-006 paid provider", kind: "CALL_PAID_PROVIDER", expected: "DEFERRED_HUMAN_GATE" },
    { gate: "buy AI credits", kind: "PURCHASE_AI_CREDITS", expected: "DEFERRED_HUMAN_GATE" },
    {
      gate: "git safety — force push",
      kind: "GIT_HISTORY_REWRITE",
      expected: "DEFERRED_HUMAN_GATE",
    },
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
  it.each<ActionKind>(["ADD_TEST", "EDIT_DOCS", "GIT_COMMIT", "LOCAL_MODEL_HYPOTHESIS"])(
    "%s is allowed outright",
    (kind) => {
      expect(evaluateAction({ kind }).decision).toBe("AUTO_ALLOWED");
    },
  );

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
    // Only rules that NO human approval could open. Paid services, credits and history rewrite
    // were wrongly listed here: each is a decision the user is entitled to make, and encoding a
    // gate as a denial quietly removes it from them.
    for (const kind of [
      "COMMIT_CREDENTIAL",
      "PERSONALIZED_ADVICE_OUTPUT",
      "UNSOURCED_FACT_OUTPUT",
      "LOCAL_MODEL_AS_VERIFIER",
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

  it("refuses a verify-gated action when verification is known to be failing", () => {
    // Superseded assertion: this used to expect DEFERRED_HUMAN_GATE, which framed a red suite as
    // something a human could authorise past. It is a failed precondition — see the correction
    // block at the end of this file.
    expect(
      evaluateAction({ kind: "GIT_PUSH", context: { verificationGreen: false } }).decision,
    ).toBe("DENIED");
  });

  it("does not claim verification passed merely because nobody said it failed", () => {
    // Silence must leave the action gated on verification, not promote it to allowed.
    expect(evaluateAction({ kind: "GIT_PUSH" }).decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
  });
});

/**
 * Findings from independent review (`gpt-5.6-terra`), 2026-08-18. Several were fidelity errors -
 * rules that cited a document saying something different, always in the stricter direction.
 * Being stricter than the source is not automatically safe: encoding a Human Gate as a denial
 * removes a decision the user is entitled to make, while looking responsible.
 */
describe("Governance — corrections from independent review", () => {
  it("does not let an agent weaken a governing document on its own authority", () => {
    // "Docs affect no runtime behaviour" is false for the documents that DEFINE the rules.
    const evaluation = evaluateAction({
      kind: "EDIT_GOVERNING_DOCUMENT",
      detail: "remove the personalized-advice prohibition from LEGAL_GUARDRAILS.md",
    });
    expect(evaluation.decision).toBe("DEFERRED_HUMAN_GATE");
  });

  it("still allows ordinary documentation edits", () => {
    // The negative control. If every doc edit needed approval, the layer would block the most
    // routine work there is.
    expect(evaluateAction({ kind: "EDIT_DOCS" }).decision).toBe("AUTO_ALLOWED");
  });

  it("does not assume a free provider call is within its rate limit", () => {
    // The policy authorises this only WITHIN the documented limit, and missing context must not
    // produce the more permissive answer.
    expect(evaluateAction({ kind: "CALL_FREE_PROVIDER" }).decision).toBe(
      "AUTO_ALLOWED_WITH_VERIFY",
    );
    expect(
      evaluateAction({
        kind: "CALL_FREE_PROVIDER",
        context: { withinDocumentedRateLimit: true },
      }).decision,
    ).toBe("AUTO_ALLOWED");
  });

  it("defers the push when no credential exists, without calling the action itself forbidden", () => {
    const evaluation = evaluateAction({
      kind: "GIT_PUSH",
      context: { credentialsAvailable: false },
    });
    expect(evaluation.decision).toBe("DEFERRED_HUMAN_GATE");
    expect(evaluation.gate?.id).toBe("HG-001");
  });

  it("denies rather than merely defers when verification is red", () => {
    // AUTO_ALLOWED_WITH_VERIFY means the verification MUST pass. A red suite is a failed
    // precondition, not something a human waves through.
    const evaluation = evaluateAction({ kind: "GIT_PUSH", context: { verificationGreen: false } });
    expect(evaluation.decision).toBe("DENIED");
    expect(evaluation.gate).toBeUndefined();
  });

  it.each<ActionKind>(["CREDENTIAL_CHANGE", "BULK_MESSAGING"])(
    "%s is representable and deferred",
    (kind) => {
      // Both appear in CLAUDE.md's Human Gate list and in the contract, and both were missing
      // from the table - so the engine could not have decided them at all.
      expect(evaluateAction({ kind }).decision).toBe("DEFERRED_HUMAN_GATE");
    },
  );
});
