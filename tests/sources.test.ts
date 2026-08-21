import { describe, expect, it } from "vitest";
import { SOURCES } from "../prisma/sources";

describe("initial source registry", () => {
  it("has no duplicate source codes", () => {
    const codes = SOURCES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("marks every initial source as Tier S per docs/DATA_POLICY.md priority list", () => {
    for (const source of SOURCES) {
      expect(source.tier).toBe("TIER_S");
    }
  });

  it("includes the required Korea and US official sources", () => {
    const codes = new Set(SOURCES.map((s) => s.code));
    for (const required of ["FRED", "SEC_EDGAR", "ECOS", "DART", "MOLIT"]) {
      expect(codes.has(required)).toBe(true);
    }
  });
});
