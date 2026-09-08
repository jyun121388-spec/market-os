import { describe, expect, it } from "vitest";
import type { CompletenessNote, ReportedFigure } from "@/server/domain/companyXray";
import {
  computeValuationScenarios,
  EARNINGS_CONCEPT,
  FORBIDDEN_VALUATION_VOCABULARY,
  REVENUE_CONCEPTS,
  VALUATION_LIMITATIONS,
  type ValuationScenario,
  type ValuationScenarioInput,
} from "@/server/domain/valuationScenario";

/**
 * `[CHATGPT_DECISION][MARKET-V1-VALUATION-SURFACE-20260908]`, controls A-N.
 *
 * These run against the pure boundary rather than a database, and that is the point of the
 * boundary: `computeValuationScenarios` takes `computeCompanyXray`'s own `latestFigures` and
 * cannot reach a second fact authority even if someone later wanted it to. The DB-backed proof
 * that the real page feeds it real facts lives in
 * `tests/integration/company-valuation-surface.test.ts`.
 *
 * Every fixture below is shaped like something the ingest actually stores: an annual figure with
 * a twelve-month bucket, a literal us-gaap tag, a currency unit, a form and an accession.
 */

const COMPLETE: CompletenessNote = {
  status: "COMPLETE",
  detail: "Last run reported no shortfall.",
};

function figure(
  over: Partial<ReportedFigure> & { concept: string; value: number },
): ReportedFigure {
  return {
    unit: "USD",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    periodMonths: 12,
    fiscalPeriod: "FY",
    fiscalYear: 2025,
    form: "10-K",
    accessionNumber: "0000320193-26-000001",
    ...over,
  };
}

const earnings = (value: number, over: Partial<ReportedFigure> = {}) =>
  figure({ concept: EARNINGS_CONCEPT, value, ...over });

const revenue = (value: number, over: Partial<ReportedFigure> = {}) =>
  figure({ concept: "RevenueFromContractWithCustomerExcludingAssessedTax", value, ...over });

function input(over: Partial<ValuationScenarioInput> = {}): ValuationScenarioInput {
  return {
    figures: [earnings(100), revenue(400)],
    sourceCode: "EDGAR_XBRL",
    completeness: COMPLETE,
    ...over,
  };
}

