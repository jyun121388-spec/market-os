import { describe, expect, it } from "vitest";
import {
  quantitativeSpans,
  verifyInferenceClaim,
  type PremiseVerification,
} from "@/server/domain/inferenceClaim";
import { parseQuantity } from "@/server/domain/quantitativeCitation";
import {
  calculationAtoms,
  factAtoms,
  type QuantitativeAtom,
} from "@/server/domain/quantitativeEvidence";

/**
 * The negative controls for IR-094, one per reproduced defect.
 *
 * Every probe in the reproduction matrix was ACCEPTED by the first implementation. Each is a test
 * here, phrased as the thing that must now be refused, so the repair cannot silently regress into
 * token comparison again.
 */

const SERIES = "series-a";
const OTHER_SERIES = "series-b";

const atom = (over: Partial<QuantitativeAtom> = {}): QuantitativeAtom => ({
  premiseClaimId: "p1",
  kind: "OBSERVATION_VALUE",
  canonicalValue: 2.1,
  unit: "percent",
  subjectId: SERIES,
  ...over,
});

const premise = (atoms: QuantitativeAtom[], status = "VERIFIED", claimId = "p1") =>
  ({ claimId, status, atoms }) satisfies PremiseVerification;

const cite = (surfaceText: string, kind = "OBSERVATION_VALUE", premiseClaimId = "p1") => ({
  premiseClaimId,
  kind,
  surfaceText,
});

const verify = (
  claimText: string,
  atoms: QuantitativeAtom[],
  citations: ReturnType<typeof cite>[],
  over: Partial<Parameters<typeof verifyInferenceClaim>[0]> = {},
) =>
  verifyInferenceClaim({
    claimText,
    confidence: 0.5,
    premises: [premise(atoms)],
    citations,
    ...over,
  });

describe("A — sign is part of the quantity", () => {
  it("refuses a positive assertion backed by a negative measurement", () => {
    const result = verify(
      "growth was 2.1 percent",
      [atom({ canonicalValue: -2.1 })],
      [cite("2.1 percent")],
    );
    expect(result.status).toBe("CITATION_UNSUPPORTED");
    expect(result.failedCitations[0].verdict).toBe("SIGN_MISMATCH");
  });

  it("refuses a negative assertion backed by a positive measurement", () => {
    const result = verify(
      "growth was -2.1 percent",
      [atom({ canonicalValue: 2.1 })],
      [cite("-2.1 percent")],
    );
    expect(result.failedCitations[0].verdict).toBe("SIGN_MISMATCH");
  });

  it("accepts a negative assertion backed by the same negative measurement", () => {
    expect(
      verify("growth was -2.1 percent", [atom({ canonicalValue: -2.1 })], [cite("-2.1 percent")])
        .status,
    ).toBe("VERIFIED");
  });
});

describe("B — unit and currency", () => {
  it.each([
    ["percent evidence, USD text", "the spread was 2.1 USD", "percent"],
    ["percent evidence, bps text", "the change was 2.1 bps", "percent"],
    ["USD evidence, KRW text", "the price was 2.1 KRW", "USD"],
    ["index points evidence, percent text", "the move was 2.1 percent", "index points"],
  ])("refuses %s", (_label, claimText, unit) => {
    const surface = claimText.slice(claimText.indexOf("2.1"));
    const result = verify(claimText, [atom({ unit })], [cite(surface)]);
    expect(result.failedCitations[0].verdict).toBe("UNIT_MISMATCH");
  });

  it("refuses a bare number where the evidence has a unit", () => {
    // "Revenue was 1,400" states a quantity whose unit the sentence never gave. Guessing it is the
    // mistake being repaired, so an unparseable surface is refused rather than assumed.
    const result = verify(
      "Revenue was 1,400",
      [atom({ canonicalValue: 1400, unit: "USD" })],
      [cite("1,400")],
    );
    expect(result.failedCitations[0].verdict).toBe("UNPARSEABLE_SURFACE");
  });

  it("reads a currency symbol as the unit", () => {
    expect(parseQuantity("$1,400")).toEqual({ sign: 1, magnitude: 1400, unit: "USD" });
    expect(parseQuantity("₩1,400")).toEqual({ sign: 1, magnitude: 1400, unit: "KRW" });
  });

  it("refuses a surface with no number, or with two", () => {
    expect(parseQuantity("several percent")).toBe("UNPARSEABLE");
    expect(parseQuantity("2.1 to 3.4 percent")).toBe("UNPARSEABLE");
  });
});

describe("C — a number does not launder across subjects or premises", () => {
  it("refuses a citation pointing at a premise that establishes no such quantity", () => {
    // The laundering shape: the value exists in the evidence set, under a different premise.
    const result = verifyInferenceClaim({
      claimText: "Unemployment slowed to 2.1 percent",
      confidence: 0.5,
      premises: [
        premise([atom({ premiseClaimId: "p2", subjectId: OTHER_SERIES })], "VERIFIED", "p2"),
      ],
      citations: [cite("2.1 percent", "OBSERVATION_VALUE", "p1")],
    });
    expect(result.failedCitations[0].verdict).toBe("ATOM_NOT_FOUND");
  });

  it("refuses a citation naming a kind the premise does not establish", () => {
    const result = verify(
      "the change was 2.1 percent",
      [atom({ kind: "OBSERVATION_VALUE" })],
      [cite("2.1 percent", "PERCENT_CHANGE")],
    );
    expect(result.failedCitations[0].verdict).toBe("ATOM_NOT_FOUND");
  });

  it("refuses a bare year reused as a financial value", () => {
    // "observed on 2026-08-14" contributed 2026, 08 and 14 to the old supported set, which is how
    // "Revenue reached 2026" was authorised. Dates are not atoms and a bare year needs a citation.
    const result = verify("Revenue reached 2026", [atom({ canonicalValue: 2026 })], []);
    expect(result.status).toBe("UNCITED_QUANTITY");
    expect(result.uncitedQuantities).toContain("2026");
  });

  it("does not require a citation for a full ISO date", () => {
    // A date is not a financial quantity, and requiring one would make every claim uncitable.
    expect(quantitativeSpans("as of 2026-03-01 the reading held")).toEqual([]);
  });
});

