import type { CompletenessNote, ReportedFigure } from "./companyXray";

/**
 * Bounded scenario valuation — `[CHATGPT_DECISION][MARKET-V1-VALUATION-SURFACE-20260908]`.
 *
 * WHAT THIS IS. Two arithmetic scenarios over ONE already-stored, source-backed annual figure and
 * a multiple the USER supplies: `implied equity value = sourced figure × user multiple`, evaluated
 * at low, base and high. That is all. It is not a valuation model, it does not know what a
 * company is worth, and it never chooses a multiple on the user's behalf.
 *
 * WHY IT EXISTS AT ALL, given `companyXray.ts` says this repository does not value companies.
 * That remains true of Company X-Ray. The later delivery decision requires a valuation surface
 * with an applied method, explicit assumptions, an output range and provenance, and ruled that
 * `docs/LEGAL_GUARDRAILS.md` does not prohibit valuation as such — it prohibits personalized
 * recommendations, portfolio advice, guaranteed returns, definitive price predictions and
 * single-number "buy fitness" scores, and it REQUIRES that user-facing output touching valuation
 * distinguish FACT from CALCULATION from INFERENCE. That distinction is why the three result
 * pieces below are separate types carrying a literal `kind`: a user's guess cannot be rendered as
 * a sourced fact by accident, because it is not the same shape.
 *
 * WHAT IT MUST NEVER PRODUCE: a target price, a fair value, buy/sell/hold, undervalued or
 * overvalued, an expected return, or a per-share price. There is no share-count authority in this
 * repository, so there is no honest way to divide by one, and V1 does not try.
 *
 * NO SECOND FACT AUTHORITY. Every input arrives as `ReportedFigure[]` — the output of
 * `computeCompanyXray`, already selected through the shared `compareFactCurrency` comparator that
 * `filingDiff` and the figures table agree on. This module runs no query, imports no Prisma, and
 * cannot disagree with the page it appears on. It is pure, which is also why it can be tested
 * without a database and driven through the real page in the same session.
 */

/** The one earnings concept this repository tracks. Literal us-gaap tag, never a synonym. */
export const EARNINGS_CONCEPT = "NetIncomeLoss";

/**
 * The three literal revenue tags already tracked by the XBRL adapter, in the order the ingest
 * declares them. US GAAP changed revenue reporting with ASC 606, so a filer's history spans
 * several tags with no overlap — see `adapters/edgar-xbrl/types.ts`. They are NEVER merged: the
 * selection rule below picks exactly one and carries its tag through to the output verbatim.
 */
export const REVENUE_CONCEPTS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
] as const;

/**
 * A multiple is defined against a YEAR of earnings or revenue. Applying one to a quarter
 * overstates nothing and understates by roughly four — an arithmetic error of the exact kind the
 * nine-month-versus-quarter identity defect produced in `FinancialFact`, and the reason
 * `periodMonths` exists on `ReportedFigure` at all. So the period is required to bucket to twelve
 * months, and where no annual figure is stored the answer is a refusal rather than a quarter
 * quietly standing in for a year.
 */
export const REQUIRED_PERIOD_MONTHS = 12;

export type ValuationMethod = "PE_SCENARIO" | "PS_SCENARIO";

/**
 * Why a scenario produced no number. Machine-readable so the UI can explain rather than shrug,
 * and so a control can assert WHICH refusal happened — "INSUFFICIENT_DATA" that could mean six
 * things is how a control passes for the wrong reason.
 */
export type UnverifiableReason =
  | "NO_FACT_FOR_CONCEPT"
  | "NO_ANNUAL_PERIOD"
  | "VALUE_NOT_POSITIVE"
  | "VALUE_NOT_FINITE"
  | "UNIT_NOT_A_CURRENCY_AMOUNT"
  | "PROVENANCE_INCOMPLETE"
  | "COMPLETENESS_UNSAFE"
  | "FACT_IDENTITY_AMBIGUOUS";

export type AssumptionsRefusedReason =
  "MULTIPLE_NOT_FINITE" | "MULTIPLE_NEGATIVE" | "RANGE_NOT_ASCENDING";

/**
 * `AWAITING_ASSUMPTIONS` is separate from `UNVERIFIABLE` on purpose. An untouched form is not a
 * data problem, and folding it into the refusal state would tell a reader their company has no
 * usable figure when in fact nobody has typed a multiple yet.
 */
