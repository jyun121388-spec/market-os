import { describe, expect, it } from "vitest";
import { normalizeCompanyFacts } from "@/server/adapters/edgar-xbrl/normalize";
import fixture from "@/server/adapters/edgar-xbrl/__fixtures__/apple-companyfacts.json";
import type { XbrlCompanyFacts } from "@/server/adapters/edgar-xbrl/types";

const response = fixture as unknown as XbrlCompanyFacts;

describe("normalizeCompanyFacts", () => {
  it("extracts only tracked concepts, skipping untracked ones", () => {
    const facts = normalizeCompanyFacts(response, "320193");
    expect(facts).toHaveLength(3); // Revenues, NetIncomeLoss, Assets — not SomeUntrackedConcept
    expect(facts.some((f) => f.concept === "SomeUntrackedConcept")).toBe(false);
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
