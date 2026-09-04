import { describe, expect, it } from "vitest";
import {
  quantitativeOccurrences,
  verifyInferenceClaim,
  type PremiseVerification,
} from "@/server/domain/inferenceClaim";
import { parseQuantity, type QuantitativeCitation } from "@/server/domain/quantitativeCitation";
import {
  calculationAtoms,
  factAtoms,
  type QuantitativeAtom,
} from "@/server/domain/quantitativeEvidence";

/**
 * The negative controls for IR-094 and IR-095.
 *
 * Every probe in both reproduction matrices was ACCEPTED by the implementation of its day. Each is
 * a test here, phrased as the thing that must now be refused, so neither round of defects can
 * return quietly.
 */

const APPLE = "series-apple-margin";
const UNEMPLOYMENT = "series-unemployment";

const atom = (over: Partial<QuantitativeAtom> = {}): QuantitativeAtom => ({
  premiseClaimId: "p1",
  kind: "OBSERVATION_VALUE",
  canonicalValue: "2.1",
  unit: "percent",
  subjectId: APPLE,
  ...over,
});

const premise = (atoms: QuantitativeAtom[], status = "VERIFIED", claimId = "p1") =>
  ({ claimId, status, atoms }) satisfies PremiseVerification;

/** Cites the Nth occurrence of `surfaceText`, computing the offsets from the claim itself. */
const citeNth = (
  claimText: string,
  surfaceText: string,
  nth = 0,
  over: Partial<QuantitativeCitation> = {},
): QuantitativeCitation => {
  let index = -1;
  for (let i = 0; i <= nth; i += 1) index = claimText.indexOf(surfaceText, index + 1);
  return {
    premiseClaimId: "p1",
    kind: "OBSERVATION_VALUE",
    subjectId: APPLE,
    surfaceText,
    assertionStart: index,
    assertionEnd: index + surfaceText.length,
    ...over,
  };
};

const verify = (
  claimText: string,
  atoms: QuantitativeAtom[],
  citations: QuantitativeCitation[],
  over: Partial<Parameters<typeof verifyInferenceClaim>[0]> = {},
) =>
  verifyInferenceClaim({
    claimText,
    confidence: 0.5,
    premises: [premise(atoms)],
    citations,
    ...over,
  });

describe("F — one citation covers one occurrence, not every twin", () => {
  const TWO = "Apple margin was 2.1 percent, while unemployment was 2.1 percent.";

  it("finds two occurrences where the old span scan found one token", () => {
    expect(quantitativeOccurrences(TWO).map((o) => o.start)).toHaveLength(2);
  });

  it("refuses when only the first occurrence is cited", () => {
    const result = verify(TWO, [atom()], [citeNth(TWO, "2.1 percent", 0)]);
    expect(result.status).toBe("UNCITED_QUANTITY");
    expect(result.uncitedQuantities).toHaveLength(1);
  });

  it("refuses when only the second occurrence is cited", () => {
    const result = verify(TWO, [atom()], [citeNth(TWO, "2.1 percent", 1)]);
    expect(result.status).toBe("UNCITED_QUANTITY");
  });

  it("accepts when both occurrences are cited independently", () => {
    const result = verify(
      TWO,
      [atom(), atom({ premiseClaimId: "p1", kind: "PERCENT_CHANGE", subjectId: UNEMPLOYMENT })],
      [
        citeNth(TWO, "2.1 percent", 0),
        citeNth(TWO, "2.1 percent", 1, { kind: "PERCENT_CHANGE", subjectId: UNEMPLOYMENT }),
      ],
    );
    expect(result.status, result.detail).toBe("VERIFIED");
  });

  it("refuses two unrelated 5 bps spreads with one citation", () => {
    const text = "The first spread was 5 bps and the second unrelated spread was 5 bps.";
    const result = verify(
      text,
      [atom({ canonicalValue: "5", unit: "bps", kind: "BPS_CHANGE" })],
      [citeNth(text, "5 bps", 0, { kind: "BPS_CHANGE" })],
    );
    expect(result.status).toBe("UNCITED_QUANTITY");
  });
});

