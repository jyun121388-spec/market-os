import type {
  CalculationInput,
  DimensionName,
  DimensionResult,
  Dimensions,
  VerificationInput,
  VerificationResult,
  Verdict,
} from "./types";

/**
 * Verify — SHADOW MODE evaluators (docs/VERIFY_ARCHITECTURE.md).
 *
 * Pure functions over `VerificationInput`, deliberately. Purity means these can be tested against
 * this project's REAL historical defects, which are the best fixtures available — a verifier whose
 * only evidence is invented cases proves nothing about the failures that actually happened.
 *
 * No confidence percentages are produced anywhere. A number like "94% confident" implies a
 * calibrated probability, and nothing here produces one; it would be a self-report, and
 * `docs/LOCAL_AI_CALIBRATION.md` records exactly what those are worth. Verify reports which
 * dimensions passed and why.
 */

const pass = (rationale: string): DimensionResult => ({ status: "PASS", rationale });
const fail = (rationale: string): DimensionResult => ({ status: "FAIL", rationale });
const na = (rationale: string): DimensionResult => ({ status: "NOT_APPLICABLE", rationale });
const unknown = (rationale: string): DimensionResult => ({
  status: "INSUFFICIENT_EVIDENCE",
  rationale,
});

/**
 * Day difference beyond which two same-bucket periods are materially unequal. Matches
 * `filingDiff.ts`: a 13-week quarter drifts a day or two against the calendar, which is noise,
 * while a 14-week quarter is seven days longer, which is a week of trading.
 */
const PERIOD_DAY_TOLERANCE = 4;

/** Relative tolerance when recomputing a percentage, to absorb the stored rounding. */
const PERCENT_EPSILON = 0.001;

function describe(input: CalculationInput): string {
  const span = input.period.start ? `${input.period.start}..${input.period.end}` : input.period.end;
  return `${input.label} ${input.value} ${input.unit} (${span})`;
}

/**
 * The dimension this project most needs, and the one no test suite naturally provides.
 *
 * Two quantities are comparable only if they measure the same thing over equally-long, genuinely
 * different periods, in the same unit. Every clause below corresponds to a real defect or a real
 * near-miss found in this repository.
 */
function semanticConsistency(input: VerificationInput): DimensionResult {
  const calc = input.calculation;
  if (!calc) return na("Not a calculation; nothing to compare.");

  const { current, previous } = calc;

  if (current.unit !== previous.unit) {
    return fail(
      `Units differ: ${describe(current)} against ${describe(previous)}. A change between two ` +
        "different units is not a change.",
    );
  }

  if (current.concept && previous.concept && current.concept !== previous.concept) {
    return fail(
      `Concepts differ: "${current.concept}" against "${previous.concept}". Tags that mean the ` +
        "same thing across a taxonomy transition must be reconciled before subtracting, not assumed.",
    );
  }

  // The +232.9985% defect, stated as a rule. Two figures from ONE filing describing periods that
  // end on the same day are a year-to-date figure and a quarterly one, not two periods.
  if (current.period.end === previous.period.end) {
    return fail(
      `Both figures cover periods ending ${current.period.end}. That is one reporting date, not ` +
        "a period-over-period comparison.",
    );
  }

  if (
    current.accessionNumber &&
    previous.accessionNumber &&
    current.accessionNumber === previous.accessionNumber &&
    current.period.months !== previous.period.months
  ) {
    return fail(
      `Both figures come from filing ${current.accessionNumber} but cover different span lengths ` +
        `(${current.period.months} vs ${previous.period.months} months) — a year-to-date figure ` +
        "against a quarterly one.",
    );
  }

  if (current.period.months !== previous.period.months) {
    return fail(
      `Period lengths differ: ${current.period.months} months against ` +
        `${previous.period.months}. Not like for like.`,
    );
  }

  if (new Date(current.period.end) <= new Date(previous.period.end)) {
    return fail(
      `The "current" period (${current.period.end}) does not end after the "previous" one ` +
        `(${previous.period.end}).`,
    );
  }

  // Equal month buckets are not equal durations — Apple's fiscal Q1 is periodically 14 weeks, and
  // the real database holds 90-day quarters beside 97-day ones. Comparable, but only if disclosed.
  if (
    current.period.days !== null &&
    previous.period.days !== null &&
    Math.abs(current.period.days - previous.period.days) > PERIOD_DAY_TOLERANCE
  ) {
    return {
      status: "PASS",
      rationale:
        `Comparable, WITH A LIMITATION: spans differ by ` +
        `${Math.abs(current.period.days - previous.period.days)} days ` +
        `(${previous.period.days} vs ${current.period.days}). Part of the change is the extra ` +
        "days rather than underlying performance, and must be disclosed.",
    };
  }

  return pass(
    `Same concept and unit, equal ${current.period.months}-month spans, ending ` +
      `${previous.period.end} then ${current.period.end}.`,
  );
}

