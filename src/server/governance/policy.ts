/**
 * Governance OS — SHADOW MODE policy engine (docs/GOVERNANCE_OS.md).
 *
 * Turns rules that currently live in prose across six markdown files into decisions a machine can
 * make and a human can audit. Nothing in Market OS imports this and it enforces nothing; it logs
 * what it WOULD decide, and is calibrated by replaying the Human Gate decisions already on record.
 *
 * The point is MORE autonomy, not less. An agent that can prove an action is `AUTO_ALLOWED` should
 * not stop to ask about it, and today every application of these rules is a judgement call by
 * whoever is reading at the time, with no record of which rule produced it.
 *
 * Table-driven on purpose: the policy is reviewable as data rather than buried in branches, and
 * every decision cites the document it came from. A decision with no citation is an opinion.
 */

export type PolicyDecision =
  | "AUTO_ALLOWED" // proceed; reversible and within policy
  | "AUTO_ALLOWED_WITH_VERIFY" // proceed, but the stated verification must pass before commit
  | "DEFERRED_HUMAN_GATE" // do not act; record what is needed and continue other work
  | "DENIED"; // settled policy forbids this; no gate will open it as things stand

export type ActionKind =
  | "ADD_TEST"
  | "FIX_REPRODUCED_DEFECT"
  | "FIX_SUSPECTED_DEFECT"
  | "REFACTOR"
  | "EDIT_DOCS"
  | "ADDITIVE_SCHEMA_MIGRATION"
  | "DESTRUCTIVE_DB_OP"
  | "RUN_DESTRUCTIVE_TESTS"
  | "GIT_COMMIT"
  | "GIT_PUSH"
  | "GIT_HISTORY_REWRITE"
  | "MERGE_MAIN"
  | "CALL_FREE_PROVIDER"
  | "CALL_PAID_PROVIDER"
  | "PURCHASE_AI_CREDITS"
  | "LOCAL_MODEL_HYPOTHESIS"
  | "LOCAL_MODEL_AS_VERIFIER"
  | "DEPLOY_PRODUCTION"
  | "ACTIVATE_PAYMENTS"
  | "PUBLISH_REPO"
  | "COMMIT_CREDENTIAL"
  | "PERSONALIZED_ADVICE_OUTPUT"
  | "UNSOURCED_FACT_OUTPUT"
  | "DECLARE_RELEASE_CANDIDATE_READY";

export interface ActionDescriptor {
  kind: ActionKind;
  detail?: string;
  /**
   * Context the engine cannot infer. Absent fields are treated as UNKNOWN and, where a rule
   * depends on one, resolve toward the safer decision rather than the convenient one.
   */
  context?: {
    /** Whether the required verification (suite, lint, typecheck, build) is currently green. */
    verificationGreen?: boolean;
    /** Whether every external release gate is genuinely closed. */
    releaseGatesClosed?: boolean;
    /** Whether a validated disposable TEST_DATABASE_URL is set. */
    disposableTestDbConfigured?: boolean;
  };
}

export interface GateRequirement {
  id: string;
  question: string;
  recommendedDefault: string;
}

export interface PolicyEvaluation {
  action: ActionDescriptor;
  decision: PolicyDecision;
  /** The rule that decided it, by document. A decision that cannot cite one is not a policy. */
  citations: string[];
  /** For AUTO_ALLOWED_WITH_VERIFY: exactly what must pass first. */
  requiredVerification: string[];
  gate?: GateRequirement;
  rationale: string;
}

interface Rule {
  decision: PolicyDecision;
  citations: string[];
  rationale: string;
  requiredVerification?: string[];
  gate?: GateRequirement;
  /** Lets a rule tighten when context says the precondition is not met. */
  refine?: (action: ActionDescriptor, base: PolicyEvaluation) => PolicyEvaluation;
}

const DONE = ["format", "lint", "typecheck", "unit tests", "relevant integration/E2E", "build"];

