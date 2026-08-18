import type {
  CalculationInput,
  DimensionName,
  DimensionResult,
  Dimensions,
  VerificationInput,
  VerificationResult,
  Verdict,
} from "./types";
import { compareVintage } from "../fabric/vintage";
import { classifyEvidenceGap, type CapabilityAxis } from "../fabric/providerCapability";

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
 * The single source an output was assembled from, or null when that is not a single answer.
 *
 * The capability matrix describes ONE provider, so asking it about an output built from two would
 * be answering a question nobody asked. Returning null makes the caller handle that rather than
 * silently consulting the first source and presenting the result as though it covered both.
 */
function soleSource(input: VerificationInput): string | null {
  const distinct = new Set(input.sourceCodes.filter((c) => c && c.trim().length > 0));
  return distinct.size === 1 ? [...distinct][0] : null;
}

/**
 * Attaches the capability matrix's explanation for a missing piece of evidence.
 *
 * The status says the evidence is not there; this says whether anyone can do anything about it.
 */
function withEvidenceGap(
  result: DimensionResult,
  input: VerificationInput,
  axis: CapabilityAxis,
): DimensionResult {
  const sourceCode = soleSource(input);
  if (!sourceCode) return result;
  const gap = classifyEvidenceGap(sourceCode, axis, false);
  return {
    ...result,
    evidenceGap: gap.kind,
    rationale: `${result.rationale} ${gap.rationale}${gap.blockedBy ? ` (${gap.blockedBy})` : ""}`,
  };
}

/**
 * Day difference beyond which two same-bucket periods are materially unequal. Matches
 * `filingDiff.ts`: a 13-week quarter drifts a day or two against the calendar, which is noise,
 * while a 14-week quarter is seven days longer, which is a week of trading.
 */
const PERIOD_DAY_TOLERANCE = 4;

/**
 * Tolerance when recomputing a percentage, absorbing the rounding already applied at storage.
 *
 * Both halves are needed. The relative part handles large percentages, where 4 decimal places is
 * a vanishing share of the value. The ABSOLUTE floor handles small ones: a stored figure rounded
 * to 4dp can be off by up to 0.00005, which a purely relative epsilon undershoots badly once the
 * percentage itself is tiny — so a correct +0.0000049% change was being rejected as fabricated
 * (`gpt-5.6-sol`, 2026-08-18). `filingDiff.ts` rounds to 4dp, which is where 0.00005 comes from.
 */
