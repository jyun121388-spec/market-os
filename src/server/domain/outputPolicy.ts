/**
 * A detector for named prohibited constructions. **Not** a publication authority.
 *
 * It used to be one, and IR-101 measured what that was worth: novel advisory prose in two languages
 * matched nothing here and was published, because the effective rule had become "no pattern fired
 * and every digit appeared in a list the caller supplied, therefore safe". Absence of a match is
 * not evidence, and a finite list of phrasings over free text is absence by construction. The
 * request-side holdouts had already measured the same thing from the other direction — 81% false
 * negative on the first fresh corpus — which is why the answer is not a longer list.
 *
 * Publication authority now lives in `./outputPlan`: a model names stored records, and the
 * repository renders them. Nothing a model writes reaches a reader, so there is no free text for a
 * scanner to be the last line of defence over.
 *
 * ## What this is still good for
 *
 * When a planner proposes something unpublishable, "it proposed advice" and "it proposed something
 * unrecognised" are different reports, and the first is worth naming. A misbehaving planner that
 * says `you should buy Samsung` should be recorded as `PERSONALISED_RECOMMENDATION`, not as a
 * generic malformed segment. That is a diagnosis, and diagnoses are allowed to be incomplete.
 *
 * The load-bearing property, asserted by mutation: **deleting every pattern below must not make
 * anything publishable.** If it did, this file would be the safety boundary again.
 */

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

export interface OutputDetection {
  /** True when at least one named prohibited construction was found. Never a licence when false. */
  blocked: boolean;
  findings: OutputFinding[];
  reason: string;
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

/**
 * Runs the pattern list over text and names what it found.
 *
 * Returns every kind of violation present rather than the first, because a reviewer reading a
 * rejected plan needs the whole list. Takes only text: there is no context parameter, and that is
 * deliberate — the caller-supplied `attributableFigures` this function used to accept was IR-101
 * candidates Q and R, a caller vouching for its own numbers. Numeric authority is a verified stored
 * claim (`./outputPlan`), and there is no argument to this function that could substitute for one.
 */
export function detectProhibitedConstructions(text: string): OutputDetection {
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

  if (findings.length === 0) {
    return {
      blocked: false,
      findings: [],
      reason:
        "No named prohibited construction found. This is not a statement that the text is safe — " +
        "see the module docstring; publication authority is structural and lives elsewhere.",
    };
  }

  return {
    blocked: true,
    findings,
    reason: `Prohibited construction found: ${findings.map((f) => f.violation).join(", ")}.`,
  };
}