const RULES: Record<ActionKind, Rule> = {
  ADD_TEST: {
    decision: "AUTO_ALLOWED",
    citations: ["CLAUDE.md — development loop"],
    rationale: "Adding coverage is reversible and cannot change product behaviour.",
  },
  EDIT_DOCS: {
    decision: "AUTO_ALLOWED",
    citations: ["CLAUDE.md — development loop"],
    rationale: "Documentation changes are reversible and affect no runtime behaviour.",
  },
  FIX_REPRODUCED_DEFECT: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["CLAUDE.md — Definition of Done"],
    rationale: "A reproduced defect is in scope even during a release freeze.",
    requiredVerification: DONE,
  },
  FIX_SUSPECTED_DEFECT: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["docs/INTERIM_REVIEW_FINDINGS.md — reproduce before modifying"],
    rationale:
      "Changing correct code to satisfy an unreproduced hypothesis is how a review finding " +
      "becomes a regression. Reproduce it first; then it is a different action.",
    gate: {
      id: "HG-REPRO",
      question: "Reproduce the hypothesis, or accept the change without a reproduction?",
      recommendedDefault:
        "Reproduce first. Do not modify code that has not been shown to be wrong.",
    },
  },
  REFACTOR: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["docs/RELEASE_CHECKLIST.md"],
    rationale: "Reversible and behaviour-preserving, provided the full suite still passes.",
    requiredVerification: DONE,
  },
  ADDITIVE_SCHEMA_MIGRATION: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["docs/DECISIONS.md — H1 migration discipline"],
    rationale: "Additive and reversible, but only once proven against a POPULATED database.",
    requiredVerification: [...DONE, "migration applied to a fresh AND a populated database"],
  },
  DESTRUCTIVE_DB_OP: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["CLAUDE.md — Human Gate list"],
    rationale: "Irreversible against real data.",
    gate: {
      id: "HG-DESTRUCTIVE-DB",
      question: "Authorise a destructive database operation?",
      recommendedDefault: "Do not run it. Prefer an additive migration.",
    },
  },
  RUN_DESTRUCTIVE_TESTS: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["tests/support/testDatabaseGuard.mts — fail-closed guard"],
    rationale: "Permitted only against a validated disposable database.",
    requiredVerification: ["TEST_DATABASE_URL resolves to a disposable database"],
    refine: (action, base) =>
      action.context?.disposableTestDbConfigured === true
        ? base
        : {
            ...base,
            decision: "DENIED",
            rationale:
              "No validated disposable TEST_DATABASE_URL. The guard fails closed, and an " +
              "unconfigured guard is the condition under which real data was destroyed three times.",
          },
  },
  GIT_COMMIT: {
    decision: "AUTO_ALLOWED",
    citations: ["CLAUDE.md — git policy"],
    rationale: "A commit on the working branch is local and recoverable.",
  },
  GIT_PUSH: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["CLAUDE.md — git policy", "docs/HUMAN_GATE_QUEUE.md HG-001"],
    rationale: "Publishing the branch is safe with a clean tree and a green suite.",
    requiredVerification: ["clean working tree", ...DONE],
  },
  GIT_HISTORY_REWRITE: {
    decision: "DENIED",
    citations: ["CLAUDE.md — absolute rules"],
    rationale:
      "Force push, reset across hardening history, and history rewriting are forbidden outright. " +
      "This is not a gate awaiting an answer; the answer is recorded.",
  },
  MERGE_MAIN: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["CLAUDE.md — git policy"],
    rationale: "Merging changes the shared branch and is not reversible without coordination.",
    gate: {
      id: "HG-MERGE",
      question: "Merge this branch to main?",
      recommendedDefault: "Wait until the independent review and external gates are closed.",
    },
  },
  CALL_FREE_PROVIDER: {
    decision: "AUTO_ALLOWED",
    citations: ["docs/DATA_POLICY.md"],
    rationale: "Reading a free provider within its documented rate limit costs nothing.",
  },
  CALL_PAID_PROVIDER: {
    decision: "DENIED",
    citations: ["CLAUDE.md — zero additional cost", "docs/AI_RESOURCE_POLICY.md"],
    rationale: "Spending is settled policy, not a pending question.",
  },
  PURCHASE_AI_CREDITS: {
    decision: "DENIED",
    citations: ["docs/AI_RESOURCE_POLICY.md"],
    rationale:
      "An exhausted quota is a routing event, not a purchasing event. Route to another included " +
      "model or to deterministic verification.",
  },
  LOCAL_MODEL_HYPOTHESIS: {
    decision: "AUTO_ALLOWED",
    citations: ["docs/LOCAL_AI_CALIBRATION.md"],
    rationale:
      "A local model may propose hypotheses and adversarial inputs, because a deterministic " +
      "oracle grades the result and the model never decides anything.",
  },
  LOCAL_MODEL_AS_VERIFIER: {
    decision: "DENIED",
    citations: ["docs/LOCAL_AI_CALIBRATION.md"],
    rationale:
      "Both installed local models failed their negative controls — they reported defects in " +
      "correct code on every blind sample and never once cleared a clean control.",
  },
  DEPLOY_PRODUCTION: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["docs/HUMAN_GATE_QUEUE.md HG-007"],
    rationale: "Outward-facing and not reversible on the user's behalf.",
    gate: {
      id: "HG-007",
      question: "Deploy to production?",
      recommendedDefault: "Not until the release gates are closed.",
    },
  },
  ACTIVATE_PAYMENTS: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["docs/HUMAN_GATE_QUEUE.md HG-008"],
    rationale: "Financial and legal consequences outside the repository.",
    gate: {
      id: "HG-008",
      question: "Activate payment processing?",
      recommendedDefault: "Defer until after launch readiness is agreed.",
    },
  },
  PUBLISH_REPO: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["CLAUDE.md — Human Gate list"],
    rationale: "Making a repository public cannot be undone once it is indexed.",
    gate: {
      id: "HG-PUBLISH",
      question: "Make the repository public?",
      recommendedDefault: "No. Review history for sensitive content first.",
    },
  },
  COMMIT_CREDENTIAL: {
    decision: "DENIED",
    citations: ["CLAUDE.md — absolute rules"],
    rationale: "A committed secret is compromised even after removal, because history persists.",
  },
  PERSONALIZED_ADVICE_OUTPUT: {
    decision: "DENIED",
    citations: ["docs/LEGAL_GUARDRAILS.md"],
    rationale: "Market OS is an intelligence product, not an advice product.",
  },
  UNSOURCED_FACT_OUTPUT: {
    decision: "DENIED",
    citations: ["docs/DATA_POLICY.md", "CLAUDE.md — no hallucinated financial facts"],
    rationale: "Every FACT shown to a user must trace to a stored source.",
  },
  DECLARE_RELEASE_CANDIDATE_READY: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["docs/RELEASE_CHECKLIST.md"],
    rationale: "Release readiness is a claim about external gates, not about the code alone.",
    gate: {
      id: "HG-RC",
      question: "Promote the release status?",
      recommendedDefault: "Only once every external gate is genuinely closed.",
    },
    refine: (action, base) =>
      action.context?.releaseGatesClosed === true
        ? base
        : {
            ...base,
            decision: "DENIED",
            rationale:
              "External gates are open. Promoting the status would be a false statement about " +
              "the project, not a decision awaiting approval.",
          },
  },
};

