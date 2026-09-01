import { describe, expect, it } from "vitest";
import {
  evaluateAction,
  observeExecution,
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
    // DENIED, not a gate. Corrected after a fidelity audit (`gpt-5.6-luna`): both cited documents
    // prohibit buying credits outright and prescribe USAGE_LIMIT_PAUSE instead, so encoding it as
    // a question a human answers in the moment was looser than the policy it claimed to encode.
    { gate: "buy AI credits", kind: "PURCHASE_AI_CREDITS", expected: "DENIED" },
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

  it("keeps a missing credential OUT of the policy decision", () => {
    // Corrected twice. It first asserted a bare auto-allow while labelling the row HG-001, which
    // was not a replay of the recorded decision. The fix then over-corrected into
    // DEFERRED_HUMAN_GATE, which dressed an environmental blocker up as a policy question - and
    // would teach a reader that policy forbids something it permits.
    //
    // Policy and executability are separate facts. Pushing is allowed; the branch just cannot be
    // pushed right now.
    const evaluation = evaluateAction({
      kind: "GIT_PUSH",
      context: { credentialsAvailable: false },
    });
    expect(evaluation.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
    expect(evaluation.execution).toBe("BLOCKED_MISSING_CREDENTIAL");
    expect(evaluation.gate).toBeUndefined();
  });

  it("reports execution READY when nothing blocks it", () => {
    expect(evaluateAction({ kind: "GIT_PUSH" }).execution).toBe("READY");
    expect(
      evaluateAction({ kind: "GIT_PUSH", context: { credentialsAvailable: true } }).execution,
    ).toBe("READY");
  });

  it("never reports an execution blocker as a reason a decision was refused", () => {
    // Across the whole table: an execution status must never coincide with DENIED, or the two
    // concepts have collapsed again.
    for (const kind of GOVERNED_ACTIONS) {
      const evaluation = evaluateAction({ kind, context: { credentialsAvailable: false } });
      if (evaluation.execution !== "READY") {
        expect(evaluation.decision, `${kind} conflated execution with policy`).not.toBe("DENIED");
      }
    }
  });

  it("denies rather than merely defers when verification is red", () => {
    // AUTO_ALLOWED_WITH_VERIFY means the verification MUST pass. A red suite is a failed
    // precondition, not something a human waves through.
    const evaluation = evaluateAction({ kind: "GIT_PUSH", context: { verificationGreen: false } });
    expect(evaluation.decision).toBe("DENIED");
    expect(evaluation.gate).toBeUndefined();
  });

  it("records a missing provider key as an execution blocker, not a policy refusal", () => {
    // FRED, ECOS and OpenDART are all free to call and all uncallable here. The policy on free
    // providers has not changed because a key is absent; only the ability to act has.
    const evaluation = evaluateAction({
      kind: "CALL_FREE_PROVIDER",
      context: { providerKeyAvailable: false, withinDocumentedRateLimit: true },
    });
    expect(evaluation.decision).toBe("AUTO_ALLOWED");
    expect(evaluation.execution).toBe("BLOCKED_PROVIDER_KEY");
    expect(evaluation.gate).toBeUndefined();
  });

  it("treats an exhausted included quota as a routing event, not a purchasing one", () => {
    const evaluation = evaluateAction({
      kind: "RUN_INDEPENDENT_AI_REVIEW",
      context: { includedModelQuotaAvailable: false },
    });
    expect(evaluation.decision).toBe("AUTO_ALLOWED");
    expect(evaluation.execution).toBe("BLOCKED_USAGE_LIMIT");
    // The distinction that matters: nothing here asks a human to authorise spending, and nothing
    // here is refused. The review is permitted; it just cannot run at this moment.
    expect(evaluation.gate).toBeUndefined();
    // Buying a way past the limit is a separate action and is DENIED outright, which is why an
    // exhausted quota must surface here as an execution blocker rather than as a decision.
    expect(evaluateAction({ kind: "PURCHASE_AI_CREDITS" }).decision).toBe("DENIED");
  });

  it("never turns an execution blocker into a question for a human", () => {
    // The generalisation of the two cases above, across the whole table. A gate raised because
    // the environment is incomplete would put a standing limitation in front of the user as
    // though it were a decision they could make.
    const blocked = {
      credentialsAvailable: false,
      providerKeyAvailable: false,
      includedModelQuotaAvailable: false,
    };
    for (const kind of GOVERNED_ACTIONS) {
      const evaluation = evaluateAction({ kind, context: blocked });
      if (evaluation.execution !== "READY") {
        expect(
          evaluation.gate,
          `${kind} raised a gate for an environmental blocker`,
        ).toBeUndefined();
      }
    }
  });

  it("refuses to call a stale reading the current state of the world", () => {
    const stale = evaluateAction({
      kind: "PUBLISH_CURRENT_STATE_CLAIM",
      context: { sourceFreshness: "STALE", verificationGreen: true },
    });
    expect(stale.decision).toBe("DENIED");
    // A DECISION, not an execution blocker: nothing in the environment is missing, and the data
    // that is present says the claim would be false.
    expect(stale.execution).toBe("READY");
    expect(stale.gate).toBeUndefined();
  });

  it("allows the same claim outright when the series is inside its own cadence", () => {
    const fresh = evaluateAction({
      kind: "PUBLISH_CURRENT_STATE_CLAIM",
      context: { sourceFreshness: "FRESH", verificationGreen: true },
    });
    expect(fresh.decision).toBe("AUTO_ALLOWED");
    expect(fresh.requiredVerification).toEqual([]);
  });

  it("treats unmeasurable freshness as a disclosure requirement, never as currency", () => {
    for (const context of [{ sourceFreshness: "UNKNOWN" as const }, {}]) {
      const evaluation = evaluateAction({
        kind: "PUBLISH_CURRENT_STATE_CLAIM",
        context: { ...context, verificationGreen: true },
      });
      expect(evaluation.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
      expect(evaluation.requiredVerification.join(" ")).toContain("disclose");
    }
  });

  it("permits an unconfirmed completeness claim only with the limitation disclosed", () => {
    // The permanent state for SEC facts: companyfacts publishes no total, so this never resolves.
    // Denying it outright would forbid the product's main output; allowing it silently is the
    // 1000-of-2240 defect.
    const unconfirmed = evaluateAction({
      kind: "PUBLISH_COMPLETENESS_CLAIM",
      context: { completenessEvidence: "UNCONFIRMED", verificationGreen: true },
    });
    expect(unconfirmed.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
    expect(unconfirmed.requiredVerification.join(" ")).toContain("unconfirmed");

    const short = evaluateAction({
      kind: "PUBLISH_COMPLETENESS_CLAIM",
      context: { completenessEvidence: "KNOWN_INCOMPLETE", verificationGreen: true },
    });
    expect(short.decision).toBe("DENIED");
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

describe("recording what became of an action", () => {
  it("keeps readiness and outcome as separate questions", () => {
    const push = evaluateAction({
      kind: "GIT_PUSH",
      context: { credentialsAvailable: false, verificationGreen: true },
    });
    expect(push.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
    expect(push.execution).toBe("BLOCKED_MISSING_CREDENTIAL");

    const observed = observeExecution(
      push,
      "BLOCKED_MISSING_CREDENTIAL",
      "git push hung on a credential prompt that cannot be shown in this environment.",
    );
    expect(observed.outcome).toBe("BLOCKED_MISSING_CREDENTIAL");
    expect(observed.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
  });

  /**
   * The one thing an audit record must be unable to express.
   *
   * If a denied action can be recorded as having simply executed, the governance log becomes the
   * last place a violation is visible rather than the first.
   */
  it("cannot record a denied action as having executed", () => {
    const denied = evaluateAction({ kind: "PERSONALIZED_ADVICE_OUTPUT" });
    expect(denied.decision).toBe("DENIED");
    expect(() => observeExecution(denied, "EXECUTED", "shipped anyway")).toThrow(/EXECUTED/);
  });

  it("cannot record a human-gated action as having executed", () => {
    const gated = evaluateAction({ kind: "CALL_PAID_PROVIDER" });
    expect(gated.decision).toBe("DEFERRED_HUMAN_GATE");
    expect(() => observeExecution(gated, "EXECUTED", "called it")).toThrow();
    // Recording that it was NOT done is exactly what the gate expects.
    expect(observeExecution(gated, "DEFERRED", "awaiting approval").outcome).toBe("DEFERRED");
  });
});

/**
 * Every gate on record, replayed by name — including the ones the engine answers with an
 * EXECUTION status rather than a decision, and the one it deliberately cannot answer at all.
 *
 * The table above replays four of the nine gates in `docs/HUMAN_GATE_QUEUE.md`. The five it omits
 * are the interesting ones, because each is a case where "what does the engine say about HG-00N?"
 * has an answer that is not a `PolicyDecision`. Leaving them out made the replay look complete
 * while covering the easy half.
 */
describe("Governance — the whole Human Gate queue, replayed by gate id", () => {
  /**
   * HG-002, HG-003 and HG-004 are the §12 distinction in its original form. All three providers
   * are FREE to call. What is missing is a key, which is an environmental fact — so policy must
   * keep permitting the call and the engine must report the blocker separately. Recording any of
   * these as DEFERRED_HUMAN_GATE would say the policy forbids calling a free provider, which it
   * does not.
   */
  it.each([
    ["HG-002 FRED API key", "FRED"],
    ["HG-003 ECOS API key", "ECOS"],
    ["HG-004 OpenDART API key", "OPENDART"],
  ])("%s — permitted by policy, blocked by environment", (_gate, provider) => {
    const evaluation = evaluateAction({
      kind: "CALL_FREE_PROVIDER",
      detail: provider,
      context: { providerKeyAvailable: false, withinDocumentedRateLimit: true },
    });
    expect(evaluation.decision).toBe("AUTO_ALLOWED");
    expect(evaluation.execution).toBe("BLOCKED_PROVIDER_KEY");
    expect(evaluation.gate).toBeUndefined();
  });

  /**
   * HG-005 changed twice. It was a login problem, then an included-usage exhaustion, and as of
   * 2026-08-18 Codex is available again and two reviews have run. In every one of those states the
   * POLICY was the same — review by an included model is required by the development loop and
   * costs nothing extra — and only the execution status moved.
   */
  it("HG-005 independent review — policy constant, execution follows the quota", () => {
    const exhausted = evaluateAction({
      kind: "RUN_INDEPENDENT_AI_REVIEW",
      context: { includedModelQuotaAvailable: false },
    });
    expect(exhausted.decision).toBe("AUTO_ALLOWED");
    expect(exhausted.execution).toBe("BLOCKED_USAGE_LIMIT");

    const available = evaluateAction({
      kind: "RUN_INDEPENDENT_AI_REVIEW",
      context: { includedModelQuotaAvailable: true },
    });
    expect(available.decision).toBe("AUTO_ALLOWED");
    expect(available.execution).toBe("READY");
  });

  /**
   * HG-009 is the honest gap, and stating it is the point.
   *
   * It asks a human to choose between a targeted lockout DoS and unlimited password guessing.
   * Every option trades one weakness for another, so there is no rule to encode — and inventing an
   * action kind for it would produce a decision the engine has no basis to make, dressed in the
   * same shape as the decisions it does. A governance engine that answers questions it cannot
   * answer is worse than one with a visible boundary.
   */
  it("HG-009 login lockout — deliberately outside what the engine models", () => {
    const security = GOVERNED_ACTIONS.filter((kind) => /LOCKOUT|THREAT|AUTH_POLICY/.test(kind));
    expect(security).toEqual([]);
    // The nearest representable action is a credential/security change, which is correctly a gate
    // — but it is a gate about MAKING the change, not about which tradeoff to accept.
    expect(evaluateAction({ kind: "CREDENTIAL_CHANGE" }).decision).toBe("DEFERRED_HUMAN_GATE");
  });

  /**
   * HG-010 is outside the engine for a different reason than HG-009, and the difference matters.
   *
   * HG-009 asks a human to pick between two security tradeoffs — there is no rule to encode.
   * HG-010 asks two questions the engine has no standing to answer at all: whether a reproduced
   * misclassification counts as P1 under the V1 freeze, and whether deleting four legitimate
   * Korean definition requests is an acceptable price for removing one wrong operation.
   *
   * The first is a SEVERITY GRADE, and severity is what decides whether the freeze admits a
   * change. An engine that graded its own findings would be choosing its own permissions. The
   * second is a product judgement about recall. Neither is a governed action kind, and inventing
   * one would produce an answer with nothing behind it.
   */
  it("HG-010 IR-110 severity and recall tradeoff — outside what the engine may decide", () => {
    // Nothing in the governed vocabulary grades a finding or trades recall.
    const grading = GOVERNED_ACTIONS.filter((kind) => /SEVERITY|GRADE|RECALL|TRADEOFF/.test(kind));
    expect(grading).toEqual([]);
    // The nearest representable action is changing frozen V1 product code, which is correctly a
    // gate — but it gates MAKING the change, not deciding whether the freeze admits it.
    expect(evaluateAction({ kind: "CREDENTIAL_CHANGE" }).decision).toBe("DEFERRED_HUMAN_GATE");
  });

  /**
   * The coverage check that keeps this honest. Every gate id in the queue document must appear in
   * this file, so a gate added later cannot sit unreplayed while the suite reports green.
   */
  it("replays every gate recorded in docs/HUMAN_GATE_QUEUE.md", async () => {
    const { readFileSync } = await import("node:fs");
    const queue = readFileSync("docs/HUMAN_GATE_QUEUE.md", "utf8");
    const recordedGates = [...queue.matchAll(/^## (HG-\d+)/gm)].map((m) => m[1]);
    expect(recordedGates.length).toBeGreaterThanOrEqual(9);

    const thisFile = readFileSync("tests/governancePolicy.test.ts", "utf8");
    for (const gate of recordedGates) {
      expect(thisFile, `${gate} is recorded but never replayed`).toContain(gate);
    }
  });
});
