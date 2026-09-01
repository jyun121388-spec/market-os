import { describe, expect, it } from "vitest";
import { auditPresentationOrder, isTotalOrder } from "../scripts/presentation-order";
import { parseSchema, type Schema } from "../scripts/recency-cardinality";

/**
 * Whether the same request returns its rows in the same ORDER every time.
 *
 * A different question from the recency audit, and it exists because that audit structurally could
 * not see IR-113: its rule is "does an arrival clock decide which row WINS", so a `findMany` that
 * returns a whole collection and selects nothing is either STRUCTURAL — "orders presentation rather
 * than deciding a winner here" — or, with no `orderBy` and no first-element access, not reported at
 * all. That is where IR-113 lived for as long as nobody asked this question.
 */

const sites = auditPresentationOrder();
const at = (file: string, line: number) => {
  const site = sites.find((s) => s.file === file && s.line === line);
  if (!site) throw new Error(`no findMany site at ${file}:${line} — the audit's scope moved`);
  return site;
};

const weakenSchema = (mutate: (s: Schema) => void): Schema => {
  const base = parseSchema();
  const copy: Schema = {
    uniqueKeys: new Map([...base.uniqueKeys].map(([k, v]) => [k, v.map((x) => ({ ...x }))])),
    relations: new Map([...base.relations].map(([k, v]) => [k, v.map((x) => ({ ...x }))])),
  };
  mutate(copy);
  return copy;
};

describe("what makes a returned sequence deterministic", () => {
  it("audits a non-empty set with more than one verdict, so a silent zero cannot pass", () => {
    expect(sites.length).toBeGreaterThan(0);
    expect(new Set(sites.map((s) => s.determinism)).size).toBeGreaterThan(1);
  });

  /**
   * IR-113's site, as the regression anchor.
   *
   * `findSeriesFactors` reads its candidates with no `orderBy`. When two providers report the same
   * indicator the factors come back in whatever order Postgres chose, both figures correct and both
   * attributed — and an integration assertion picked the other one on 2026-09-01 and failed. The
   * ordering itself is recorded P2 debt and NOT repaired under the V1 freeze, so this control pins
   * the finding rather than a fix.
   */
  it("reports the IR-113 site as having no order at all", () => {
    const site = at("domain/askMarket.ts", 935);
    expect(site.determinism).toBe("NO_ORDER");
    expect(site.model).toBe("series");
    expect(site.keys).toEqual([]);
  });

  it("accepts an ordering that contains a whole unique key, and says which one", () => {
    const site = at("domain/askMarket.ts", 1202);
    expect(site.determinism).toBe("TOTAL_ORDER");
    expect(site.why).toContain("@id(id)");
    expect(site.keys).toContain("id");
  });

  /**
   * An ordering that leaves ties is NOT total, however sensible it looks.
   *
   * `orderBy: { receiptDate: "desc" }` is the natural way to ask for the newest filing and two
   * filings can share a receipt date. The database is then free to return either first. Calling
   * that deterministic because it "usually" is would be the same reasoning the whole recency line
   * of work exists to refuse.
   */
  it("refuses an ordering that can still tie", () => {
    const site = at("domain/askMarket.ts", 1278);
    expect(site.determinism).toBe("PARTIAL_ORDER");
    expect(site.why).toContain("receiptDate");
    expect(site.why).toContain("tie");
  });

  it("never calls a partial-index key a total order", () => {
    // The schema seam, with `FinancialFact`'s real unique keys replaced by a PARTIAL one covering
    // exactly the fields an ordering names. A partial index does not order the rows outside its
    // predicate, so it cannot make an ordering total — the same reasoning the cardinality audit
    // settled, applied to the other question.
    const weakened = weakenSchema((s) => {
      s.uniqueKeys.set("financialFact", [
        {
          kind: "MIGRATION_UNIQUE_INDEX",
          name: "pretend_partial",
          fields: ["periodEnd", "concept", "id"],
          partial: 'WHERE "periodStart" IS NOT NULL',
        },
      ]);
    });
    const after = auditPresentationOrder(weakened);
    const site = after.find((s) => s.file === "domain/askMarket.ts" && s.line === 1312)!;
    expect(site.determinism).not.toBe("TOTAL_ORDER");
  });

  /**
   * The uniqueness-removal control: take away what the verdict cited and the verdict must move.
   *
   * Without it, `isTotalOrder` could be returning true for any ordering that happens to mention a
   * field called `id`, which is a string match rather than a schema fact.
   */
  it("stops calling an ordering total when the key it cited is removed", () => {
    const weakened = weakenSchema((s) => {
      s.uniqueKeys.set("causalEdge", []);
    });
    const after = auditPresentationOrder(weakened);
    const site = after.find((s) => s.file === "domain/askMarket.ts" && s.line === 1202)!;
    expect(site.determinism).toBe("PARTIAL_ORDER");
    // And a site on a different model is untouched, so the mutation is targeted rather than blunt.
    const other = after.find((s) => s.file === "domain/askMarket.ts" && s.line === 1312)!;
    expect(other.determinism).toBe("TOTAL_ORDER");
  });
});

describe("the total-order rule on its own", () => {
  const schema = parseSchema();

  it("needs EVERY field of a compound key, not one of them", () => {
    // `Series` is unique on (sourceId, externalId). Ordering by half of it still leaves ties.
    expect(isTotalOrder(["externalId"], "series", schema)).toBeNull();
    expect(isTotalOrder(["sourceId"], "series", schema)).toBeNull();
    expect(isTotalOrder(["sourceId", "externalId"], "series", schema)).not.toBeNull();
  });

  it("does not care where in the ordering the unique key sits", () => {
    // A tie-breaker at the end is the usual shape, but the property is set membership: once the
    // key is present nothing can tie, whatever came before it.
    expect(isTotalOrder(["id"], "series", schema)).not.toBeNull();
    expect(isTotalOrder(["createdAt", "id"], "series", schema)).not.toBeNull();
  });

  it("is not satisfied by a field that merely looks like a key", () => {
    expect(isTotalOrder(["name"], "series", schema)).toBeNull();
    expect(isTotalOrder(["unit", "frequency"], "series", schema)).toBeNull();
  });
});