export type ValuationStatus =
  "COMPUTED" | "AWAITING_ASSUMPTIONS" | "UNVERIFIABLE" | "ASSUMPTIONS_REFUSED";

/**
 * The sourced input. `kind` is literal and load-bearing: it is what makes it structurally
 * impossible to hand a `UserAssumptions` to something expecting a fact.
 */
export interface SourcedFact {
  kind: "FACT";
  /** The original us-gaap tag, verbatim. Never unified, never renamed. */
  concept: string;
  unit: string;
  value: number;
  periodStart: string | null;
  periodEnd: string;
  periodMonths: number | null;
  fiscalPeriod: string | null;
  fiscalYear: number | null;
  form: string;
  /** The filing this number came from — `Filing.receiptNo` on the SEC side. */
  accessionNumber: string;
  sourceCode: string;
  completeness: CompletenessNote;
}

/** What the user typed. Never a fact, never an inference, never stored as either. */
export interface UserAssumptions {
  kind: "USER_ASSUMPTION";
  low: number;
  base: number;
  high: number;
}

/** Arithmetic over the two above, and nothing else. */
export interface ImpliedEquityValue {
  kind: "CALCULATION";
  low: number;
  base: number;
  high: number;
  unit: string;
  /** Written out so the page cannot describe the arithmetic differently from the code. */
  formula: string;
}

export interface ValuationScenario {
  method: ValuationMethod;
  status: ValuationStatus;
  unverifiableBecause?: UnverifiableReason;
  assumptionsRefusedBecause?: AssumptionsRefusedReason;
  fact?: SourcedFact;
  assumptions?: UserAssumptions;
  impliedEquityValue?: ImpliedEquityValue;
  /** Required and non-optional, the same discipline `historicalAnalog` uses for its disclaimer. */
  limitations: string;
}

export interface ValuationScenarioSet {
  pe: ValuationScenario;
  ps: ValuationScenario;
}

/**
 * The required disclaimer. Deliberately written WITHOUT any word from
 * `FORBIDDEN_VALUATION_VOCABULARY`, including in the negative: the control below scans the whole
 * serialized result, and a disclaimer that says "this is not a per-share figure" would trip its
 * own guard. Saying what the number IS turns out to be shorter than listing what it is not.
 */
export const VALUATION_LIMITATIONS =
  "Arithmetic, not an opinion. The multiple is yours — Market OS has no view on whether it is " +
  "reasonable and will not supply one. The only sourced number here is the reported figure named " +
  "beside it, and the result is a total implied equity value for the whole company under your " +
  "own assumption about a multiple. It says nothing about what the company is worth.";

export interface MultipleInput {
  low: number;
  base: number;
  high: number;
}

export interface ValuationScenarioInput {
  figures: ReportedFigure[];
  sourceCode: string;
  completeness: CompletenessNote;
  peMultiples?: MultipleInput;
  psMultiples?: MultipleInput;
}

/**
 * A unit this repository is willing to multiply by a bare multiple.
 *
 * `USD` yes. `USD/shares` no — that is a per-share amount, and a P/E multiple applied to it
 * produces a share price, which V1 explicitly does not publish. `shares` and `pure` no, for the
 * obvious reason. The check is on shape rather than on an allowlist of currency codes, because a
 * new currency arriving should not silently become unusable, while a new RATIO unit arriving
 * must not silently become usable.
 */
function isCurrencyAmountUnit(unit: string): boolean {
  const u = unit.trim();
  if (u.length === 0) return false;
  if (u.includes("/")) return false;
  return /^[A-Za-z]{3}$/.test(u);
}

/**
 * Completeness states that make a stored figure unsafe to build on.
 *
 * `KNOWN_INCOMPLETE` and `LAST_RUN_FAILED` are refusals: the repository has positive evidence that
 * what it holds for this company is partial or that the last attempt to fill it failed, and a
 * figure selected as "latest" out of a knowably truncated history may not be the latest.
 *
 * `UNKNOWN` and `UNCONFIRMED` are NOT refusals, and that is a deliberate line rather than an
 * oversight. Both are statements about the ingest HISTORY, not about the fact: the figure still
 * carries its own accession, form, period and filed date, which is its provenance. Refusing on
 * `UNKNOWN` would disable the surface on every installation whose runs table predates the fact —
 * a feature dead on arrival for a reason that says nothing about the number. The state is
 * displayed verbatim beside every result instead, which is what the completeness note is for.
 */
