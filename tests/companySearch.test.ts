import { describe, expect, it } from "vitest";
import { filterCompanies, summariseCoverage } from "@/lib/companySearch";

const company = (
  corpName: string,
  corpCode: string,
  sourceCode: string,
  stockCode: string | null = null,
) => ({ corpName, corpCode, sourceCode, stockCode });

const APPLE = company("Apple Inc.", "0000320193", "SEC_EDGAR", "AAPL");
const SAMSUNG = company("삼성전자", "00126380", "DART", "005930");
const MSFT = company("Microsoft Corporation", "0000789019", "SEC_EDGAR", "MSFT");

describe("company search", () => {
  it("matches on name, ticker and provider code, case-insensitively", () => {
    const all = [APPLE, SAMSUNG, MSFT];
    expect(filterCompanies(all, "apple")).toEqual([APPLE]);
    expect(filterCompanies(all, "AAPL")).toEqual([APPLE]);
    expect(filterCompanies(all, "aapl")).toEqual([APPLE]);
    expect(filterCompanies(all, "0000320193")).toEqual([APPLE]);
    expect(filterCompanies(all, "삼성")).toEqual([SAMSUNG]);
  });

  it("returns everything for an empty or whitespace query rather than nothing", () => {
    const all = [APPLE, SAMSUNG];
    expect(filterCompanies(all, "")).toHaveLength(2);
    expect(filterCompanies(all, "   ")).toHaveLength(2);
  });

  it("returns nothing rather than a near miss when there is no match", () => {
    // Not fuzzy, deliberately. A search that quietly returns a DIFFERENT company than the one
    // asked for is IR-001 and IR-032 all over again, in the least visible place in the product.
    expect(filterCompanies([APPLE, MSFT], "Appel")).toEqual([]);
    expect(filterCompanies([APPLE, MSFT], "Aple")).toEqual([]);
  });

  it("does not reorder what it keeps", () => {
    // Survivors come back in input order, so the list a reader was looking at does not rearrange
    // itself under them when they type.
    const all = [MSFT, APPLE, SAMSUNG];
    expect(filterCompanies(all, "0000").map((c) => c.corpName)).toEqual([
      "Microsoft Corporation",
      "Apple Inc.",
    ]);
  });
});

describe("coverage summary", () => {
  it("reports HAS_DATA with a count when companies are stored", () => {
    const c = summariseCoverage(new Map([["SEC_EDGAR", 3]]), { SEC_EDGAR: true, DART: true });
    const edgar = c.find((x) => x.sourceCode === "SEC_EDGAR")!;
    expect(edgar.state).toBe("HAS_DATA");
    expect(edgar.companies).toBe(3);
    expect(edgar.detail).toContain("3 companies");
  });

  it("distinguishes an unconfigured provider from a configured but empty one", () => {
    // The distinction is the whole point: "no results" makes a product look broken when it is
    // merely waiting for a credential, and the two need different things from the reader.
    const unconfigured = summariseCoverage(new Map(), { SEC_EDGAR: true, DART: false });
    expect(unconfigured.find((x) => x.sourceCode === "DART")!.state).toBe("NOT_CONFIGURED");
    expect(unconfigured.find((x) => x.sourceCode === "SEC_EDGAR")!.state).toBe(
      "CONFIGURED_NO_DATA",
    );

    const configured = summariseCoverage(new Map(), { SEC_EDGAR: true, DART: true });
    expect(configured.find((x) => x.sourceCode === "DART")!.state).toBe("CONFIGURED_NO_DATA");
  });

  it("prefers stored data over configuration state — data present is data present", () => {
    // A provider with rows but no credential now (revoked, or ingested elsewhere) still HAS data,
    // and telling the reader it is unconfigured while showing its companies would contradict the
    // list right below it.
    const c = summariseCoverage(new Map([["DART", 1]]), { SEC_EDGAR: true, DART: false });
    expect(c.find((x) => x.sourceCode === "DART")!.state).toBe("HAS_DATA");
  });

  it("names only filing providers — FRED and ECOS supply indicators, not companies", () => {
    const codes = summariseCoverage(new Map(), { SEC_EDGAR: true, DART: true }).map(
      (c) => c.sourceCode,
    );
    expect(codes).toEqual(["SEC_EDGAR", "DART"]);
  });

  it("never carries a credential value, only whether one exists", () => {
    const c = summariseCoverage(new Map(), { SEC_EDGAR: true, DART: true });
    const serialized = JSON.stringify(c);
    expect(serialized).not.toContain("API_KEY");
    for (const entry of c) {
      expect(typeof entry.companies).toBe("number");
      expect(Object.keys(entry).sort()).toEqual(
        ["companies", "detail", "sourceCode", "state", "universe"].sort(),
      );
    }
  });
});