/**
 * Evaluates one action against the policy table.
 *
 * Pure and synchronous: a policy engine that needs I/O to decide is one that can fail open.
 */
export function evaluateAction(action: ActionDescriptor): PolicyEvaluation {
  const rule = RULES[action.kind];
  const base: PolicyEvaluation = {
    action,
    decision: rule.decision,
    citations: rule.citations,
    requiredVerification: rule.requiredVerification ?? [],
    gate: rule.gate,
    rationale: rule.rationale,
  };

  const refined = rule.refine ? rule.refine(action, base) : base;

  // A verify-gated action whose verification is known to be red is not allowed yet. Silence about
  // verification stays AUTO_ALLOWED_WITH_VERIFY — the caller is being told what to run, not
  // promised it already passed.
  if (
    refined.decision === "AUTO_ALLOWED_WITH_VERIFY" &&
    action.context?.verificationGreen === false
  ) {
    return {
      ...refined,
      decision: "DEFERRED_HUMAN_GATE",
      rationale:
        `${refined.rationale} Verification is currently failing, so the precondition this ` +
        "decision depends on is not met.",
      gate: {
        id: "HG-VERIFY-RED",
        question: "Proceed while verification is failing?",
        recommendedDefault: "No. Fix the failure first; a red suite invalidates the evidence.",
      },
    };
  }

  return refined;
}

/** Every action kind the table covers, so a caller can prove the table is exhaustive. */
export const GOVERNED_ACTIONS = Object.keys(RULES) as ActionKind[];
