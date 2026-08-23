/**
 * The other boundary: what a model said, checked independently of what it was asked.
 *
 * A request gate cannot establish that generated prose is free of a personalised recommendation, a
 * price target, a guarantee or an allocation instruction. It can only establish that the question
 * was a reasonable one to ask. Those are different facts, and treating the first as evidence for
 * the second is the mistake this file exists to make impossible:
 *
 *     AUTHORIZED REQUEST -> MODEL -> OUTPUT POLICY -> CLAIM/PROVENANCE -> USER
 *                                   ^^^^^^^^^^^^^
 *
 * **Independent of the input classification, deliberately.** This function is not told what frame
 * the request had, whether it was authorized, or what the prompt said, and it must not be — a
 * scanner that trusts the request has no way to catch the case that matters, which is a
 * well-formed factual question answered with advice.
 *
 * ## Fail closed, and what that means for prose
 *
 * A guardrail over free text cannot enumerate what prose may say. So the verdict is not
 * "clean / not clean" but three-valued, and only the first is publishable:
 *
 *  - `CLEAR` — no prohibited construction found AND every figure is attributable.
 *  - `BLOCKED` — a prohibited construction was found. Named, so the failure is auditable.
 *  - `UNVERIFIABLE` — nothing prohibited was found and something could not be checked. Not
 *    publishable. This is the state an absence-based scanner would call clean, and it is where a
 *    generation path leaks.
 *
 * No provider is required to build, test or reason about any of this, and none is used. The
 * interface, the policy contract, the fixtures and the tests are the deliverable; the model is not
 * part of it and is not approved (HG-006).
 */

/** What the scanner found. Only `CLEAR` may be shown to a user. */
export type OutputVerdict = "CLEAR" | "BLOCKED" | "UNVERIFIABLE";

/**
 * The prohibited constructions, one per hard prohibition in `docs/LEGAL_GUARDRAILS.md`.
 *
 * Named as OUTPUT shapes rather than request shapes. "Should I buy Samsung?" is a request; "You
 * should buy Samsung" and "Samsung is a buy at these levels" are outputs, and only the second kind
 * can appear here.
 */
export type OutputViolation =
  | "PERSONALISED_RECOMMENDATION"
  | "PORTFOLIO_ALLOCATION"
  | "AUTOMATED_TRADING_INSTRUCTION"
  | "GUARANTEED_RETURN"
  | "DEFINITIVE_PRICE_PREDICTION"
  | "LOSS_PROTECTION_PROMISE"
  | "USER_FUND_ALLOCATION";

export interface OutputFinding {
  violation: OutputViolation;
  /** The matched span, so a reviewer can see what fired rather than trusting the label. */
  evidence: string;
}

export interface OutputScan {
  verdict: OutputVerdict;
  findings: OutputFinding[];
  /** Why the verdict is what it is, in words. */
  reason: string;
}

/**
 * What the caller must supply for a figure to be publishable.
 *
 * Deliberately a required input rather than an optional one. A scanner that accepted "no
 * attribution information provided" and returned CLEAR would make forgetting to wire provenance
 * indistinguishable from having it, and `docs/DATA_POLICY.md` is the whole reason that must not be
 * possible.
 */
export interface OutputContext {
  /**
   * Numeric strings the caller can attribute to a stored source, exactly as they appear in the
   * text. Empty is a valid answer and means "no figure in this output is attributable".
   */
  attributableFigures: string[];
}

