import { describe, expect, it } from "vitest";
import { formatTimestampUtc } from "@/lib/formatDate";

describe("formatTimestampUtc", () => {
  it("formats a Date as an explicit UTC timestamp, independent of server-local timezone", () => {
    const d = new Date(Date.UTC(2026, 0, 1, 15, 30, 0));
    expect(formatTimestampUtc(d)).toBe("2026-01-01 15:30:00 UTC");
  });

  it("accepts an ISO string the same way it accepts a Date", () => {
    expect(formatTimestampUtc("2026-08-16T00:00:00.000Z")).toBe("2026-08-16 00:00:00 UTC");
  });

  it("a KST-midnight instant (UTC-9h) renders as its own UTC calendar day, not the KST one", () => {
    // 2026-01-01 00:00 KST is 2025-12-31 15:00 UTC — proves formatting never silently
    // reinterprets the instant into a different calendar day.
    const kstMidnightAsUtcInstant = new Date(Date.UTC(2025, 11, 31, 15, 0, 0));
    expect(formatTimestampUtc(kstMidnightAsUtcInstant)).toBe("2025-12-31 15:00:00 UTC");
  });
});
