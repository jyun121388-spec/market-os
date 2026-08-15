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

  it("throws on a malformed rcept_dt rather than silently defaulting", () => {
    const malformed: DartListSuccess = {
      ...response,
      list: [{ ...response.list[0], rcept_dt: "not-a-date" }],
    };
    expect(() => normalizeDartDisclosures(malformed)).toThrow();
  });
});
