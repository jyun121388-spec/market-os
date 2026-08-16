import { describe, expect, it } from "vitest";
import { normalizeCompanyFacts } from "@/server/adapters/edgar-xbrl/normalize";
import fixture from "@/server/adapters/edgar-xbrl/__fixtures__/apple-companyfacts.json";
import type { XbrlCompanyFacts } from "@/server/adapters/edgar-xbrl/types";

const response = fixture as unknown as XbrlCompanyFacts;

describe("normalizeCompanyFacts", () => {
  it("extracts only tracked concepts, skipping untracked ones", () => {
    const facts = normalizeCompanyFacts(response, "320193");
    // Revenues, NetIncomeLoss, Assets x2 — not SomeUntrackedConcept
    expect(facts).toHaveLength(4);
    expect(facts.some((f) => f.concept === "SomeUntrackedConcept")).toBe(false);
  });

  it("keeps a fact whose fiscal label SEC reports as null, without inventing one", () => {
    // Regression for a real shape found by scripts/verify-edgar-live.ts against data.sec.gov:
    // some rows (facts republished for a `frame` under a later restating filing) carry
    // `fy: null, fp: null`. The row must survive — its value, period, form and accession are
    // all real — with the missing label represented as null rather than guessed from periodEnd.
    const facts = normalizeCompanyFacts(response, "320193");
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
    const facts = normalizeCompanyFacts(response, "320193");
    const revenue = facts.find((f) => f.concept === "Revenues")!;
    expect(revenue.value).toBe("400000000000");
  });

  it("parses period dates as UTC and preserves null periodStart for instant concepts", () => {
    const facts = normalizeCompanyFacts(response, "320193");
    const assets = facts.find((f) => f.concept === "Assets")!;
    expect(assets.periodStart).toBeNull(); // Assets is an instant concept, no `start`
    expect(assets.periodEnd.toISOString()).toBe("2026-06-30T00:00:00.000Z");

    const revenue = facts.find((f) => f.concept === "Revenues")!;
    expect(revenue.periodStart?.toISOString()).toBe("2025-07-01T00:00:00.000Z");
  });

  it("retains the raw fact for auditability", () => {
    const facts = normalizeCompanyFacts(response, "320193");
    const revenue = facts.find((f) => f.concept === "Revenues")!;
    expect(revenue.raw).toEqual(response.facts["us-gaap"]!.Revenues.units.USD[0]);
  });

  it("returns an empty array rather than throwing when a company has no us-gaap facts", () => {
    const empty: XbrlCompanyFacts = { cik: 1, entityName: "Empty Co", facts: {} };
    expect(normalizeCompanyFacts(empty, "1")).toEqual([]);
  });
});
