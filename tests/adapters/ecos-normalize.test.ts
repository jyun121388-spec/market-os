import { describe, expect, it } from "vitest";
import { normalizeEcosObservations, parseEcosTimeAsUtc } from "@/server/adapters/ecos/normalize";
import fixture from "@/server/adapters/ecos/__fixtures__/base-rate.json";
import type { EcosStatisticSearchSuccess } from "@/server/adapters/ecos/types";

const response = fixture as EcosStatisticSearchSuccess;

describe("normalizeEcosObservations", () => {
  it('skips a non-numeric DATA_VALUE ("-") instead of coercing it to 0', () => {
    const { observations, skippedMissing } = normalizeEcosObservations(response);
    expect(skippedMissing).toHaveLength(1);
    expect(skippedMissing[0].TIME).toBe("202605");
    expect(observations).toHaveLength(3);
  });

  it("preserves the exact decimal string value", () => {
    const { observations } = normalizeEcosObservations(response);
    expect(observations[0].value).toBe("3.00");
  });

  it("retains the raw row for auditability", () => {
    const { observations } = normalizeEcosObservations(response);
    expect(observations[0].raw).toEqual(response.StatisticSearch.row[0]);
  });

  describe("parseEcosTimeAsUtc", () => {
    it("parses a monthly TIME as the first of the month, UTC", () => {
      expect(parseEcosTimeAsUtc("202603", "M").toISOString()).toBe("2026-03-01T00:00:00.000Z");
    });
    it("parses a daily TIME", () => {
      expect(parseEcosTimeAsUtc("20260315", "D").toISOString()).toBe("2026-03-15T00:00:00.000Z");
    });
    it("parses a quarterly TIME as the first month of the quarter", () => {
      expect(parseEcosTimeAsUtc("2026Q2", "Q").toISOString()).toBe("2026-04-01T00:00:00.000Z");
    });
    it("parses an annual TIME as January 1", () => {
      expect(parseEcosTimeAsUtc("2026", "A").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });
  });
});
