import { describe, expect, it } from "vitest";
import { normalizeEdgarSubmissions } from "@/server/adapters/edgar/normalize";
import fixture from "@/server/adapters/edgar/__fixtures__/apple-submissions.json";
import type { EdgarSubmissionsResponse } from "@/server/adapters/edgar/types";

const response = fixture as EdgarSubmissionsResponse;

describe("normalizeEdgarSubmissions", () => {
  it("zips the parallel arrays into one row per filing", () => {
    const filings = normalizeEdgarSubmissions(response);
    expect(filings).toHaveLength(2);
    expect(filings[0].receiptNo).toBe("0000320193-26-000045");
    expect(filings[1].receiptNo).toBe("0000320193-26-000032");
  });

  it("parses filingDate as UTC midnight", () => {
    const [first] = normalizeEdgarSubmissions(response);
    expect(first.receiptDate.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("uses the first ticker as stockCode", () => {
    const [first] = normalizeEdgarSubmissions(response);
    expect(first.stockCode).toBe("AAPL");
  });

  it("normalizes an empty items string to a null remark", () => {
    const [first] = normalizeEdgarSubmissions(response);
    expect(first.remark).toBeNull();
  });

  it("throws when the parallel arrays are misaligned rather than silently misattributing data", () => {
    const misaligned: EdgarSubmissionsResponse = {
      ...response,
      filings: {
        ...response.filings,
        recent: {
          ...response.filings.recent,
          filingDate: [response.filings.recent.filingDate[0]], // one short
        },
      },
    };
    expect(() => normalizeEdgarSubmissions(misaligned)).toThrow(/misaligned/);
  });
});
