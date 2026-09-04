import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * IR-037 — a HIGH-confidence causal claim, shown with its limitation and without its basis.
 *
 * From the `PROVENANCE` countermeasure: assert provenance where the reader SEES it. The domain
 * layer already attaches `sourceCode` to series and company figures, and the two failures in this
 * cluster were both in the rendering — the Macro Regime axes showed bare numbers while every other
 * section named a provider and a date.
 *
 * Auditing the pages for that found every FIGURE properly attributed. What is not attributed is the
 * causal graph. `CausalEdge` stores an `evidence` field, described in the schema as "why this is
 * believed — established literature/precedent, not a citation-shaped guess", and it is required at
 * the schema level for the same reason `counterexamples` is.
 *
 * `/ask` renders the direction, the confidence, the mechanism, the lag and the counterexamples. It
 * does not render the evidence, and it cannot: `CausalFactor`, the domain type between them, has no
 * such field. The basis is dropped a layer before the page.
 *
 * The asymmetry is the tell. Both fields are schema-required and both exist to keep a claim honest;
 * the LIMITATION is shown and the BASIS is not, so a reader sees "MEDIUM confidence" with the
 * caveats and no way to ask why anyone believes it.
 *
 * **P2, deferred by the freeze.** Nothing false is displayed — something true is omitted — and only
 * one causal edge is stored today, a test fixture, so the user-facing impact is currently nil. The
 * fix is additive: carry `evidence` through `CausalFactor` and render it beside the limitations.
 * Recorded in `docs/REVIEW_DEBT.md`.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the causal graph's basis", () => {
  it("is stored, and the schema says why it is required", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model CausalEdge"));
    expect(model).toContain("evidence");
    // Stored deliberately, not incidentally — the same standing as counterexamples.
    expect(model).toContain("counterexamples");
  });

  /**
   * Asserted as it currently behaves, deliberately the wrong way round, so that FIXING IR-037
   * breaks this test. A known gap asserted as correct behaviour is how a defect becomes a
   * specification — the same pattern used for IR-033 and IR-036.
   */
  it("is dropped by the domain type before it can reach a page", () => {
    const domain = read("src/server/domain/askMarket.ts");
    const causalFactor = domain.slice(
      domain.indexOf("export interface CausalFactor"),
      domain.indexOf("export interface CompanyFactFactor"),
    );
    expect(causalFactor).toContain("counterexamples");
    expect(causalFactor, "IR-037 has been fixed — invert this and render it").not.toContain(
      "evidence",
    );
  });

  it("is therefore absent from the page, while the limitation is present", () => {
    const page = read("src/app/ask/page.tsx");
    const causalSection = page.slice(page.indexOf("Related causal relationships"));
    expect(causalSection).toContain("counterexamples");
    expect(causalSection).toContain("confidence");
    expect(causalSection, "IR-037 has been fixed — invert this").not.toContain("evidence");
  });
});

describe("every figure a page renders names where it came from", () => {
  /**
   * The rest of the audit, asserted so the cluster's actual instances cannot recur. Both were
   * rendering failures invisible to a domain-level test, which is why these read the pages.
   */
  it.each([
    ["src/app/today/page.tsx", "Today — What Changed and the Macro Regime axes"],
    ["src/app/ask/page.tsx", "Ask Market — series and company factors"],
    ["src/app/company/[corpCode]/page.tsx", "Company X-Ray"],
    ["src/app/company/page.tsx", "the company index"],
  ])("%s (%s)", (path) => {
    expect(read(path)).toContain("sourceCode");
  });

  it("still shows the provider and the date on the Macro Regime axes", () => {
    // The specific regression: these rendered bare numbers while every other section named both,
    // and the domain layer had attached the provenance all along.
    const today = read("src/app/today/page.tsx");
    const regime = today.slice(today.indexOf("Macro Regime"), today.indexOf("Recent Events"));
    expect(regime).toContain("sourceCode");
    expect(regime).toContain("asOfDate");
  });
});