describe("G — subject identity is enforced, not documented", () => {
  it("refuses an Apple-margin premise backing an unemployment assertion", () => {
    const text = "Unemployment is 5 percent.";
    const result = verify(
      text,
      [atom({ canonicalValue: "5", subjectId: APPLE })],
      [citeNth(text, "5 percent", 0, { subjectId: UNEMPLOYMENT })],
    );
    expect(result.failedCitations[0].verdict).toBe("SUBJECT_MISMATCH");
  });

  it("refuses a citation whose subject the atom does not share, with units identical", () => {
    // Deliberately same value AND same unit, so nothing but the subject can catch it.
    const text = "Series B stood at 5 percent.";
    const result = verify(
      text,
      [atom({ canonicalValue: "5", subjectId: "series-a" })],
      [citeNth(text, "5 percent", 0, { subjectId: "series-b" })],
    );
    expect(result.failedCitations[0].verdict).toBe("SUBJECT_MISMATCH");
  });

  it("accepts when the subject agrees", () => {
    const text = "Apple margin was 5 percent.";
    expect(verify(text, [atom({ canonicalValue: "5" })], [citeNth(text, "5 percent")]).status).toBe(
      "VERIFIED",
    );
  });
});

describe("H — a citation identifies an occurrence, not a substring", () => {
  it("refuses an offset outside the claim", () => {
    const text = "Margin was 5 percent.";
    const result = verify(
      text,
      [atom({ canonicalValue: "5" })],
      [{ ...citeNth(text, "5 percent"), assertionStart: 900, assertionEnd: 910 }],
    );
    expect(result.failedCitations[0].verdict).toBe("RANGE_OUT_OF_BOUNDS");
  });

  it("refuses an offset pointing at different text", () => {
    const text = "Margin was 5 percent.";
    const result = verify(
      text,
      [atom({ canonicalValue: "5" })],
      [{ ...citeNth(text, "5 percent"), assertionStart: 0, assertionEnd: 6 }],
    );
    expect(result.failedCitations[0].verdict).toBe("RANGE_TEXT_MISMATCH");
  });

  it("distinguishes two identical surfaces at different locations", () => {
    const text = "Margin was 5 percent. Margin was 5 percent.";
    const first = citeNth(text, "5 percent", 0);
    const second = citeNth(text, "5 percent", 1);
    expect(first.assertionStart).not.toBe(second.assertionStart);
    expect(verify(text, [atom({ canonicalValue: "5" })], [first]).status).toBe("UNCITED_QUANTITY");
  });

  it("refuses a surface it cannot parse, rather than assuming a unit", () => {
    // "Revenue was 1,400" states a quantity whose unit the sentence never gave. Guessing is the
    // mistake the whole repair exists to avoid, so an unreadable surface fails the citation.
    // This assertion existed before the occurrence rewrite and was lost with it — a surviving
    // mutant found the gap.
    const text = "Revenue was 1,400.";
    const result = verify(
      text,
      [atom({ canonicalValue: "1400", unit: "USD" })],
      [citeNth(text, "1,400", 0, { subjectId: APPLE })],
    );
    expect(result.failedCitations[0].verdict).toBe("UNPARSEABLE_SURFACE");
  });

  it("does not let a shorter quantity be absolved by a longer one", () => {
    // "5 percent" is a substring of "15 percent"; an occurrence-aware check is not fooled.
    const text = "Margin was 15 percent.";
    const result = verify(text, [atom({ canonicalValue: "5" })], []);
    expect(result.status).toBe("UNCITED_QUANTITY");
    expect(result.uncitedQuantities[0]).toContain("15");
  });
});

describe("I — exact decimals survive the comparison", () => {
  it.each([
    ["90000000000000.000001", "90000000000000.000002"],
    ["12345678901234.000001", "12345678901234.000002"],
    ["99999999999999.999998", "99999999999999.999999"],
  ])("distinguishes %s from %s, which collapse to one double", (evidence, asserted) => {
    expect(Number(evidence)).toBe(Number(asserted));
    const text = `The reading was ${asserted} percent.`;
    const result = verify(
      text,
      [atom({ canonicalValue: evidence })],
      [citeNth(text, `${asserted} percent`)],
    );
    expect(result.failedCitations[0].verdict).toBe("VALUE_MISMATCH");
  });

  it("accepts an exact match at the column's full precision", () => {
    const exact = "90000000000000.000001";
    const text = `The reading was ${exact} percent.`;
    expect(
      verify(text, [atom({ canonicalValue: exact })], [citeNth(text, `${exact} percent`)]).status,
    ).toBe("VERIFIED");
  });

  it("keeps the parsed magnitude a string, never a number", () => {
    const parsed = parseQuantity("90000000000000.000001 percent");
    expect(parsed).not.toBe("UNPARSEABLE");
    if (parsed !== "UNPARSEABLE") expect(parsed.magnitude).toBe("90000000000000.000001");
  });
});