function completenessBlocks(note: CompletenessNote): boolean {
  return note.status === "KNOWN_INCOMPLETE" || note.status === "LAST_RUN_FAILED";
}

function hasProvenance(figure: ReportedFigure, sourceCode: string): boolean {
  return (
    figure.accessionNumber.trim().length > 0 &&
    figure.form.trim().length > 0 &&
    sourceCode.trim().length > 0
  );
}

/**
 * Ordering over annual candidates: newest period first, then the tag order the ingest declares.
 *
 * The tag tiebreak only ever runs between two DIFFERENT revenue tags reporting the same annual
 * period, and only after `selectAnnualFact` has established their values agree — where they
 * disagree the answer is a refusal, not a preference. So this decides which NAME to show for a
 * number both tags report identically, which is presentation, not interpretation.
 */
function compareAnnualCandidates(a: ReportedFigure, b: ReportedFigure): number {
  if (a.periodEnd !== b.periodEnd) return a.periodEnd < b.periodEnd ? 1 : -1;
  const ai = (REVENUE_CONCEPTS as readonly string[]).indexOf(a.concept);
  const bi = (REVENUE_CONCEPTS as readonly string[]).indexOf(b.concept);
  if (ai !== bi) return ai - bi;
  return a.concept < b.concept ? -1 : a.concept > b.concept ? 1 : 0;
}

type Selection = { ok: true; figure: ReportedFigure } | { ok: false; because: UnverifiableReason };

/**
 * The one explicit selection rule, shared by both methods.
 *
 * `figures` is already `computeCompanyXray`'s `latestFigures` — one entry per
 * (concept, unit, period length), each the most current of its group under the shared
 * `compareFactCurrency`. This narrows that to what a multiple may legitimately be applied to, and
 * refuses rather than reaching for a near-enough substitute at every step.
 */
function selectAnnualFact(
  figures: ReportedFigure[],
  concepts: readonly string[],
  sourceCode: string,
  completeness: CompletenessNote,
): Selection {
  const named = figures.filter((f) => concepts.includes(f.concept));
  if (named.length === 0) return { ok: false, because: "NO_FACT_FOR_CONCEPT" };

  const annual = named.filter((f) => f.periodMonths === REQUIRED_PERIOD_MONTHS);
  if (annual.length === 0) return { ok: false, because: "NO_ANNUAL_PERIOD" };

  const finite = annual.filter((f) => Number.isFinite(f.value));
  if (finite.length === 0) return { ok: false, because: "VALUE_NOT_FINITE" };

  const positive = finite.filter((f) => f.value > 0);
  if (positive.length === 0) return { ok: false, because: "VALUE_NOT_POSITIVE" };

  const usableUnit = positive.filter((f) => isCurrencyAmountUnit(f.unit));
  if (usableUnit.length === 0) return { ok: false, because: "UNIT_NOT_A_CURRENCY_AMOUNT" };

  const sourced = usableUnit.filter((f) => hasProvenance(f, sourceCode));
  if (sourced.length === 0) return { ok: false, because: "PROVENANCE_INCOMPLETE" };

  if (completenessBlocks(completeness)) return { ok: false, because: "COMPLETENESS_UNSAFE" };

  const ranked = [...sourced].sort(compareAnnualCandidates);
  const chosen = ranked[0];

  // AMBIGUITY, checked rather than assumed away. Two entries survive to the same annual period
  // when the same figure is filed in two currencies, or when two revenue tags both cover the
  // transition year. If they disagree about the amount there is no way to pick one that is not a
  // guess about which basis the reader meant, and a guess here silently changes the answer by
  // whatever the two figures differ by. Equal values are not ambiguous — the number is the same
  // however it is labelled — so only a real disagreement refuses.
  const rivals = ranked.filter(
    (f) => f.periodEnd === chosen.periodEnd && (f.value !== chosen.value || f.unit !== chosen.unit),
  );
  if (rivals.length > 0) return { ok: false, because: "FACT_IDENTITY_AMBIGUOUS" };

  return { ok: true, figure: chosen };
}

/**
 * Multiples the user typed, checked before anything is multiplied by them.
 *
 * Refusal here is a DIFFERENT status from an unusable fact, deliberately: "you typed the range
 * backwards" and "this company has no annual earnings on file" are not the same problem, and a
 * single status would let the user read one as the other.
 */
