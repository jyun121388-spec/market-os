import { describe, expect, it } from "vitest";
import { TRACKED_FRED_SERIES } from "@/server/adapters/fred/types";
import { TRACKED_ECOS_SERIES } from "@/server/adapters/ecos/types";
import { computeChange } from "@/server/domain/seriesReadings";

/**
 * Every tracked series must declare a unit from a known vocabulary.
 *
 * `computeChange` branches on the exact string `unit === "percent"` to decide whether a basis
 * point change is meaningful. That is the only unit-sensitive logic in the codebase, and it
 * fails silently: a series declared as "Percent", "pct" or "%" would still compute a correct
 * absolute and percent change while quietly returning `bpsChange: null`, and nothing would
 * indicate that a rate series had stopped reporting basis points.
 *
 * Exactly the "silence where there should be a signal" shape that produced most of this
 * project's real defects, so it gets a guard rather than a comment. No such typo exists today —
 * this exists to make the next one fail loudly at test time instead of shipping.
 */

/**
 * Units currently in use, each with what it means for arithmetic. Adding an entry is a
 * deliberate act: a new unit may need handling in `computeChange`, and several of these encode
 * a SCALE, which must never be mixed across series in any future aggregation.
 */
const KNOWN_UNITS: Record<string, string> = {
  percent: "a rate in percent — the only unit for which bpsChange is computed",
  index: "an index level; differences are points, not currency",
  USD_billions: "scaled currency — never combine with a differently-scaled series",
  USD_millions: "scaled currency — never combine with a differently-scaled series",
  USD_per_barrel: "a price per physical unit",
};

describe("tracked series unit vocabulary", () => {
  const allSeries = [
    ...TRACKED_FRED_SERIES.map((s) => ({ id: s.seriesId, unit: s.unit })),
    ...TRACKED_ECOS_SERIES.map((s) => ({ id: `${s.statCode}:${s.itemCode1}`, unit: s.unit })),
  ];

  it("has series to check", () => {
    expect(allSeries.length).toBeGreaterThan(0);
  });

  it.each(allSeries)("$id declares a known unit ($unit)", ({ unit }) => {
    expect(
      Object.keys(KNOWN_UNITS),
      `Unrecognised unit ${JSON.stringify(unit)}. Add it to KNOWN_UNITS with a note on what it ` +
        "means for arithmetic, and check whether computeChange needs to handle it — a unit it " +
        "does not recognise silently disables basis-point reporting rather than failing.",
    ).toContain(unit);
  });

  it("computes basis points for percent and withholds them otherwise", () => {
    const pair = {
      current: { value: "4.50" },
      previous: { value: "4.25" },
    } as unknown as Parameters<typeof computeChange>[0];

    expect(computeChange(pair, "percent").bpsChange).toBe(25);
    // Any other unit must return null rather than a number that would be nonsense — 25 basis
    // points of an index level means nothing.
    for (const unit of Object.keys(KNOWN_UNITS).filter((u) => u !== "percent")) {
      expect(computeChange(pair, unit).bpsChange).toBeNull();
    }
  });

  it("is case-sensitive, which is precisely the trap this guard exists for", () => {
    const pair = {
      current: { value: "4.50" },
      previous: { value: "4.25" },
    } as unknown as Parameters<typeof computeChange>[0];

    // Documents the real behaviour rather than wishing it away: "Percent" is NOT "percent", and
    // a series declared that way would lose basis points with no error. The vocabulary check
    // above is what stops that reaching production.
    expect(computeChange(pair, "Percent").bpsChange).toBeNull();
  });
});
