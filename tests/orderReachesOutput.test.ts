import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import {
  auditOrderReach,
  isProvenOrderIndependentCallback,
  ORDER_BLIND,
  PRESERVES,
} from "../scripts/order-reaches-output";
import { auditPresentationOrder } from "../scripts/presentation-order";

/**
 * Which nondeterministic sequences can a reader actually see.
 *
 * `presentation-order` reports 34 sites whose order is not total and deliberately refuses to call
 * that a defect. This narrows it: a set the caller aggregates or re-sorts does not care what order
 * it arrived in, and one that is mapped or returned does.
 */

const rows = auditOrderReach();
const at = (file: string, line: number) => {
  const row = rows.find((r) => r.file === file && r.line === line);
  if (!row) throw new Error(`no examined site at ${file}:${line} — the audit's scope moved`);
  return row;
};

describe("whether a nondeterministic order reaches a caller", () => {
  it("examines a non-empty set with more than one verdict", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.reach)).size).toBeGreaterThan(1);
  });

  /**
   * THE REGRESSION CONTROL, and it exists because this exact bug shipped once.
   *
   * `node.parent` is set by BINDING, and binding happens when the type checker is created. Without
   * `program.getTypeChecker()` every parent pointer is undefined — so the enclosing function is
   * never found, the result binding is never resolved, and EVERY site comes back with the same
   * "not bound to a name this can follow". The first run of this audit returned 34 of 34 like that
   * and it looked like a finding.
   *
   * Uniformity was the tell. These two assertions encode it: the reasons must not all be identical,
   * and enclosing names must actually resolve.
   */
  it("resolves parents, so a uniform empty answer cannot pass as a result", () => {
    expect(new Set(rows.map((r) => r.why)).size).toBeGreaterThan(1);
    const named = rows.filter((r) => r.enclosing !== "<module scope>");
    expect(named.length, "no enclosing function resolved — parent pointers are missing").toBe(
      rows.length,
    );
  });

  it("finds the IR-113 site, and finds that its order survives", () => {
    const site = at("domain/askMarket.ts", 935);
    expect(site.reach).toBe("ORDER_SURVIVES");
    expect(site.determinism).toBe("NO_ORDER");
    expect(site.enclosing).toBe("matchingSeries");
  });

  it("examines exactly the sites the presentation audit called non-total", () => {
    // Scope, asserted rather than assumed: a TOTAL_ORDER site has nothing to ask about, and one
    // leaking in would mean the two audits disagree about their own boundary.
    const nonTotal = auditPresentationOrder().filter((s) => s.determinism !== "TOTAL_ORDER");
    expect(rows.length).toBe(nonTotal.length);
    for (const row of rows) {
      expect(row.determinism, `${row.file}:${row.line}`).not.toBe("TOTAL_ORDER");
    }
  });

  /**
   * UNREAD must read as unexamined, not as safe.
   *
   * The audit's bound is real — it never follows a value out of its own function — so the honest
   * failure mode is a bucket that says "I did not look far enough", and the wording has to keep
   * saying that. A future tidy-up that renamed it to something reassuring would turn a declared
   * limit into a silent claim.
   */
  it("says why it could not classify, every time it could not", () => {
    for (const row of rows) {
      if (row.reach !== "UNREAD") continue;
      expect(row.why.length, `${row.file}:${row.line} gives no reason`).toBeGreaterThan(20);
    }
  });
});

/**
 * WHICH OPERATIONS ARE ALLOWED TO DISCHARGE A SITE, as a contract rather than an implementation
 * detail — the set IS the rule, so it is what a control has to bind.
 *
 * The first version listed `find`, `findIndex`, `reduce`, `reduceRight`, `sort`, `toSorted`,
 * `Object.fromEntries`, `Map` and `Set` as discarding arrival order. Review was right that every
 * one of those can carry it into the result, and the current corpus reports zero
 * `ORDER_DISCARDED`, so nothing was falsely cleared — this is a mechanism defect that would have
 * become a wrong answer the moment a row reached one of those shapes.
 */
