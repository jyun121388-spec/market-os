import { describe, expect, it } from "vitest";
import { filingSourceUrl } from "@/lib/filingSourceUrl";

/**
 * A source link is part of the fact (`docs/DATA_POLICY.md`), so a wrong one is a wrong citation,
 * not a broken button. These controls exist because the first EDGAR implementation was wrong in a
 * way nothing would have failed on: it pointed every filing at a company file-number search.
 */
describe("canonical filing source URLs", () => {
  it("addresses one EDGAR accession in the Archives, with the CIK unpadded", () => {
    expect(filingSourceUrl("SEC_EDGAR", "0000320193", "0000320193-26-000045")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000045/0000320193-26-000045-index.htm",
    );
  });

  it("is not a company search — the accession must appear in the path", () => {
    const url = filingSourceUrl("SEC_EDGAR", "0000320193", "0000320193-26-000045")!;
    expect(url).toContain("0000320193-26-000045");
    expect(url).not.toContain("browse-edgar");
    expect(url).not.toContain("filenum");
  });

  it("addresses a DART filing by its receipt number", () => {
    expect(filingSourceUrl("DART", "00126380", "20260401000123")).toBe(
      "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260401000123",
    );
  });

  it("returns null rather than guessing for a provider whose scheme is unknown", () => {
    for (const code of ["FRED", "ECOS", "SEC_EDGAR_XBRL", "", "UNKNOWN"]) {
      expect(filingSourceUrl(code, "0000320193", "0000320193-26-000045"), code).toBeNull();
    }
  });

  it("returns null when the identifier does not match the provider's shape", () => {
    // An accession that is not an accession, and a CIK that is not digits. Building a URL from
    // either would produce a confident link to nothing.
    expect(filingSourceUrl("SEC_EDGAR", "0000320193", "not-an-accession")).toBeNull();
    expect(filingSourceUrl("SEC_EDGAR", "0000320193", "0000320193-26-45")).toBeNull();
    expect(filingSourceUrl("SEC_EDGAR", "APPLE", "0000320193-26-000045")).toBeNull();
    expect(filingSourceUrl("DART", "00126380", "2026/04/01")).toBeNull();
  });
});
