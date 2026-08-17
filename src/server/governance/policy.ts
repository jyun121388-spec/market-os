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
  | "EDIT_GOVERNING_DOCUMENT"
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
  | "CREDENTIAL_CHANGE"
  | "BULK_MESSAGING"
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
    /** Whether the call is provably within the provider's documented rate limit. */
    withinDocumentedRateLimit?: boolean;
    /** Whether a usable GitHub credential exists on this machine. */
    credentialsAvailable?: boolean;
  };
}

export interface GateRequirement {
  id: string;
  question: string;
  recommendedDefault: string;
}

export type ExecutionStatus = "READY" | "BLOCKED_MISSING_CREDENTIAL";

export interface PolicyEvaluation {
  action: ActionDescriptor;
  decision: PolicyDecision;
  /**
   * Whether the action can actually be carried out right now, which is a SEPARATE question from
   * whether policy permits it.
   *
   * "Policy permits it but the credential is absent" is not "policy denies it". Collapsing the
   * two would record a standing environmental limitation as a governance refusal, and a later
   * reader would conclude the rule forbids something it allows.
   */
  execution: ExecutionStatus;
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
    rationale: "Ordinary documentation is reversible and affects no runtime behaviour.",
  },
  EDIT_GOVERNING_DOCUMENT: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["docs/LEGAL_GUARDRAILS.md", "CLAUDE.md — absolute rules"],
    rationale:
      "Editing a document that DEFINES the rules is not a documentation change. " +
      "'Docs affect no runtime behaviour' is false for LEGAL_GUARDRAILS.md, CLAUDE.md and the " +
      "policy sources — weakening a prohibition there weakens every decision derived from it, " +
      "which an agent must not be able to do to itself (independent review, `gpt-5.6-terra`).",
    gate: {
      id: "HG-GOVERNING-DOC",
      question: "Change a rule in a governing document?",
      recommendedDefault: "No. Record the proposed change and leave the rule in force.",
    },
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
    // A missing credential does NOT change the policy decision. Pushing is permitted; the branch
    // simply cannot be pushed right now. An earlier version returned DEFERRED_HUMAN_GATE here,
    // which dressed an environmental blocker up as a policy question — the mirror image of the
    // mistake it was fixing, and it would have taught a reader that policy forbids something it
    // permits. The distinction is carried in `execution` instead.
    refine: (action, base) =>
      action.context?.credentialsAvailable === false
        ? { ...base, execution: "BLOCKED_MISSING_CREDENTIAL" }
        : base,
  },
  GIT_HISTORY_REWRITE: {
    // Corrected after independent review. CLAUDE.md forbids this "without explicit human
    // approval", which makes it a gate rather than settled policy; the earlier DENIED cited a
    // document that does not say that. The recommended default is still an unambiguous no, and
    // unattended behaviour is unchanged.
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["CLAUDE.md — 'without explicit human approval'"],
    rationale:
      "Force push and history rewriting destroy work that cannot be recovered from this machine.",
    gate: {
      id: "HG-HISTORY-REWRITE",
      question: "Authorise a force push or history rewrite?",
      recommendedDefault:
        "No. There are 69 local-only commits; a rewrite risks the entire hardening history.",
    },
  },
  CREDENTIAL_CHANGE: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["CLAUDE.md — real credentials are a HUMAN GATE"],
    rationale:
      "Obtaining or installing a credential is a user action. The agent may state what is needed " +
      "and where it goes, and must never invent, guess or substitute one.",
    gate: {
      id: "HG-CREDENTIAL",
      question: "Provide or install the credential?",
      recommendedDefault: "Place it in `.env` from the provider's own free registration flow.",
    },
  },
  BULK_MESSAGING: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["CLAUDE.md — Human Gate list"],
    rationale: "Outward-facing and not retractable once sent.",
    gate: {
      id: "HG-BULK-MESSAGING",
      question: "Send bulk email or SMS?",
      recommendedDefault: "No. Nothing in the current milestone requires it.",
    },
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
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["docs/DATA_POLICY.md"],
    rationale:
      "Free to call, but the policy authorises it only WITHIN the provider's documented rate " +
      "limit — so an unproven rate limit is a precondition, not a detail.",
    requiredVerification: ["call is within the provider's documented rate limit"],
    refine: (action, base) =>
      action.context?.withinDocumentedRateLimit === true
        ? { ...base, decision: "AUTO_ALLOWED", requiredVerification: [] }
        : base,
  },
  CALL_PAID_PROVIDER: {
    // Corrected after independent review (`gpt-5.6-terra`). This was DENIED, which was stricter
    // than its own citation: CLAUDE.md says paid external services need "explicit human
    // approval — treat as HUMAN GATE". A gate is a question a human can answer; a denial claims
    // it is already settled. Encoding a gate as a denial is not the safe error it looks like, it
    // silently removes a decision the user is entitled to make. Behaviour while unattended is
    // identical — do not act, record it, continue — so nothing is loosened by being accurate.
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["CLAUDE.md — absolute rules (HUMAN GATE)", "docs/DATA_POLICY.md"],
    rationale: "Paid external services require explicit human approval.",
    gate: {
      id: "HG-PAID-SERVICE",
      question: "Approve spending on a paid external service?",
      recommendedDefault: "No. Use a free source or defer the capability.",
    },
  },
  PURCHASE_AI_CREDITS: {
    decision: "DEFERRED_HUMAN_GATE",
    citations: ["docs/AI_RESOURCE_POLICY.md", "CLAUDE.md — absolute rules (HUMAN GATE)"],
    rationale:
      "An exhausted quota is a routing event, not a purchasing event — route to another included " +
      "model or to deterministic verification. Purchasing remains the user's decision to make, " +
      "not the agent's to foreclose.",
    gate: {
      id: "HG-AI-CREDITS",
      question: "Purchase additional AI usage?",
      recommendedDefault: "No. Route to an included model or to deterministic verification.",
    },
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
    execution: "READY",
    citations: rule.citations,
    requiredVerification: rule.requiredVerification ?? [],
    gate: rule.gate,
    rationale: rule.rationale,
  };

  const refined = rule.refine ? rule.refine(action, base) : base;

  // A verify-gated action whose verification is known to be red is not allowed yet. Silence about
  // verification stays AUTO_ALLOWED_WITH_VERIFY — the caller is being told what to run, not
  // promised it already passed.
  // DENIED, not a gate. `AUTO_ALLOWED_WITH_VERIFY` means the verification MUST pass first, so a
  // red suite is a failed precondition rather than a question a human gets to wave through. The
  // earlier version asked "proceed while verification is failing?", which turned a settled
  // requirement into a request for permission — the opposite of the DENIED/DEFERRED distinction
  // this engine is supposed to keep straight (independent review, `gpt-5.6-terra`).
  if (
    refined.decision === "AUTO_ALLOWED_WITH_VERIFY" &&
    action.context?.verificationGreen === false
  ) {
    return {
      ...refined,
      decision: "DENIED",
      gate: undefined,
      rationale:
        `${refined.rationale} Verification is currently failing, so the precondition this ` +
        "decision depends on is not met. Repair it; the action becomes available again on its own.",
    };
  }

  return refined;
}

/** Every action kind the table covers, so a caller can prove the table is exhaustive. */
export const GOVERNED_ACTIONS = Object.keys(RULES) as ActionKind[];