describe("what may discharge a site as order-blind", () => {
  it("admits unconditionally only a count and a value-only membership test", () => {
    // `some` and `every` were here and are not any more: they short-circuit and run user code, so
    // the method name proves nothing about whether arrival order reaches the result.
    expect([...ORDER_BLIND].sort()).toEqual(["includes", "length"]);
    expect(ORDER_BLIND.has("some")).toBe(false);
    expect(ORDER_BLIND.has("every")).toBe(false);
  });

  it("refuses every operation whose result can depend on which row came first", () => {
    for (const op of [
      // returns the FIRST match
      "find",
      "findIndex",
      "indexOf",
      "at",
      // order-dependent unless proven associative-commutative, which nothing here proves
      "reduce",
      "reduceRight",
      // stable sorts preserve input order among comparator ties
      "sort",
      "toSorted",
    ]) {
      expect(ORDER_BLIND.has(op), `${op} must not discharge a site`).toBe(false);
      expect(PRESERVES.has(op), `${op} must be treated as letting order through`).toBe(true);
    }
  });

  it("treats duplicate-key collectors as order-sensitive, not as discarding", () => {
    // `Object.fromEntries`, `new Map`, `new Set`: a duplicate key means last-wins, so which value
    // survives is decided by arrival order, and their iteration order IS insertion order.
    for (const op of ["fromEntries", "Map", "Set"]) {
      expect(ORDER_BLIND.has(op), `${op} must not discharge a site`).toBe(false);
    }
  });

  it("reports no site as discharged unless every use is order-blind", () => {
    // The corpus-level consequence: today nothing is ORDER_DISCARDED, and any row that becomes so
    // must have earned it under the narrow rule above rather than under the old broad one.
    for (const row of rows) {
      if (row.reach !== "ORDER_DISCARDED") continue;
      expect(row.why).toContain("order-blind");
    }
  });
});

/**
 * `some` / `every` discharge a site ONLY with a callback proven order-independent.
 *
 * Review's point: the method name is not the behaviour. A callback that mutates captured state,
 * throws, reads its index or calls anything of unknown purity behaves differently depending on
 * which row arrives first, and short-circuiting is what makes that observable.
 *
 * Purity is proven from the callback's own SHAPE — a whitelist of expression forms over its single
 * parameter. A name whitelist was available and is exactly what was forbidden, for the same reason
 * the method-name whitelist failed one level up.
 */
describe("when a short-circuiting predicate may discharge a site", () => {
  const callbackOf = (src: string): ts.Node => {
    const sf = ts.createSourceFile("t.ts", `x.some(${src});`, ts.ScriptTarget.ES2020, true);
    let found: ts.Node | null = null;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.arguments.length === 1) found = n.arguments[0];
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!found) throw new Error(`no callback parsed from ${src}`);
    return found;
  };
  const proven = (src: string) => isProvenOrderIndependentCallback(callbackOf(src));

  it("proves a comparison over the element alone", () => {
    expect(proven("(r) => r.value > 10")).toBe(true);
    expect(proven('(r) => r.code === "FRED"')).toBe(true);
    expect(proven("(r) => !r.stale")).toBe(true);
    expect(proven("(r) => r.a === 1 && r.b < 2")).toBe(true);
  });

  it("refuses a callback that mutates captured state", () => {
    // The short-circuit makes HOW MANY times this runs depend on arrival order, so the counter
    // ends up different even when the boolean does not.
    expect(proven("(r) => { seen += 1; return r.ok; }")).toBe(false);
    expect(proven("(r) => (seen = r.id)")).toBe(false);
    expect(proven("(r) => count++ > 0")).toBe(false);
  });

  it("refuses a callback that can throw or call anything", () => {
    expect(proven("(r) => { throw new Error(r.id); }")).toBe(false);
    expect(proven("(r) => check(r)")).toBe(false);
    expect(proven("(r) => r.name.startsWith('A')")).toBe(false);
    expect(proven("(r) => Date.now() > r.at")).toBe(false);
  });

  it("refuses a callback that can read its position", () => {
    // The index and the array parameters make arrival order directly legible.
    expect(proven("(r, i) => i === 0")).toBe(false);
    expect(proven("(r, i, all) => all.length > 1")).toBe(false);
  });

  it("refuses a callback that reads anything but the element", () => {
    expect(proven("(r) => r.id === wanted")).toBe(false);
    expect(proven("(r) => globalThis.flag")).toBe(false);
  });

  it("refuses a non-callback argument outright", () => {
    expect(proven("predicate")).toBe(false);
    expect(proven("...rest")).toBe(false);
  });
});
