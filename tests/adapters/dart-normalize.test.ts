import { describe, expect, it } from "vitest";
import { normalizeDartDisclosures } from "@/server/adapters/dart/normalize";
import fixture from "@/server/adapters/dart/__fixtures__/samsung-list.json";
import type { DartListSuccess } from "@/server/adapters/dart/types";

const response = fixture as DartListSuccess;

describe("normalizeDartDisclosures", () => {
  it("normalizes every row in the response", () => {
    const filings = normalizeDartDisclosures(response);
    expect(filings).toHaveLength(2);
  });

  it("parses rcept_dt as UTC midnight", () => {
    const [first] = normalizeDartDisclosures(response);
    expect(first.receiptDate.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("normalizes an empty rm to null rather than an empty string", () => {
    const [, second] = normalizeDartDisclosures(response);
    expect(second.remark).toBeNull();
  });

  it("retains the raw row for auditability", () => {
    const [first] = normalizeDartDisclosures(response);
    expect(first.raw).toEqual(response.list[0]);
  });

  it.each([
    ["20260230", "Feb 30 — would roll over to Mar 2"],
    ["20260231", "Feb 31 — would roll over to Mar 3"],
    ["20261301", "month 13 — would roll over into the next year"],
    ["20260132", "day 32 — would roll over to the next month"],
    ["20250229", "Feb 29 in a non-leap year"],
  ])("rejects the impossible rcept_dt %s (%s)", (rcept_dt) => {
    // `\d{8}` proves the shape, not the date, and Date.UTC rolls impossible dates over
    // silently — storing a filing under a date DART never reported. FRED and ECOS got this
    // guard in the 2026-08-16 impossible-date pass; DART was missed until the 2026-08-17 audit.
    const impossible: DartListSuccess = {
      ...response,
      list: [{ ...response.list[0], rcept_dt }],
    };
    expect(() => normalizeDartDisclosures(impossible)).toThrow();
  });

  it("still accepts a real leap day", () => {
    const leap: DartListSuccess = {
      ...response,
      list: [{ ...response.list[0], rcept_dt: "20240229" }],
    };
    const [filing] = normalizeDartDisclosures(leap);
    expect(filing.receiptDate.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  it("throws on a malformed rcept_dt rather than silently defaulting", () => {
    const malformed: DartListSuccess = {
      ...response,
      list: [{ ...response.list[0], rcept_dt: "not-a-date" }],
    };
    expect(() => normalizeDartDisclosures(malformed)).toThrow();
  });

  describe("KST calendar-date boundaries (timezone-independence)", () => {
    // rcept_dt describes a Korean (KST) calendar date with no time-of-day component. Parsing
    // must land on that exact Y-M-D as UTC midnight regardless of the server process's own
    // local timezone — these lock that in for the boundary dates most likely to reveal an
    // off-by-one if a future change swapped Date.UTC for a local-timezone Date constructor.
    function withReceiptDate(date: string): DartListSuccess {
      return { ...response, list: [{ ...response.list[0], rcept_dt: date }] };
    }

    it("a Korean New Year's Eve date does not roll over to the next UTC day", () => {
      const [filing] = normalizeDartDisclosures(withReceiptDate("20251231"));
      expect(filing.receiptDate.toISOString()).toBe("2025-12-31T00:00:00.000Z");
    });

    it("a Korean New Year's Day date does not roll back to the previous UTC day", () => {
      const [filing] = normalizeDartDisclosures(withReceiptDate("20260101"));
      expect(filing.receiptDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });

    it("handles a leap-day date (2028-02-29) without drifting into March", () => {
      const [filing] = normalizeDartDisclosures(withReceiptDate("20280229"));
      expect(filing.receiptDate.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    });
  });
});
