import { describe, expect, it } from "vitest";
import { AXIS_SERIES } from "@/server/domain/macroRegime";

describe("AXIS_SERIES coverage", () => {
  it("maps every planned axis to at least one series", () => {
    const axes = Object.keys(AXIS_SERIES);
    expect(axes).toEqual([
      "GROWTH",
      "INFLATION",
      "LIQUIDITY",
      "RISK",
      "RATES",
      "USD",
      "CREDIT",
      "COMMODITY",
    ]);
    for (const axis of axes) {
      expect(AXIS_SERIES[axis as keyof typeof AXIS_SERIES].length).toBeGreaterThan(0);
    }
  });
});