/** Every string anywhere in a result, so a control can look at all of it at once. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allStrings(v, out);
    }
  return out;
}

describe("bounded scenario valuation", () => {
  // ---------------------------------------------------------------- A
  it("A: positive sourced earnings and ascending P/E assumptions give a deterministic monotonic range", () => {
    const { pe } = computeValuationScenarios(
      input({ peMultiples: { low: 10, base: 15, high: 20 } }),
    );

    expect(pe.status).toBe("COMPUTED");
    expect(pe.method).toBe("PE_SCENARIO");
    expect(pe.fact?.value).toBe(100);
    expect(pe.impliedEquityValue).toMatchObject({
      kind: "CALCULATION",
      low: 1000,
      base: 1500,
      high: 2000,
      unit: "USD",
    });
    // Monotonic, and asserted rather than reasoned about.
    const { low, base, high } = pe.impliedEquityValue!;
    expect(low).toBeLessThanOrEqual(base);
    expect(base).toBeLessThanOrEqual(high);

    // Deterministic: the same input twice is the same output, with no clock or ordering in it.
    const again = computeValuationScenarios(
      input({ peMultiples: { low: 10, base: 15, high: 20 } }),
    );
    expect(again.pe).toEqual(pe);
  });

  // ---------------------------------------------------------------- B / C
  it("B: zero earnings make the P/E method UNVERIFIABLE rather than worth nothing", () => {
    const { pe } = computeValuationScenarios(
      input({ figures: [earnings(0), revenue(400)], peMultiples: { low: 10, base: 15, high: 20 } }),
    );
    expect(pe.status).toBe("UNVERIFIABLE");
    expect(pe.unverifiableBecause).toBe("VALUE_NOT_POSITIVE");
    expect(pe.impliedEquityValue).toBeUndefined();
    // Zero times any multiple is zero, and publishing "implied equity value: 0" would be a
    // confident statement rather than an absence. The refusal is the honest output.
  });

  it("C: negative earnings make the P/E method UNVERIFIABLE, and the P/S method is unaffected", () => {
    const { pe, ps } = computeValuationScenarios(
      input({
        figures: [earnings(-250), revenue(400)],
        peMultiples: { low: 10, base: 15, high: 20 },
        psMultiples: { low: 1, base: 2, high: 3 },
      }),
    );
    expect(pe.status).toBe("UNVERIFIABLE");
    expect(pe.unverifiableBecause).toBe("VALUE_NOT_POSITIVE");
    // A loss-making company still has revenue, and refusing both would be refusing more than the
    // evidence requires. The pair is the honest answer.
    expect(ps.status).toBe("COMPUTED");
    expect(ps.impliedEquityValue?.base).toBe(800);
  });

  // ---------------------------------------------------------------- D
  it("D: sourced revenue and ascending P/S assumptions give a deterministic monotonic range", () => {
    const { ps } = computeValuationScenarios(
      input({ psMultiples: { low: 1.5, base: 2, high: 4 } }),
    );
    expect(ps.status).toBe("COMPUTED");
    expect(ps.method).toBe("PS_SCENARIO");
    expect(ps.impliedEquityValue).toMatchObject({ low: 600, base: 800, high: 1600 });
    expect(ps.impliedEquityValue!.low).toBeLessThanOrEqual(ps.impliedEquityValue!.base);
    expect(ps.impliedEquityValue!.base).toBeLessThanOrEqual(ps.impliedEquityValue!.high);
  });

  // ---------------------------------------------------------------- E
  it("E: a malformed, negative or non-finite multiple is refused, and refused AS an assumption problem", () => {
    const cases: [string, number[], string][] = [
      ["NaN", [Number.NaN, 15, 20], "MULTIPLE_NOT_FINITE"],
      ["Infinity", [10, 15, Number.POSITIVE_INFINITY], "MULTIPLE_NOT_FINITE"],
      ["-Infinity", [Number.NEGATIVE_INFINITY, 15, 20], "MULTIPLE_NOT_FINITE"],
      ["negative", [-1, 15, 20], "MULTIPLE_NEGATIVE"],
    ];
    for (const [label, [low, base, high], because] of cases) {
      const { pe } = computeValuationScenarios(input({ peMultiples: { low, base, high } }));
      expect(pe.status, label).toBe("ASSUMPTIONS_REFUSED");
      expect(pe.assumptionsRefusedBecause, label).toBe(because);
      expect(pe.impliedEquityValue, label).toBeUndefined();
      // The FACT still stands — the data was fine, the typing was not, and the page must be able
      // to say which. Collapsing both into one status is what hides a data gap behind a typo.
      expect(pe.fact?.value, label).toBe(100);
    }
  });

  // ---------------------------------------------------------------- F
  it("F: an inverted range is refused in both directions", () => {
    for (const m of [
      { low: 20, base: 15, high: 25 }, // low > base
      { low: 10, base: 30, high: 25 }, // base > high
    ]) {
      const { pe } = computeValuationScenarios(input({ peMultiples: m }));
      expect(pe.status).toBe("ASSUMPTIONS_REFUSED");
      expect(pe.assumptionsRefusedBecause).toBe("RANGE_NOT_ASCENDING");
      expect(pe.impliedEquityValue).toBeUndefined();
    }
    // Equal is not inverted: a reader who wants a single scenario types the same number three
    // times, and refusing that would be refusing a legitimate use.
    const flat = computeValuationScenarios(input({ peMultiples: { low: 12, base: 12, high: 12 } }));
    expect(flat.pe.status).toBe("COMPUTED");
    expect(flat.pe.impliedEquityValue).toMatchObject({ low: 1200, base: 1200, high: 1200 });
  });

  // ---------------------------------------------------------------- G
  it("G: a figure with no filing identity produces no number", () => {
    for (const missing of [{ accessionNumber: "  " }, { form: "" }]) {
      const { pe } = computeValuationScenarios(
        input({
          figures: [earnings(100, missing)],
          peMultiples: { low: 10, base: 15, high: 20 },
        }),
      );
      expect(pe.status).toBe("UNVERIFIABLE");
      expect(pe.unverifiableBecause).toBe("PROVENANCE_INCOMPLETE");
      expect(pe.impliedEquityValue).toBeUndefined();
      expect(pe.fact).toBeUndefined();
    }
    // And the same when the provider itself is unnamed: a number with no source is not a fact.
    const noSource = computeValuationScenarios(
      input({ sourceCode: "", peMultiples: { low: 10, base: 15, high: 20 } }),
    );
    expect(noSource.pe.unverifiableBecause).toBe("PROVENANCE_INCOMPLETE");
  });

  // ---------------------------------------------------------------- H
  it("H: a quarterly figure is not an annual one, and no quarter stands in for a year", () => {
    const { pe } = computeValuationScenarios(
      input({
        figures: [
          earnings(30, { periodMonths: 3, periodStart: "2025-10-01", fiscalPeriod: "Q4" }),
          revenue(400),
        ],
        peMultiples: { low: 10, base: 15, high: 20 },
      }),
    );
    expect(pe.status).toBe("UNVERIFIABLE");
    expect(pe.unverifiableBecause).toBe("NO_ANNUAL_PERIOD");
    // 30 x 15 = 450 is a real number and a wrong one, roughly a quarter of the answer. Silently
    // multiplying a quarter by an annual multiple is the same class of error as the nine-month
    // versus quarter identity defect in FinancialFact.
    expect(pe.impliedEquityValue).toBeUndefined();

    // An instant concept has no span at all and is equally unusable.
    const instant = computeValuationScenarios(
      input({
        figures: [earnings(100, { periodMonths: null, periodStart: null })],
        peMultiples: { low: 10, base: 15, high: 20 },
      }),
    );
    expect(instant.pe.unverifiableBecause).toBe("NO_ANNUAL_PERIOD");
  });

  // ---------------------------------------------------------------- I
  it("I: a unit that is not a plain currency amount produces no number", () => {
    for (const unit of ["USD/shares", "shares", "pure", ""]) {
      const { pe } = computeValuationScenarios(
        input({
          figures: [earnings(100, { unit })],
          peMultiples: { low: 10, base: 15, high: 20 },
        }),
      );
      expect(pe.status, unit).toBe("UNVERIFIABLE");
      expect(pe.unverifiableBecause, unit).toBe("UNIT_NOT_A_CURRENCY_AMOUNT");
    }
    // A currency that is not USD is fine — the check is on shape, so a new currency does not
    // silently become unusable while a new RATIO unit does not silently become usable.
    const krw = computeValuationScenarios(
      input({
        figures: [earnings(100, { unit: "KRW" })],
        peMultiples: { low: 10, base: 15, high: 20 },
      }),
    );
    expect(krw.pe.status).toBe("COMPUTED");
    expect(krw.pe.impliedEquityValue?.unit).toBe("KRW");
  });

  it("I2: two incompatible figures for the same annual period refuse rather than pick one", () => {
    const { pe } = computeValuationScenarios(
      input({
        figures: [earnings(100, { unit: "USD" }), earnings(130000, { unit: "KRW" })],
        peMultiples: { low: 10, base: 15, high: 20 },
      }),
    );
    expect(pe.status).toBe("UNVERIFIABLE");
    expect(pe.unverifiableBecause).toBe("FACT_IDENTITY_AMBIGUOUS");
  });

  // ---------------------------------------------------------------- J
  it("J: the original revenue tag survives into the output, and tags are never merged", () => {
    for (const concept of REVENUE_CONCEPTS) {
      const { ps } = computeValuationScenarios(
        input({
          figures: [figure({ concept, value: 400 })],
          psMultiples: { low: 1, base: 2, high: 3 },
        }),
      );
      expect(ps.status, concept).toBe("COMPUTED");
      expect(ps.fact?.concept, "the exact stored tag, not a unified label").toBe(concept);
      expect(ps.impliedEquityValue?.formula).toContain(concept);
    }
  });

  it("J2: two revenue tags disagreeing about the same year refuse rather than choosing a basis", () => {
    const { ps } = computeValuationScenarios(
      input({
        figures: [
          figure({ concept: "SalesRevenueNet", value: 380 }),
          figure({ concept: "Revenues", value: 400 }),
        ],
        psMultiples: { low: 1, base: 2, high: 3 },
      }),
    );
    expect(ps.status).toBe("UNVERIFIABLE");
    expect(ps.unverifiableBecause).toBe("FACT_IDENTITY_AMBIGUOUS");
  });

  it("J3: an older tag is not preferred over a newer period — recency decides, then the tag", () => {
    const { ps } = computeValuationScenarios(
      input({
        figures: [
          figure({ concept: "Revenues", value: 300, periodEnd: "2023-12-31", fiscalYear: 2023 }),
          figure({ concept: "SalesRevenueNet", value: 400 }),
        ],
        psMultiples: { low: 1, base: 2, high: 3 },
      }),
    );
    expect(ps.status).toBe("COMPUTED");
    expect(ps.fact?.concept).toBe("SalesRevenueNet");
    expect(ps.fact?.periodEnd).toBe("2025-12-31");
  });

  // ---------------------------------------------------------------- K
  it("K: a user assumption is never shaped like a sourced fact", () => {
    const { pe } = computeValuationScenarios(
      input({ peMultiples: { low: 10, base: 15, high: 20 } }),
    );
    expect(pe.fact?.kind).toBe("FACT");
    expect(pe.assumptions?.kind).toBe("USER_ASSUMPTION");
    expect(pe.impliedEquityValue?.kind).toBe("CALCULATION");

    // The three are disjoint, and the multiple carries none of the provenance a fact must have.
    const assumption = pe.assumptions as unknown as Record<string, unknown>;
    for (const provenanceField of ["accessionNumber", "sourceCode", "form", "periodEnd", "unit"]) {
      expect(assumption[provenanceField], provenanceField).toBeUndefined();
    }
    // And the fact's value is the reported one, never the user's number.
    expect(pe.fact?.value).toBe(100);
    expect(pe.fact?.value).not.toBe(pe.assumptions?.base);
  });

  // ---------------------------------------------------------------- L
  it("L: every non-COMPUTED status carries no numbers at all", () => {
    const refusals: ValuationScenario[] = [
      computeValuationScenarios(input({ figures: [], peMultiples: { low: 1, base: 1, high: 1 } }))
        .pe,
      computeValuationScenarios(input({})).pe, // no multiples typed yet
      computeValuationScenarios(input({ peMultiples: { low: 5, base: 1, high: 9 } })).pe,
      computeValuationScenarios(
        input({
          completeness: { status: "KNOWN_INCOMPLETE", detail: "Ingest reported a shortfall." },
          peMultiples: { low: 1, base: 1, high: 1 },
        }),
      ).pe,
      computeValuationScenarios(
        input({
          completeness: { status: "LAST_RUN_FAILED", detail: "Last ingest run failed." },
          peMultiples: { low: 1, base: 1, high: 1 },
        }),
      ).pe,
    ];
    for (const r of refusals) {
      expect(r.status, JSON.stringify(r.status)).not.toBe("COMPUTED");
      expect(r.impliedEquityValue, r.status).toBeUndefined();
      expect(r.limitations.length).toBeGreaterThan(0);
    }
    // The two completeness refusals name the completeness, not something vaguer.
    expect(refusals[3].unverifiableBecause).toBe("COMPLETENESS_UNSAFE");
    expect(refusals[4].unverifiableBecause).toBe("COMPLETENESS_UNSAFE");
    // And the untouched-form state is its own thing, not a data refusal.
    expect(refusals[1].status).toBe("AWAITING_ASSUMPTIONS");
    expect(refusals[1].fact?.kind).toBe("FACT");
  });

  it("L2: an unknown or unconfirmed ingest history still computes, and says so", () => {
    // The line drawn deliberately in `completenessBlocks`. Both are statements about the ingest
    // HISTORY, not about this fact, which carries its own accession and period. Refusing on
    // UNKNOWN would disable the surface on every install whose runs table predates its facts.
    for (const status of ["UNKNOWN", "UNCONFIRMED"] as const) {
      const note: CompletenessNote = { status, detail: `history is ${status}` };
      const { pe } = computeValuationScenarios(
        input({ completeness: note, peMultiples: { low: 10, base: 15, high: 20 } }),
      );
      expect(pe.status, status).toBe("COMPUTED");
      // ...and the state travels with the result so the page cannot omit it.
      expect(pe.fact?.completeness.status, status).toBe(status);
    }
  });

  // ---------------------------------------------------------------- M
  it("M: no result anywhere carries recommendation or target-price vocabulary", () => {
    const results = [
      computeValuationScenarios(
        input({
          peMultiples: { low: 10, base: 15, high: 20 },
          psMultiples: { low: 1, base: 2, high: 3 },
        }),
      ),
      computeValuationScenarios(input({ figures: [], peMultiples: { low: 1, base: 1, high: 1 } })),
      computeValuationScenarios(input({ peMultiples: { low: 9, base: 1, high: 2 } })),
    ];
    for (const set of results) {
      const haystack = allStrings(set).join(" \n ").toLowerCase();
      for (const banned of FORBIDDEN_VALUATION_VOCABULARY) {
        const pattern = new RegExp(`\\b${banned.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`);
        expect(pattern.test(haystack), `"${banned}" must not appear in a valuation result`).toBe(
          false,
        );
      }
    }
    // The disclaimer is part of what was scanned, so it cannot quietly reintroduce the vocabulary
    // by denying it either.
    expect(VALUATION_LIMITATIONS.toLowerCase()).not.toContain("per-share");
    expect(VALUATION_LIMITATIONS.length).toBeGreaterThan(0);
  });

  it("M2: the output contract has no per-share, price or verdict field", () => {
    const { pe } = computeValuationScenarios(
      input({ peMultiples: { low: 10, base: 15, high: 20 } }),
    );
    const keys = allStrings(pe).map((k) => k.toLowerCase());
    for (const banned of [
      "pricepershare",
      "sharesoutstanding",
      "verdict",
      "score",
      "targetprice",
    ]) {
      expect(keys).not.toContain(banned);
    }
  });
});
