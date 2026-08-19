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
  | "RUN_INDEPENDENT_AI_REVIEW"
  | "LOCAL_MODEL_HYPOTHESIS"
  | "LOCAL_MODEL_AS_VERIFIER"
  | "DEPLOY_PRODUCTION"
  | "ACTIVATE_PAYMENTS"
  | "PUBLISH_REPO"
  | "CREDENTIAL_CHANGE"
  | "BULK_MESSAGING"
  | "COMMIT_CREDENTIAL"
  | "POST_PUBLIC_ISSUE_COMMENT"
  | "PUBLISH_CURRENT_STATE_CLAIM"
  | "PUBLISH_COMPLETENESS_CLAIM"
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
    /** Whether the provider API key this call needs is present in the environment. */
    providerKeyAvailable?: boolean;
    /** Whether an INCLUDED model still has quota. Never a reason to buy more. */
    includedModelQuotaAvailable?: boolean;
    /**
     * Reality, as the Fabric reports it, for the data behind a claim.
     *
     * These are what let a policy reason about the world instead of only about the action. "May I
     * publish this?" has no answer that does not depend on whether the underlying series is past
     * its cadence — and until now the engine could not see that, so the question could only be
     * decided by whoever was reading at the time.
     */
    sourceFreshness?: "FRESH" | "STALE" | "UNKNOWN";
    completenessEvidence?: "COMPLETE" | "UNCONFIRMED" | "KNOWN_INCOMPLETE" | "UNKNOWN";
  };
}

export interface GateRequirement {
  id: string;
  question: string;
  recommendedDefault: string;
}

/**
 * Why an action that policy PERMITS still cannot run right now.
 *
 * Every member names an environmental condition, never a policy one, and each is drawn from a
 * blocker this project has actually hit. That restraint is deliberate: outcome states such as
 * EXECUTED or FAILED were considered and left out, because a `PolicyEvaluation` is produced
 * BEFORE the action and would never legitimately carry one. A status no evaluation can hold reads
 * as a capability the engine does not have — the same trap as an unreachable verdict.
 */
export type ExecutionStatus =
  | "READY"
  /** No usable GitHub credential on this machine (HG-001). */
  | "BLOCKED_MISSING_CREDENTIAL"
  /** The provider is free to call but issues no key to call it with (HG-002..HG-004). */
  | "BLOCKED_PROVIDER_KEY"
  /**
   * An included model's quota is exhausted.
   *
   * Explicitly an EXECUTION status and never a decision. The rule this encodes is that an
   * exhausted quota is a routing event, not a purchasing event: the review is still permitted,
   * and the response is to route to another included model or to deterministic verification.
   */
  | "BLOCKED_USAGE_LIMIT";

/**
 * What actually happened to an action, recorded AFTER the attempt.
 *
 * Separate from `ExecutionStatus`, which is readiness assessed BEFORE it. Folding the two into one
 * type would put EXECUTED and FAILED on a `PolicyEvaluation` that is produced before anything has
 * been tried, where they could never legitimately appear — a state nothing can reach reads as a
 * capability the engine does not have.
 */
export type ExecutionOutcome =
  | "EXECUTED"
  | "FAILED"
  | "DEFERRED"
  | "BLOCKED_MISSING_CREDENTIAL"
  | "BLOCKED_PROVIDER_KEY"
  | "BLOCKED_USAGE_LIMIT";