function checkAssumptions(m: MultipleInput): AssumptionsRefusedReason | null {
  const all = [m.low, m.base, m.high];
  if (!all.every((v) => Number.isFinite(v))) return "MULTIPLE_NOT_FINITE";
  if (all.some((v) => v < 0)) return "MULTIPLE_NEGATIVE";
  if (!(m.low <= m.base && m.base <= m.high)) return "RANGE_NOT_ASCENDING";
  return null;
}

function toSourcedFact(
  figure: ReportedFigure,
  sourceCode: string,
  completeness: CompletenessNote,
): SourcedFact {
  return {
    kind: "FACT",
    concept: figure.concept,
    unit: figure.unit,
    value: figure.value,
    periodStart: figure.periodStart,
    periodEnd: figure.periodEnd,
    periodMonths: figure.periodMonths,
    fiscalPeriod: figure.fiscalPeriod,
    fiscalYear: figure.fiscalYear,
    form: figure.form,
    accessionNumber: figure.accessionNumber,
    sourceCode,
    completeness,
  };
}

function scenario(
  method: ValuationMethod,
  input: ValuationScenarioInput,
  concepts: readonly string[],
  multiples: MultipleInput | undefined,
): ValuationScenario {
  const base = { method, limitations: VALUATION_LIMITATIONS } as const;

  // The FACT side is settled first and independently of what the user typed, so a company with no
  // usable annual figure reports that even when the multiples are also wrong. The alternative
  // would let a typo mask a data gap.
  const selection = selectAnnualFact(input.figures, concepts, input.sourceCode, input.completeness);
  if (!selection.ok) {
    return { ...base, status: "UNVERIFIABLE", unverifiableBecause: selection.because };
  }

  const fact = toSourcedFact(selection.figure, input.sourceCode, input.completeness);

  // No multiples supplied is not a refusal and not an error: it is the initial state of a form
  // nobody has filled in. The fact is shown, the calculation is absent, and the decision's "V1
  // defaults must be blank unless there is an authoritative stored source for the assumption"
  // means there is nothing to prefill it with.
  if (!multiples) {
    return { ...base, status: "AWAITING_ASSUMPTIONS", fact };
  }

  const refused = checkAssumptions(multiples);
  if (refused) {
    return { ...base, status: "ASSUMPTIONS_REFUSED", assumptionsRefusedBecause: refused, fact };
  }

  const assumptions: UserAssumptions = {
    kind: "USER_ASSUMPTION",
    low: multiples.low,
    base: multiples.base,
    high: multiples.high,
  };

  // Monotonicity is a theorem here rather than a hope: the fact's value is positive by
  // construction above and the multiples ascend by construction here, so low <= base <= high
  // survives the multiplication. Control A asserts it anyway, because a theorem nobody checks is
  // a comment.
  const impliedEquityValue: ImpliedEquityValue = {
    kind: "CALCULATION",
    low: fact.value * assumptions.low,
    base: fact.value * assumptions.base,
    high: fact.value * assumptions.high,
    unit: fact.unit,
    formula: `${fact.concept} (${fact.periodStart ?? "?"} → ${fact.periodEnd}) × multiple`,
  };

  return { ...base, status: "COMPUTED", fact, assumptions, impliedEquityValue };
}

/**
 * Both scenarios for one company. Each stands alone: a company with revenue but no positive
 * annual earnings gets a P/S range and an explicit P/E refusal, which is the honest pair.
 */
export function computeValuationScenarios(input: ValuationScenarioInput): ValuationScenarioSet {
  return {
    pe: scenario("PE_SCENARIO", input, [EARNINGS_CONCEPT], input.peMultiples),
    ps: scenario("PS_SCENARIO", input, REVENUE_CONCEPTS, input.psMultiples),
  };
}

/**
 * Vocabulary this surface may never emit, and the reason it is a constant rather than a habit.
 *
 * `docs/LEGAL_GUARDRAILS.md` forbids recommendations, definitive price predictions and
 * single-number verdicts, and the valuation decision names the specific words. A control walks
 * the serialized result against this list, so the prohibition is enforced by a test rather than
 * by everyone remembering it — the same reason `screenPublicComment` exists for outbound text.
 */
export const FORBIDDEN_VALUATION_VOCABULARY = [
  "target price",
  "price target",
  "fair price",
  "fair value",
  "buy",
  "sell",
  "hold",
  "undervalued",
  "overvalued",
  "expected return",
  "upside",
  "downside",
  "recommend",
  "rating",
  "per share",
  "per-share",
] as const;
