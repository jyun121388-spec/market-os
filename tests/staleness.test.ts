import { describe, expect, it } from "vitest";
import { evaluateStaleness } from "@/server/domain/staleness";

describe("evaluateStaleness", () => {
  it("is FRESH when the last observation is within the median interval", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    const result = evaluateStaleness(
      { lastObservedDate: "2026-01-09", medianIntervalDays: 1 },
      now,
    );
    expect(result.status).toBe("FRESH");
    expect(result.daysSinceLastObservation).toBe(1);
  });

  it("is FRESH right up to the stale threshold (3x median interval)", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const result = evaluateStaleness(
      { lastObservedDate: "2026-01-01", medianIntervalDays: 1 },
      now,
    );
    expect(result.daysSinceLastObservation).toBe(3);
    expect(result.status).toBe("FRESH");
  });

  it("is STALE once past 3x the median interval", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const result = evaluateStaleness(
      { lastObservedDate: "2026-01-01", medianIntervalDays: 1 },
      now,
    );
    expect(result.daysSinceLastObservation).toBe(4);
    expect(result.status).toBe("STALE");
  });

  it("scales the threshold with a series' own (larger) cadence", () => {
    const now = new Date("2026-04-01T00:00:00.000Z"); // 90 days after 2026-01-01
    const monthly = evaluateStaleness(
      { lastObservedDate: "2026-01-01", medianIntervalDays: 30 },
      now,
    );
    expect(monthly.status).toBe("FRESH"); // exactly 3x, not yet over

    const overdue = evaluateStaleness(
      { lastObservedDate: "2026-01-01", medianIntervalDays: 30 },
      new Date("2026-04-02T00:00:00.000Z"),
    );
    expect(overdue.status).toBe("STALE");
  });
});
