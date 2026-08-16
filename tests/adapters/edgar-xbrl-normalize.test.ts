import { describe, expect, it } from "vitest";
import { normalizeCompanyFacts } from "@/server/adapters/edgar-xbrl/normalize";
import fixture from "@/server/adapters/edgar-xbrl/__fixtures__/apple-companyfacts.json";
import { TRACKED_XBRL_CONCEPTS, type XbrlCompanyFacts } from "@/server/adapters/edgar-xbrl/types";

const response = fixture as unknown as XbrlCompanyFacts;

describe("normalizeCompanyFacts", () => {
  it("extracts only tracked concepts, skipping untracked ones", () => {
    const { facts } = normalizeCompanyFacts(response, "320193");
    // Revenues, NetIncomeLoss, Assets x2 — not SomeUntrackedConcept
    expect(facts).toHaveLength(4);
    expect(facts.some((f) => f.concept === "SomeUntrackedConcept")).toBe(false);
  });

  it("keeps a fact whose fiscal label SEC reports as null, without inventing one", () => {
    // Regression for a real shape found by scripts/verify-edgar-live.ts against data.sec.gov:
    // some rows (facts republished for a `frame` under a later restating filing) carry
    // `fy: null, fp: null`. The row must survive — its value, period, form and accession are
    // all real — with the missing label represented as null rather than guessed from periodEnd.
    const { facts } = normalizeCompanyFacts(response, "320193");
    const unlabeled = facts.find((f) => f.accessionNumber === "0001193125-15-023732")!;

    expect(unlabeled).toBeDefined();
    expect(unlabeled.fiscalYear).toBeNull();
    expect(unlabeled.fiscalPeriod).toBeNull();
    // The parts SEC did report are intact and untouched.
    expect(unlabeled.concept).toBe("Assets");
    expect(unlabeled.value).toBe("207000000000");
    expect(unlabeled.periodEnd.toISOString()).toBe("2013-09-28T00:00:00.000Z");
    expect(unlabeled.form).toBe("8-K");

    // And the labeled rows are unaffected.
    const labeled = facts.find((f) => f.concept === "Revenues")!;
    expect(labeled.fiscalYear).toBe(2026);
    expect(labeled.fiscalPeriod).toBe("FY");
  });

  it("preserves the exact value as a decimal string", () => {
    const { facts } = normalizeCompanyFacts(response, "320193");
    const revenue = facts.find((f) => f.concept === "Revenues")!;
    expect(revenue.value).toBe("400000000000");
  });

  it("parses period dates as UTC and preserves null periodStart for instant concepts", () => {
    const { facts } = normalizeCompanyFacts(response, "320193");
    const assets = facts.find((f) => f.concept === "Assets")!;
    expect(assets.periodStart).toBeNull(); // Assets is an instant concept, no `start`
    expect(assets.periodEnd.toISOString()).toBe("2026-06-30T00:00:00.000Z");

    const revenue = facts.find((f) => f.concept === "Revenues")!;
    expect(revenue.periodStart?.toISOString()).toBe("2025-07-01T00:00:00.000Z");
  });

  it("retains the raw fact for auditability", () => {
    const { facts } = normalizeCompanyFacts(response, "320193");
    const revenue = facts.find((f) => f.concept === "Revenues")!;
    expect(revenue.raw).toEqual(response.facts["us-gaap"]!.Revenues.units.USD[0]);
  });

  it("reports, rather than silently swallowing, a filer with no us-gaap taxonomy", () => {
    // This used to `return []`, which is indistinguishable from "the filer had nothing new".
    // A foreign-form or non-USD filer would ingest as a confident zero.
    const empty: XbrlCompanyFacts = { cik: 1, entityName: "Empty Co", facts: {} };
    const result = normalizeCompanyFacts(empty, "1");

    expect(result.facts).toEqual([]);
    expect(result.noUsGaapTaxonomy).toBe(true);
    // Every tracked concept is accounted for, not just absent from the output.
    expect(result.skippedConcepts).toHaveLength(TRACKED_XBRL_CONCEPTS.length);
    expect(result.skippedConcepts.every((s) => s.reason === "CONCEPT_NOT_REPORTED")).toBe(true);
  });

  it("reports a concept reported in a non-USD unit instead of dropping it silently", () => {
    const nonUsd: XbrlCompanyFacts = {
      cik: 1,
      entityName: "Krona Co",
      facts: {
        "us-gaap": {
          Assets: {
            label: "Assets",
            units: {
              SEK: [
                {
                  end: "2026-06-30",
                  val: 1000,
                  accn: "0000000000-26-000001",
                  fy: 2026,
                  fp: "FY",
                  form: "10-K",
                  filed: "2026-08-01",
                },
              ],
            },
          },
        },
      },
    };

    const result = normalizeCompanyFacts(nonUsd, "1");
    expect(result.facts).toEqual([]);

    const skipped = result.skippedConcepts.find((s) => s.concept === "Assets")!;
    expect(skipped.reason).toBe("NO_USD_UNIT");
    // The units the filer DID use are surfaced, so the gap is diagnosable rather than a mystery.
    expect(skipped.unitsAvailable).toEqual(["SEK"]);
  });

  it("reports a non-finite value as skipped rather than coercing it to 0", () => {
    const malformed = JSON.parse(JSON.stringify(fixture)) as XbrlCompanyFacts;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (malformed.facts["us-gaap"] as any).Revenues.units.USD[0].val = "not-a-number";

    const result = normalizeCompanyFacts(malformed, "320193");
    expect(result.facts.some((f) => f.concept === "Revenues")).toBe(false);
    expect(result.skippedNonNumeric).toHaveLength(1);
    expect(result.facts.every((f) => f.value !== "0")).toBe(true);
  });

  it.each([
    ["2026-02-30", "Feb 30"],
    ["2026-13-01", "month 13"],
    ["2025-02-29", "Feb 29 in a non-leap year"],
  ])("rejects the impossible period end %s (%s)", (end) => {
    const impossible = JSON.parse(JSON.stringify(fixture)) as XbrlCompanyFacts;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (impossible.facts["us-gaap"] as any).Revenues.units.USD[0].end = end;
    expect(() => normalizeCompanyFacts(impossible, "320193")).toThrow();
  });
});