/** Recompute from the stated inputs. A correct formula fed the wrong two rows still fails here. */
function calculationIntegrity(input: VerificationInput): DimensionResult {
  const calc = input.calculation;
  if (!calc) return na("Not a calculation.");

  const expectedAbsolute = calc.current.value - calc.previous.value;
  if (
    Math.abs(expectedAbsolute - calc.claimedAbsoluteChange) >
    Math.abs(expectedAbsolute) * 1e-9 + 1e-6
  ) {
    return fail(
      `Absolute change does not recompute: claimed ${calc.claimedAbsoluteChange}, ` +
        `${calc.current.value} - ${calc.previous.value} = ${expectedAbsolute}.`,
    );
  }

  if (calc.previous.value === 0) {
    return calc.claimedPercentChange === null
      ? pass("Previous value is zero; percent change correctly withheld rather than invented.")
      : fail(
          `Previous value is zero but a percent change of ${calc.claimedPercentChange} was ` +
            "claimed. Division by zero cannot produce a percentage.",
        );
  }

  if (calc.claimedPercentChange === null) {
    return fail("Percent change withheld although the previous value is non-zero.");
  }

  const expectedPercent = (expectedAbsolute / calc.previous.value) * 100;
  const tolerance = Math.abs(expectedPercent) * PERCENT_EPSILON + 1e-6;
  if (Math.abs(expectedPercent - calc.claimedPercentChange) > tolerance) {
    return fail(
      `Percent change does not recompute: claimed ${calc.claimedPercentChange}, computed ` +
        `${expectedPercent}.`,
    );
  }

  return pass(`Recomputed from the stated inputs: ${expectedAbsolute}, ${expectedPercent}%.`);
}

/** Every figure must trace to a stored source. IR-007/IR-008 were exactly this failing. */
function sourceIntegrity(input: VerificationInput): DimensionResult {
  const named = input.sourceCodes.filter((code) => code && code.trim().length > 0);
  if (named.length === 0) {
    return fail("No source recorded. A FACT shown to a user must trace to a stored source.");
  }
  const calc = input.calculation;
  if (calc && calc.current.sourceCode !== calc.previous.sourceCode) {
    return fail(
      `The two figures come from different providers (${calc.previous.sourceCode} and ` +
        `${calc.current.sourceCode}). A corp code identifies a company only within its provider.`,
    );
  }
  return pass(`Attributed to ${named.join(", ")}.`);
}

/** A successful request is not a complete dataset. */
function dataCompleteness(input: VerificationInput): DimensionResult {
  const c = input.completeness;
  if (!c) return unknown("No completeness evidence supplied.");
  if (c.truncated) {
    const detail =
      c.providerTotal !== null && c.fetched !== null ? ` (${c.fetched} of ${c.providerTotal})` : "";
    return fail(`Computed over a knowably partial dataset${detail}.`);
  }
  if (c.providerTotal === null) {
    return unknown(
      "The provider states no total, so completeness cannot be confirmed. Absence of a total is " +
        "not evidence of completeness.",
    );
  }
  if (c.fetched !== null && c.fetched < c.providerTotal) {
    return fail(`Holds ${c.fetched} of the ${c.providerTotal} records the provider reports.`);
  }
  return pass(`Holds all ${c.providerTotal} records the provider reports.`);
}

function temporalIntegrity(input: VerificationInput): DimensionResult {
  // Freshness is checked FIRST and independently of whether there is a calculation. An earlier
  // draft returned NOT_APPLICABLE for any non-calculation output and never reached this, so a
  // stale FACT verified cleanly — the layer's own version of the bug it exists to catch. Its own
  // test caught it, which is the argument for writing the controls before trusting the evaluator.
  const f = input.freshness;
  if (f?.state === "STALE") {
    return fail(
      `Underlying series is past its own update cadence` +
        (f.daysSinceLastObservation !== null
          ? ` (${f.daysSinceLastObservation} days since the last observation).`
          : "."),
    );
  }

  const calc = input.calculation;
  if (calc) {
    for (const side of [calc.current, calc.previous]) {
      if (side.period.start && new Date(side.period.start) > new Date(side.period.end)) {
        return fail(`${side.label} has a period starting after it ends.`);
      }
    }
  }

  if (f?.state === "UNKNOWN") {
    return unknown(
      "Freshness could not be determined — too little history to project a cadence. Absence of " +
        "evidence is not evidence of currency.",
    );
  }
  if (!calc && !f) return na("No periods and no freshness evidence to check.");
  return pass("Period bounds ordered correctly and no staleness reported.");
}