export interface ObservedExecution {
  action: ActionKind;
  /** The decision that was in force when this was attempted. */
  decision: PolicyDecision;
  outcome: ExecutionOutcome;
  /** What happened, in words. An outcome with no account of itself is not an audit record. */
  detail: string;
  /**
   * What satisfied the required verification, for an EXECUTED action that was permitted subject
   * to one. Required in that case; meaningless otherwise.
   */
  verifiedBy?: string;
}

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
  /**
   * Found by asking the coverage question the right way round.
   *
   * `RULES` is typed `Record<ActionKind, Rule>`, so the compiler already proves the table covers
   * every kind. That proves nothing about the kinds: an action the system performs but never
   * NAMED is not an uncovered rule, it is an invisible one, and no type can catch it.
   *
   * The escalation channel was exactly that. It writes to a GitHub issue on a publicly readable
   * repository — the only action in this system that sends anything off this machine — and it had
   * no classification, consulted no policy, and screened no content. The prohibition on posting
   * credentials there existed solely as prose in an operator's instructions, which is to say it
   * was enforced by whoever happened to be reading at the time. That is the condition this whole
   * engine exists to end.
   *
   * Not DEFERRED_HUMAN_GATE. Asking a human to approve each comment would defeat an ASYNCHRONOUS
   * decision channel whose entire purpose is to keep working while nobody is present. The risk
   * here is not the act of posting, it is the CONTENT posted, and content is checkable — so this
   * is AUTO_ALLOWED_WITH_VERIFY with the screen as the verification, and the screen fails closed.
   */
  POST_PUBLIC_ISSUE_COMMENT: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: [
      "CLAUDE.md — never commit secrets",
      "docs/GOVERNANCE_OS.md — escalation channel",
      "docs/HUMAN_GATE_QUEUE.md HG-001",
    ],
    rationale:
      "An escalation comment is a technical question posted to a public surface. Posting is " +
      "reversible in the weak sense that a comment can be deleted, and irreversible in the sense " +
      "that matters: anything published may already have been read, cached or indexed. The " +
      "verification is therefore on the text, before it leaves.",
    requiredVerification: [
      "screenPublicComment reports no findings",
      "the comment carries a protocol ID, so a duplicate post is detectable",
    ],
    refine: (action, base) =>
      action.context?.credentialsAvailable === false
        ? { ...base, execution: "BLOCKED_MISSING_CREDENTIAL" }
        : base,
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
    refine: (action, base) => {
      // Two independent questions, answered separately and in this order. "Free to call" and
      // "callable" are not the same claim: FRED, ECOS and OpenDART are all free and all
      // unreachable here, and recording that as anything other than an execution blocker would
      // misfile a standing environmental gap as a policy position.
      const withKey: PolicyEvaluation =
        action.context?.providerKeyAvailable === false
          ? { ...base, execution: "BLOCKED_PROVIDER_KEY" }
          : base;
      return action.context?.withinDocumentedRateLimit === true
        ? { ...withKey, decision: "AUTO_ALLOWED", requiredVerification: [] }
        : withKey;
    },
  },
  RUN_INDEPENDENT_AI_REVIEW: {
    decision: "AUTO_ALLOWED",
    citations: ["docs/AI_RESOURCE_POLICY.md", "docs/TEST_STRATEGY.md — Codex review"],
    rationale:
      "Review by an INCLUDED model costs nothing extra and is required by the development loop.",
    refine: (action, base) =>
      action.context?.includedModelQuotaAvailable === false
        ? { ...base, execution: "BLOCKED_USAGE_LIMIT" }
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
    // Corrected after a bounded fidelity audit (`gpt-5.6-luna`): this was DEFERRED_HUMAN_GATE,
    // which is LOOSER than either document it cites. AI_RESOURCE_POLICY.md says "Zero additional
    // AI spend beyond the Claude Max 20x subscription. No Anthropic usage credits, no API PAYG
    // ..., no auto top-up", and on exhaustion "stop, write USAGE_LIMIT_PAUSE ... do not switch to
    // a paid fallback". CLAUDE.md's absolute rules say "Never activate paid ... usage, buy
    // credits, or use a PAYG key." Neither offers a question a human answers in the moment; both
    // prescribe an action.
    //
    // The old rationale — that an exhausted quota is a routing event and purchasing is the user's
    // call to make — is a good argument about what the policy SHOULD be. It is not what the cited
    // documents say, and an engine that quietly upgrades an argument into a rule is not encoding
    // policy, it is having opinions. The user changes this by changing the document.
    //
    // Note the direction. The last fidelity correction (CALL_PAID_PROVIDER) made a rule less
    // strict to match its citation; this one makes a rule stricter to match its citation.
    // Corrections that only ever loosen would be a pattern worth distrusting.
    decision: "DENIED",
    citations: [
      "docs/AI_RESOURCE_POLICY.md — 'Zero additional AI spend ... no auto top-up'",
      "CLAUDE.md — absolute rules, 'Never ... buy credits'",
    ],
    rationale:
      "Both governing documents prohibit this outright and prescribe what to do instead: stop and " +
      "record USAGE_LIMIT_PAUSE. An exhausted quota is a routing event — route to another " +
      "included model or to deterministic verification.",
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
  PUBLISH_CURRENT_STATE_CLAIM: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["docs/DATA_POLICY.md", "CLAUDE.md — no hallucinated financial facts"],
    rationale:
      "Presenting a value as the current state of the world is a claim about the world, so the " +
      "freshness of what it rests on is part of the claim rather than metadata about it.",
    requiredVerification: ["underlying series is within its own observed cadence"],
    refine: (action, base) => {
      const freshness = action.context?.sourceFreshness;
      if (freshness === "STALE") {
        // A DECISION, not an execution blocker. Nothing in the environment is missing; the data
        // is present and says the claim would be false.
        return {
          ...base,
          decision: "DENIED",
          requiredVerification: [],
          rationale:
            "The underlying series is past its own update cadence, so presenting its last value " +
            "as the current state would assert something the data does not support.",
        };
      }
      if (freshness === "FRESH") {
        return { ...base, decision: "AUTO_ALLOWED", requiredVerification: [] };
      }
      // UNKNOWN and absent are the same position: too little history to project a cadence, so
      // currency was never established. Absence of evidence is not evidence of currency.
      return {
        ...base,
        requiredVerification: ["disclose that freshness could not be established"],
      };
    },
  },
  PUBLISH_COMPLETENESS_CLAIM: {
    decision: "AUTO_ALLOWED_WITH_VERIFY",
    citations: ["docs/DATA_POLICY.md", "docs/ARCHITECTURE.md — Claim Ledger"],
    rationale:
      "Saying a dataset is complete is itself a claim, and this project has shipped it wrongly: " +
      "1000 of 2240 filings were presented as the whole history.",
    requiredVerification: ["provider-stated total matches what is held"],
    refine: (action, base) => {
      switch (action.context?.completenessEvidence) {
        case "KNOWN_INCOMPLETE":
          return {
            ...base,
            decision: "DENIED",
            requiredVerification: [],
            rationale: "A known shortfall cannot be presented as a complete dataset.",
          };
        case "COMPLETE":
          return { ...base, decision: "AUTO_ALLOWED", requiredVerification: [] };
        default:
          // UNCONFIRMED is the normal state for SEC facts and will stay that way, because
          // companyfacts publishes no total. The claim is still permitted — with the limitation
          // shown to the reader, which is what separates it from silence.
          return {
            ...base,
            requiredVerification: [
              "disclose that completeness is unconfirmed rather than established",
            ],
          };
      }
    },
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
/**
 * Records what became of an action, refusing to record the one thing that must never happen.
 *
 * An action the policy DENIED or deferred to a human cannot be recorded as EXECUTED. If it was, the
 * governance record would be the last place the violation is visible, which is the opposite of what
 * a governance record is for. Throwing here is deliberate: this is called by the recorder, never on
 * a user path, and a silently-corrected audit entry is worse than a crash in a shadow tool.
 */
export function observeExecution(
  evaluation: PolicyEvaluation,
  outcome: ExecutionOutcome,
  detail: string,
  verifiedBy?: string,
): ObservedExecution {
  if (
    outcome === "EXECUTED" &&
    (evaluation.decision === "DENIED" || evaluation.decision === "DEFERRED_HUMAN_GATE")
  ) {
    throw new Error(
      `${evaluation.action.kind} was recorded as EXECUTED under a ${evaluation.decision} decision. ` +
        "An audit record that can express a policy violation as a normal outcome is not an audit " +
        "record.",
    );
  }

  // AUTO_ALLOWED_WITH_VERIFY means the verification MUST pass, and the first version of this
  // function let an action be recorded as EXECUTED without any statement that it had
  // (`gpt-5.6-terra`, reproduced with REFACTOR). "Permitted subject to a condition" recorded as
  // "done" with no mention of the condition is the same hole the DENIED check above closes, one
  // decision further along.
  if (
    outcome === "EXECUTED" &&
    evaluation.decision === "AUTO_ALLOWED_WITH_VERIFY" &&
    evaluation.requiredVerification.length > 0 &&
    !verifiedBy
  ) {
    throw new Error(
      `${evaluation.action.kind} was recorded as EXECUTED under AUTO_ALLOWED_WITH_VERIFY without ` +
        `naming what satisfied [${evaluation.requiredVerification.join(", ")}]. The condition is ` +
        "part of the permission, so an outcome that omits it is not evidence the action was allowed.",
    );
  }

  return {
    action: evaluation.action.kind,
    decision: evaluation.decision,
    outcome,
    detail,
    verifiedBy,
  };
}

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