describe("coverage — an uncited number is an invented one", () => {
  it("refuses prose carrying a quantity no citation covers", () => {
    const result = verify(
      "growth was 2.1 percent and margin reached 31 percent",
      [atom()],
      [cite("2.1 percent")],
    );
    expect(result.status).toBe("UNCITED_QUANTITY");
    expect(result.uncitedQuantities).toContain("31");
  });

  it("accepts prose whose every quantity is cited and matches", () => {
    const result = verify(
      "growth was 2.1 percent and the change was -0.4 percent",
      [atom(), atom({ kind: "PERCENT_CHANGE", canonicalValue: -0.4 })],
      [cite("2.1 percent"), cite("-0.4 percent", "PERCENT_CHANGE")],
    );
    expect(result.status).toBe("VERIFIED");
  });

  it("refuses a citation quoting words the claim does not contain", () => {
    const result = verify("growth was 2.1 percent", [atom()], [cite("9.9 percent")]);
    expect(result.failedCitations[0].verdict).toBe("SURFACE_TEXT_NOT_IN_CLAIM");
  });

  it("accepts prose with no quantities at all", () => {
    expect(verify("Export demand appears to be the binding constraint.", [atom()], []).status).toBe(
      "VERIFIED",
    );
  });
});

describe("D — malformed evidence fails closed", () => {
  it("refuses rather than repairing", () => {
    const result = verifyInferenceClaim({
      claimText: "x",
      confidence: 0.5,
      premises: [premise([atom()])],
      citations: [],
      evidenceMalformed: "premiseClaimIds[1] is 123, not a non-empty string",
    });
    expect(result.status).toBe("MALFORMED_EVIDENCE");
    expect(result.detail).toContain("Refused rather than repaired");
  });
});

describe("E — confidence", () => {
  it("refuses NaN, which passes both halves of a range comparison", () => {
    const result = verify("x", [atom()], [], { confidence: NaN });
    expect(result.status).toBe("CONFIDENCE_NOT_A_NUMBER");
  });

  it.each([undefined, null])("refuses %s", (confidence) => {
    expect(verify("x", [atom()], [], { confidence }).status).toBe("CONFIDENCE_MISSING");
  });

  it.each([-0.1, 1.1, Infinity, -Infinity])("refuses %s", (confidence) => {
    expect(verify("x", [atom()], [], { confidence }).status).toBe("CONFIDENCE_OUT_OF_RANGE");
  });
});

describe("premise hygiene", () => {
  it("refuses an inference with no premises", () => {
    expect(
      verifyInferenceClaim({ claimText: "x", confidence: 0.5, premises: [], citations: [] }).status,
    ).toBe("NO_PREMISES");
  });

  it.each(["EVIDENCE_MISSING", "EVIDENCE_NOT_FOUND", "VALUE_MISMATCH", "UNSUPPORTED_CLAIM_TYPE"])(
    "refuses when a premise is %s",
    (status) => {
      expect(
        verifyInferenceClaim({
          claimText: "x",
          confidence: 0.5,
          premises: [premise([], status)],
          citations: [],
        }).status,
      ).toBe("PREMISE_NOT_VERIFIED");
    },
  );
});

describe("atoms come from evidence rows, never from prose", () => {
  it("derives one signed, united atom from a FACT premise", () => {
    const atoms = factAtoms(
      { id: "p1", claimType: "FACT", evidence: {} },
      {
        observation: { id: "o1", seriesId: SERIES, value: { toString: () => "-2.1" } },
        seriesUnit: "percent",
      },
    );
    expect(atoms).toEqual([
      {
        premiseClaimId: "p1",
        kind: "OBSERVATION_VALUE",
        canonicalValue: -2.1,
        unit: "percent",
        subjectId: SERIES,
      },
    ]);
  });

  it("derives three atoms from a CALCULATION premise, each with its own unit", () => {
    const atoms = calculationAtoms(
      {
        id: "p1",
        claimType: "CALCULATION",
        evidence: {
          seriesId: SERIES,
          absoluteChange: -0.25,
          percentChange: -7.5,
          bpsChange: -25,
        },
      },
      { seriesUnit: "percent" },
    );
    expect(atoms.map((a) => [a.kind, a.canonicalValue, a.unit])).toEqual([
      ["ABSOLUTE_CHANGE", -0.25, "percent"],
      ["PERCENT_CHANGE", -7.5, "percent"],
      ["BPS_CHANGE", -25, "bps"],
    ]);
  });

  it("derives nothing from a premise whose evidence is unreadable", () => {
    expect(factAtoms({ id: "p1", claimType: "FACT", evidence: {} }, {})).toEqual([]);
    expect(
      calculationAtoms({ id: "p1", claimType: "CALCULATION", evidence: null }, { seriesUnit: "x" }),
    ).toEqual([]);
  });
});

describe("what VERIFIED is careful not to say", () => {
  it("says well-founded and traceable, explicitly not correct", () => {
    const result = verify("Export demand is the constraint.", [atom()], []);
    expect(result.status).toBe("VERIFIED");
    expect(result.detail).toContain("not that it is correct");
  });
});