const VIOLATION_PATTERNS: { violation: OutputViolation; patterns: RegExp[] }[] = [
  {
    violation: "PERSONALISED_RECOMMENDATION",
    patterns: [
      /\byou (should|ought to|need to|must)\s+(buy|sell|short|hold|dump|exit|enter|add|trim)\b/i,
      /\b(i|we)\s+(recommend|suggest|advise)\b/i,
      /\bis a (strong )?(buy|sell)\b/i,
      /\bmy recommendation\b/i,
      /(사시|파시|매수하시|매도하시)(는\s*것을|기를)?\s*(권|추천|권장)/,
      /(추천(합니다|해요|드립니다|드려요))/,
    ],
  },
  {
    violation: "PORTFOLIO_ALLOCATION",
    patterns: [
      /\b(allocate|put|place)\s+\d+\s?%\s+(of your|to|into)\b/i,
      /\byour portfolio should\b/i,
      /\b\d+\s?\/\s?\d+\s+(split|allocation)\b/i,
      /(포트폴리오는?\s*[^.]{0,20}(구성|배분)하)/,
      /(비중을?\s*\d+\s?%\s*(로|으로)\s*(가져|맞추|유지))/,
    ],
  },
  {
    violation: "AUTOMATED_TRADING_INSTRUCTION",
    patterns: [
      /\b(place|submit|enter)\s+(a|an|the)?\s*(market|limit|stop)?\s*order\b/i,
      /\bset (a|an|your)\s+(stop[-\s]?loss|take[-\s]?profit|limit)\b/i,
      /(주문을?\s*(넣|내|체결)|자동으로\s*(매수|매도))/,
    ],
  },
  {
    violation: "GUARANTEED_RETURN",
    patterns: [
      /\b(guarantee[sd]?|assured|certain|risk[-\s]free)\b[^.]{0,40}\b(return|profit|gain|yield)\b/i,
      /\bwill (certainly|definitely|surely)\s+(rise|gain|return|profit)\b/i,
      /\bcannot lose\b/i,
      /(수익(이|을)?\s*(보장|확정)|무조건\s*(수익|이익|오르))/,
    ],
  },
  {
    violation: "DEFINITIVE_PRICE_PREDICTION",
    patterns: [
      /\bwill (reach|hit|be|close at|trade at)\s+[$₩€£]?\s?\d/i,
      /\b(price target|target price) (of|is|:)\s*[$₩€£]?\s?\d/i,
      /(에?\s*도달할\s*것|까지\s*(오를|갈)\s*것(입니다|이다|이에요))/,
      /(목표\s*(주가|가)(는|은)?\s*[\d,]+)/,
    ],
  },
  {
    violation: "LOSS_PROTECTION_PROMISE",
    patterns: [
      /\b(protects?|protected|shields?|immune)\b[^.]{0,30}\b(from|against)\b[^.]{0,20}\b(loss|losses|downside)\b/i,
      /\b(no|zero|without)\s+(risk|downside|chance) of (loss|losing)\b/i,
      /(원금(이|은)?\s*(보장|안전)|손실(이|은)?\s*(없|나지\s*않))/,
    ],
  },
  {
    violation: "USER_FUND_ALLOCATION",
    patterns: [
      /\b(put|invest|move)\s+(your|the)\s+[$₩€£]?\s?[\d,]+\b/i,
      /\bof your (savings|cash|money|bonus|inheritance)\b/i,
      /(당신의|귀하의|고객님의)\s*(자금|돈|자산)[^.]{0,20}(넣|투자|배분)/,
    ],
  },
];

/** Any run of digits that could be a figure a reader would rely on. */
const FIGURE = /\d[\d,]*(\.\d+)?%?/g;

/**
 * Scans generated prose. Independent of the request, and fail-closed on anything it cannot check.
 *
 * Returns `BLOCKED` on the first kind of violation found and every other kind found alongside it,
 * because a reviewer needs the whole list rather than the first hit.
 */
export function scanGeneratedOutput(text: string, context: OutputContext): OutputScan {
  const findings: OutputFinding[] = [];

  for (const { violation, patterns } of VIOLATION_PATTERNS) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({ violation, evidence: match[0].trim() });
        break;
      }
    }
  }

  if (findings.length > 0) {
    return {
      verdict: "BLOCKED",
      findings,
      reason: `Prohibited construction in generated output: ${findings
        .map((f) => f.violation)
        .join(", ")}.`,
    };
  }

  // Nothing prohibited was found, which is where an absence-based scanner would stop. Every figure
  // still has to be attributable, because an unsourced number is its own prohibition
  // (docs/DATA_POLICY.md) and a model produces those effortlessly.
  const attributable = new Set(context.attributableFigures);
  const unattributed = [...new Set(text.match(FIGURE) ?? [])].filter(
    (figure) => !attributable.has(figure),
  );

  if (unattributed.length > 0) {
    return {
      verdict: "UNVERIFIABLE",
      findings: [],
      reason:
        `Nothing prohibited was found, and ${unattributed.length} figure(s) could not be traced ` +
        `to a stored source: ${unattributed.slice(0, 5).join(", ")}. Not publishable. "Nothing ` +
        'prohibited was found" is not the same as "this is safe to show".',
    };
  }

  return {
    verdict: "CLEAR",
    findings: [],
    reason: "No prohibited construction, and every figure traces to a stored source.",
  };
}