const PERCENT_EPSILON_RELATIVE = 0.001;
const PERCENT_EPSILON_ABSOLUTE = 0.00005;

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

  // Two different companies. The contract had no entity field at all until an adversarial review
  // pointed it out, so this comparison was unrepresentable rather than merely unchecked.
  if (current.entityRef && previous.entityRef && current.entityRef !== previous.entityRef) {
    return fail(
      `Different entities: ${previous.entityRef} against ${current.entityRef}. A change between ` +
        "two companies is not a change.",
    );
  }

  // Absence of a concept is not agreement between concepts. With `concept` optional, comparing
  // revenue against net income used to pass this check by skipping it.
  if (!current.concept || !previous.concept) {
    return unknown(
      "At least one side does not state which concept it measures, so comparability cannot be " +
        "judged. Two unnamed quantities are not known to be the same quantity.",
    );
  }

  if (current.concept !== previous.concept) {
    if (!calc.conceptsReconciled) {
      return fail(
        `Concepts differ: "${current.concept}" against "${previous.concept}". Tags that mean the ` +
          "same thing across a taxonomy transition must be reconciled explicitly, not assumed.",
      );
    }
    return {
      status: "PASS",
      rationale:
        `Comparable, WITH A LIMITATION: the concept changed from "${previous.concept}" to ` +
        `"${current.concept}" and the transition is declared reconciled — ${calc.conceptsReconciled}. ` +
        "A reader must be told the tag changed underneath the comparison.",
    };
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

  // Two instants, not two spans. A macro observation is a value AT a date with no duration, so
  // reporting "equal null-month spans" would be nonsense dressed as a finding — and would read as
  // though a span had been checked when there was none to check.
  if (current.period.months === null && previous.period.months === null) {
    return pass(
      `Same concept and unit, two readings at a point in time: ${previous.period.end} then ` +
        `${current.period.end}.`,
    );
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
  const tolerance = Math.abs(expectedPercent) * PERCENT_EPSILON_RELATIVE + PERCENT_EPSILON_ABSOLUTE;
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
    // A DISCLOSED LIMITATION, not an unknown that erases the other dimensions.
    //
    // Discovered by the first shadow run against real data: all eight Apple outputs came back
    // INSUFFICIENT_EVIDENCE while every correctness dimension passed, because SEC's companyfacts
    // endpoint publishes no total. Since it never will, the old semantics meant Verify could
    // never say VERIFIED about the product's main output — a verifier that returns one answer
    // for everything has told you nothing, which is the failure this layer was built to avoid.
    //
    // The rule that matters is still kept: completeness is never CLAIMED without evidence. It is
    // reported as a caveat the reader must see, and the correctness findings stay visible behind
    // it instead of being swallowed.
    // Which KIND of "no total" this is decides whether anyone can act on it. SEC's companyfacts
    // publishes none and never will, so the limitation is permanent; FRED declares a `count` no
    // live response has confirmed, so the same sentence describes a work item. Rendering both as
    // "the provider states no total" told a reader nothing they could use.
    return withEvidenceGap(
      {
        status: "PASS",
        rationale:
          "Verifiable, WITH A LIMITATION: no shortfall was detected, but no provider-stated " +
          "total is held to check the count against, so completeness is unconfirmed rather " +
          "than established.",
      },
      input,
      "total_count_evidence",
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

  if (!f) {
    // Inapplicability has to be earned from the input, not assumed because evidence is absent.
    //
    // It IS earned here: a comparison between two figures with explicit, closed period ends is a
    // statement about what a company reported for two past periods. Those numbers do not become
    // less true with time, so there is no currency question of the kind a live macro reading has.
    // Whether a NEWER period exists that we have not ingested is a completeness question, and
    // `data_completeness` already asks it.
    //
    // Anything else — a live reading, a claim with no bounded periods — genuinely was not checked,
    // and says so.
    const bothPeriodsClosed = Boolean(calc?.current.period.end && calc?.previous.period.end);
    return bothPeriodsClosed
      ? na(
          "A comparison of two closed reporting periods does not go stale: both figures are " +
            "dated facts, and whether a newer period exists is a completeness question.",
        )
      : unknown(
          "No freshness evidence supplied and no closed reporting periods to make the question " +
            "moot, so whether the underlying data is current was never established.",
        );
  }
  return pass("Period bounds ordered correctly and no staleness reported.");
}

/**
 * Whether the version of the value being shown is the provider's current one.
 *
 * IR-021 is the whole reason this dimension exists. A replayed stale figure became the head of a
 * revision chain because it arrived last, and every other dimension would have passed it: the
 * number was well-formed, correctly attributed, internally consistent and arithmetically sound.
 * It was simply the wrong VERSION. No amount of checking a value tells you whether a better one
 * has already superseded it.
 *
 * Applicability is decided from the figures, not assumed. Where both sides name the provider
 * filing they were read out of, the version question is already answered by that identity — which
 * is why SEC-sourced comparisons pass through here rather than piling up as unknowns.
 */
function revisionIntegrity(input: VerificationInput): DimensionResult {
  const rev = input.revision;
  if (rev) {
    const decision = compareVintage(rev.superseded, rev.applied);
    switch (decision.verdict) {
      case "CANDIDATE_IS_NEWER":
        return pass(`The applied value is the provider's newer version — ${decision.rationale}`);
      case "CANDIDATE_IS_OLDER":
        return fail(
          `The displayed value is an OLDER provider version than the one it replaced — ` +
            `${decision.rationale} A superseded figure is being presented as current.`,
        );
      case "SAME_VINTAGE":
        return fail(
          `A value was replaced by a different value carrying the same provider vintage — ` +
            `${decision.rationale} One vintage cannot have two answers, so either the provider ` +
            "contradicted itself or the two were never the same series.",
        );
      case "UNRESOLVED":
        return withEvidenceGap(
          unknown(
            `${decision.rationale}` +
              (rev.valueRepeatsEarlierInChain
                ? " The applied value also repeats one seen earlier in this chain, which is the " +
                  "signature of a stale replay AND of a provider correcting back to a figure it " +
                  "published before. Those are opposite situations and no held evidence separates " +
                  "them."
                : ""),
          ),
          input,
          "provider_vintage_time",
        );
    }
  }

  const calc = input.calculation;
  if (calc?.current.accessionNumber && calc.previous.accessionNumber) {
    // An accession alone is NOT enough, although the first version of this treated it as though
    // it were. It identifies the filing a figure came from; a figure restated by a later 10-K/A
    // still carries the accession of the original, so "both sides name a filing" was returning
    // NOT_APPLICABLE for precisely the case this dimension exists to catch.
    //
    // What earns it is filing identity PLUS someone having ranked every held version for the
    // period. Where that ranking has not happened, the question is open, not inapplicable.
    if (calc.current.isMostCurrentHeldVersion && calc.previous.isMostCurrentHeldVersion) {
      return na(
        `Both figures are bound to a named provider filing (${calc.previous.accessionNumber} then ` +
          `${calc.current.accessionNumber}) and each is the most current version held for its ` +
          "period. Which version is shown follows from filing identity and that ranking, not from " +
          "the order our ingests happened to arrive.",
      );
    }
    return withEvidenceGap(
      unknown(
        `Both figures name a filing (${calc.previous.accessionNumber}, ` +
          `${calc.current.accessionNumber}), but nothing states that either is the most current ` +
          "version held for its period. A figure restated by a later amendment carries the " +
          "accession of the filing it was originally reported in.",
      ),
      input,
      "amendment_identity",
    );
  }

  return withEvidenceGap(
    unknown(
      "No figure here names the provider filing or revision it came from, and no vintage " +
        "evidence was supplied, so whether a later ingest silently replaced a newer value cannot " +
        "be established. Retrieval order is not semantic recency.",
    ),
    input,
    "provider_vintage_time",
  );
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

/**
 * Whether a second source could corroborate this, and whether one did.
 *
 * Genuinely NOT_APPLICABLE only when exactly one source is involved — with one provider there is
 * nothing to reconcile against, and saying so is a fact about the input rather than an assumption.
 * With two or more, reconciliation is owed and has not been implemented, which is
 * INSUFFICIENT_EVIDENCE.
 */
function crossSourceConsistency(input: VerificationInput): DimensionResult {
  const distinct = new Set(input.sourceCodes.filter((c) => c && c.trim().length > 0));
  if (distinct.size === 0) {
    return unknown("No sources recorded, so cross-source agreement cannot be assessed.");
  }
  if (distinct.size === 1) {
    return na(`Single source (${[...distinct][0]}); nothing to reconcile against.`);
  }
  return unknown(
    `${distinct.size} sources are involved (${[...distinct].join(", ")}) but no reconciliation ` +
      "was performed. Two providers covering one fact must be compared, not assumed to agree.",
  );
}

/**
 * Whether this output could constitute prohibited advice under `docs/LEGAL_GUARDRAILS.md`.
 *
 * Grounded in the output's shape rather than deferred to another module. A period-over-period
 * change between two reported figures is a statement about what a company filed — it recommends
 * nothing, names no price and suggests no action — so the dimension genuinely does not apply, and
 * saying NOT_APPLICABLE is a claim about the input rather than an excuse.
 *
 * An earlier draft returned INSUFFICIENT_EVIDENCE unconditionally here, which made EVERY verdict
 * INSUFFICIENT_EVIDENCE and reproduced the uniform-answer failure this layer exists to avoid.
 * Fail-open and fail-useless are both failures; the fix for one must not create the other.
 */
function adversarialResilience(input: VerificationInput): DimensionResult {
  if (input.claimType === "CALCULATION" && input.calculation) {
    return na(
      "A period-over-period change between two reported figures is not advice-shaped output: it " +
        "recommends nothing, names no price and suggests no action.",
    );
  }
  return unknown(
    "This output is not a reported-figure comparison, so whether it could read as advice has not " +
      "been established on this path.",
  );
}

function structuralValidity(input: VerificationInput): DimensionResult {
  if (!input.outputId || input.outputId.trim().length === 0) {
    return fail("No output identifier, so this verdict could not be attached to anything.");
  }

  // A CALCULATION with nothing to check used to verify clean: every calculation-shaped dimension
  // returned NOT_APPLICABLE, nothing failed, and the verdict came back VERIFIED. My own controls
  // never supplied an empty one, so the case went unexercised until an adversarial review
  // constructed it. Attaching a green label to nothing is worse than having no verifier.
  if (input.claimType === "CALCULATION" && !input.calculation) {
    return fail(
      "Typed CALCULATION but carries no calculation, so there is nothing to verify. A verdict " +
        "over an absent claim would be assurance about nothing.",
    );
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

  // CORRECTNESS OUTRANKS COVERAGE. An earlier ordering let any completeness failure win
  // unconditionally, so the +232.9985% fabrication computed over a truncated ingest came back
  // TRUNCATED — which reads as "we are missing some rows", not "this number is wrong". A reader
  // would have filed it as a data-coverage task. Truncation is still reported in `failed`; it
  // just no longer gets to speak for the verdict when something is actually incorrect.
  const CORRECTNESS = new Set<DimensionName>([
    "structural_validity",
    "semantic_consistency",
    "calculation_integrity",
    "source_integrity",
    "provenance_integrity",
    // A figure that is provably a rollback to a superseded version is not a coverage gap. It is a
    // wrong number wearing the label "current", which is exactly what REJECTED is for.
    "revision_integrity",
  ]);
  if (failed.some((name) => CORRECTNESS.has(name))) {
    return { verdict: "REJECTED", failed, limitations };
  }
  if (failed.includes("data_completeness")) {
    return { verdict: "TRUNCATED", failed, limitations };
  }
  if (failed.length === 1 && failed[0] === "temporal_integrity") {
    return { verdict: "STALE", failed, limitations };
  }
  if (failed.length > 0) {
    return { verdict: "REJECTED", failed, limitations };
  }
  // Ranked above the generic unknown rather than requiring it to be the only one.
  //
  // The first draft fired only when revision_integrity was the sole open dimension, mirroring the
  // STALE rule above — and the verdict then turned out to be unreachable in practice, because a
  // FACT always leaves adversarial_resilience open too. A verdict no real input can produce is
  // worse than none: it reads as a capability the system does not have.
  //
  // Ranking it is also the right answer on the merits. The other unknowns are questions about
  // COVERAGE — did we check enough, did we reconcile against a second source. This one is a
  // question about the number on the page: it may be the wrong VERSION of the right figure. That
  // is closer to incorrect than to unchecked, so it gets to name the verdict. Every other open
  // dimension stays visible and unaltered in `dimensions`.
  if (unresolved.includes("revision_integrity")) {
    return { verdict: "SEMANTIC_REVISION_UNRESOLVED", failed, limitations };
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
    revision_integrity: revisionIntegrity(input),
    // These two were blanket NOT_APPLICABLE, which is a fail-open: it asserts the check does not
    // apply, without ever establishing that. The distinction §6 of the operating directive draws
    // is exactly this — missing evidence must not become "not applicable" merely because it is
    // missing. Both are now derived from the input rather than assumed.
    cross_source_consistency: crossSourceConsistency(input),
    adversarial_resilience: adversarialResilience(input),
  };

  const { verdict, failed, limitations } = decide(dimensions);
  return { outputId: input.outputId, verdict, dimensions, limitations, failed };
}
