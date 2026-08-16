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

    describe("KST calendar-date boundaries (timezone-independence)", () => {
      // ECOS TIME values describe a Korean (KST) calendar date with no time-of-day component.
      // Parsing must land on that exact Y-M-D as UTC midnight regardless of the server process's
      // own local timezone — these lock that in for the boundary dates most likely to reveal an
      // off-by-one if a future change swapped Date.UTC for a local-timezone Date constructor.
      it("a Korean New Year's Eve date does not roll over to the next UTC day", () => {
        expect(parseEcosTimeAsUtc("20251231", "D").toISOString()).toBe("2025-12-31T00:00:00.000Z");
      });
      it("a Korean New Year's Day date does not roll back to the previous UTC day", () => {
        expect(parseEcosTimeAsUtc("20260101", "D").toISOString()).toBe("2026-01-01T00:00:00.000Z");
      });
      it("handles a leap-day date (2028-02-29) without drifting into March", () => {
        expect(parseEcosTimeAsUtc("20280229", "D").toISOString()).toBe("2028-02-29T00:00:00.000Z");
      });
      it("the year boundary holds for annual/quarterly cycles too", () => {
        expect(parseEcosTimeAsUtc("2025", "A").toISOString()).toBe("2025-01-01T00:00:00.000Z");
        expect(parseEcosTimeAsUtc("2025Q4", "Q").toISOString()).toBe("2025-10-01T00:00:00.000Z");
      });
    });

    describe("P1: rejects impossible calendar dates instead of silently rolling them over", () => {
      it("a non-leap-year Feb 29 (day cycle)", () => {
        expect(() => parseEcosTimeAsUtc("20270229", "D")).toThrow(/does not exist/);
      });
      it("a Feb 30 (day cycle)", () => {
        expect(() => parseEcosTimeAsUtc("20260230", "D")).toThrow(/does not exist/);
      });
      it("month 13 (month cycle)", () => {
        expect(() => parseEcosTimeAsUtc("202613", "M")).toThrow(/does not exist/);
      });
      it("quarter 5 (quarter cycle)", () => {
        expect(() => parseEcosTimeAsUtc("2026Q5", "Q")).toThrow(/quarter must be 1-4/);
      });
    });
  });
});