describe("carried forward from IR-094", () => {
  it("refuses a sign flip", () => {
    const text = "growth was 2.1 percent";
    const result = verify(text, [atom({ canonicalValue: "-2.1" })], [citeNth(text, "2.1 percent")]);
    expect(result.failedCitations[0].verdict).toBe("SIGN_MISMATCH");
  });

  it("refuses a unit swap", () => {
    const text = "the change was 2.1 bps";
    const result = verify(text, [atom({ unit: "percent" })], [citeNth(text, "2.1 bps")]);
    expect(result.failedCitations[0].verdict).toBe("UNIT_MISMATCH");
  });

  it("refuses a citation naming a kind the premise does not establish", () => {
    const text = "the change was 2.1 percent";
    const result = verify(
      text,
      [atom()],
      [citeNth(text, "2.1 percent", 0, { kind: "PERCENT_CHANGE" })],
    );
    expect(result.failedCitations[0].verdict).toBe("ATOM_NOT_FOUND");
  });

  it("refuses NaN confidence", () => {
    expect(verify("x", [atom()], [], { confidence: NaN }).status).toBe("CONFIDENCE_NOT_A_NUMBER");
  });

  it("refuses a no-premise inference", () => {
    expect(
      verifyInferenceClaim({ claimText: "x", confidence: 0.5, premises: [], citations: [] }).status,
    ).toBe("NO_PREMISES");
  });

  it("refuses malformed evidence rather than repairing it", () => {
    const result = verifyInferenceClaim({
      claimText: "x",
      confidence: 0.5,
      premises: [premise([atom()])],
      citations: [],
      evidenceMalformed: "premiseClaimIds[1] is 123, not a non-empty string",
    });
    expect(result.status).toBe("MALFORMED_EVIDENCE");
  });

  it("does not require a citation for a full ISO date", () => {
    expect(quantitativeOccurrences("as of 2026-03-01 the reading held")).toEqual([]);
  });

  it("keeps offsets indexing the original string when a date is masked", () => {
    // The date is blanked rather than removed, so every later offset still points at the real
    // character. Rebuilding offsets after a deletion is arithmetic that drifts silently.
    const text = "on 2026-03-01 margin was 5 percent";
    const [occurrence] = quantitativeOccurrences(text);
    expect(text.slice(occurrence.start, occurrence.end)).toBe("5");
  });
});

describe("atoms come from evidence rows, never from prose", () => {
  it("derives one signed, united, exact atom from a FACT premise", () => {
    expect(
      factAtoms(
        { id: "p1", claimType: "FACT", evidence: {} },
        {
          observation: { id: "o1", seriesId: APPLE, value: { toString: () => "-2.100000" } },
          seriesUnit: "percent",
        },
      ),
    ).toEqual([
      {
        premiseClaimId: "p1",
        kind: "OBSERVATION_VALUE",
        canonicalValue: "-2.100000",
        unit: "percent",
        subjectId: APPLE,
      },
    ]);
  });

  it("derives three atoms from a CALCULATION premise, each with its own unit", () => {
    const atoms = calculationAtoms(
      {
        id: "p1",
        claimType: "CALCULATION",
        evidence: { seriesId: APPLE, absoluteChange: -0.25, percentChange: -7.5, bpsChange: -25 },
      },
      { seriesUnit: "percent" },
    );
    expect(atoms.map((a) => [a.kind, a.canonicalValue, a.unit])).toEqual([
      ["ABSOLUTE_CHANGE", "-0.25", "percent"],
      ["PERCENT_CHANGE", "-7.5", "percent"],
      ["BPS_CHANGE", "-25", "bps"],
    ]);
  });

  it("derives nothing from an unreadable observation value", () => {
    expect(
      factAtoms(
        { id: "p1", claimType: "FACT", evidence: {} },
        {
          observation: { id: "o1", seriesId: APPLE, value: { toString: () => "0x10" } },
          seriesUnit: "percent",
        },
      ),
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