function provenanceIntegrity(input: VerificationInput): DimensionResult {
  if (input.claimType === "INFERENCE") {
    if (input.confidence === undefined || input.confidence === null) {
      return fail("An INFERENCE claim carries no confidence, so its strength cannot be judged.");
    }
    if (input.confidence < 0 || input.confidence > 1) {
      return fail(`Confidence ${input.confidence} is outside 0..1.`);
    }
  }
  if (input.claimType === "FACT" && input.calculation) {
    return fail(
      "Typed FACT but carries a calculation. A derived number rendered as a reported fact " +
        "misstates where it came from.",
    );
  }
  return pass(`Claim type ${input.claimType} is consistent with the evidence supplied.`);
}

function structuralValidity(input: VerificationInput): DimensionResult {
  if (!input.outputId || input.outputId.trim().length === 0) {
    return fail("No output identifier, so this verdict could not be attached to anything.");
  }
  const calc = input.calculation;
  if (calc) {
    for (const side of [calc.current, calc.previous]) {
      if (!Number.isFinite(side.value)) return fail(`${side.label} value is not a finite number.`);
      if (!side.unit || side.unit.trim().length === 0) return fail(`${side.label} has no unit.`);
    }
  }
  return pass("Required fields present and well-formed.");
}

/**
 * Turns dimension results into one verdict.
 *
 * Order matters: the most specific cause wins, so a verdict can always be traced to a reason. A
 * limitation never silently upgrades to VERIFIED, and INSUFFICIENT_EVIDENCE never silently
 * downgrades to REJECTED — "we cannot tell" and "this is wrong" have different consequences, and
 * collapsing them makes the system either cry wolf or hide uncertainty.
 */
function decide(dimensions: Dimensions): {
  verdict: Verdict;
  failed: DimensionName[];
  limitations: string[];
} {
  const entries = Object.entries(dimensions) as [DimensionName, DimensionResult][];
  const failed = entries.filter(([, d]) => d.status === "FAIL").map(([name]) => name);
  const unresolved = entries
    .filter(([, d]) => d.status === "INSUFFICIENT_EVIDENCE")
    .map(([name]) => name);
  const limitations = entries
    .filter(([, d]) => d.status === "PASS" && d.rationale.includes("WITH A LIMITATION"))
    .map(([name, d]) => `${name}: ${d.rationale}`);

  if (failed.includes("data_completeness")) {
    return { verdict: "TRUNCATED", failed, limitations };
  }
  if (failed.length === 1 && failed[0] === "temporal_integrity") {
    return { verdict: "STALE", failed, limitations };
  }
  if (failed.length > 0) {
    return { verdict: "REJECTED", failed, limitations };
  }
  if (unresolved.length > 0) {
    return { verdict: "INSUFFICIENT_EVIDENCE", failed, limitations };
  }
  if (limitations.length > 0) {
    return { verdict: "VERIFIED_WITH_LIMITATION", failed, limitations };
  }
  return { verdict: "VERIFIED", failed, limitations };
}

export function verify(input: VerificationInput): VerificationResult {
  const dimensions: Dimensions = {
    structural_validity: structuralValidity(input),
    source_integrity: sourceIntegrity(input),
    data_completeness: dataCompleteness(input),
    semantic_consistency: semanticConsistency(input),
    calculation_integrity: calculationIntegrity(input),
    provenance_integrity: provenanceIntegrity(input),
    temporal_integrity: temporalIntegrity(input),
    // Not yet evaluated. Marked NOT_APPLICABLE rather than PASS, because claiming a check ran
    // when it did not is the failure mode this whole layer exists to prevent.
    cross_source_consistency: na("Single-source output; no second source to reconcile against."),
    adversarial_resilience: na("Evaluated by the Ask Market guardrail, not by this path."),
  };

  const { verdict, failed, limitations } = decide(dimensions);
  return { outputId: input.outputId, verdict, dimensions, limitations, failed };
}
