import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  auditOrderReach,
  type FieldAuthority,
  isProvenOrderIndependentCallback,
  NO_FIELD_AUTHORITY,
  ORDER_BLIND,
  PRESERVES,
  PRISMA_CLIENT_OUTPUT,
  prismaRowAuthority,
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
  /**
   * Admits every property read, so these controls test the SHAPE rules in isolation.
   *
   * That isolation is the point: with reads free, a control that still refuses proves the refusal
   * came from the expression form and not from the authority quietly refusing everything. The
   * authority itself is exercised separately below, where the reads are the subject.
   */
  const ALL_INERT: FieldAuthority = {
    provenance: () => "test double: every read admitted",
    isInertRead: () => true,
  };
  const proven = (src: string) => isProvenOrderIndependentCallback(callbackOf(src), ALL_INERT);

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

  it("refuses a property CHAIN even when every read is admitted", () => {
    // Depth one, and this is a shape rule rather than an authority one, so it holds even with the
    // permissive double. The authority answers about a declared field of the row; it says nothing
    // about the shape of that field's VALUE, so `r.a.b` reads into something it never vouched for.
    expect(proven("(r) => r.a.b")).toBe(false);
    expect(proven("(r) => r.a.b.c === 1")).toBe(false);
    expect(proven("(r) => r.ok"), "depth one must still be reachable").toBe(true);
  });
});

/**
 * A PROPERTY READ IS NOT AN INERT READ, which is the defect `CHATGPT_VERIFIED` found in the repair
 * above — the same error one level down. The shape whitelist proved that `x.flag` is syntactically
 * a property access. It claimed order-independence, which is a statement about OBSERVABLE
 * BEHAVIOUR, and a `PropertyAccessExpression` node is not evidence about that.
 *
 * Reproduced before repairing, with getter-backed and proxy-backed rows under `.some()`:
 *
 *     forward   result=true  effects=[read:A, read:B]
 *     reversed  result=true  effects=[read:C, read:B]
 *
 * The boolean never moves. Which getters RUN does, because the predicate short-circuits.
 *
 * So the reads are now answered by a `FieldAuthority`, and these controls bind the authority rather
 * than the corpus — nothing in `src/server` is `ORDER_DISCARDED` today, so a green corpus run says
 * nothing whatsoever about this rule. That has now been true of three consecutive defects here.
 */
describe("when a property read must be proven inert", () => {
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

  /** Admits exactly the named fields: a stand-in for "declared inert data field, and nothing else". */
  const onlyInert = (fields: string[]): FieldAuthority => ({
    provenance: () => `test double: ${fields.join(", ") || "nothing"}`,
    isInertRead: (_receiver, field) => fields.includes(field),
  });

  it("refuses the read when no authority can vouch for it", () => {
    // The fail-closed default. An absent authority must never read as a permissive one.
    expect(isProvenOrderIndependentCallback(callbackOf("(r) => r.flag"), NO_FIELD_AUTHORITY)).toBe(
      false,
    );
    expect(
      isProvenOrderIndependentCallback(callbackOf('(r) => r.code === "X"'), NO_FIELD_AUTHORITY),
    ).toBe(false);
  });

  it("refuses a field the authority does not vouch for, and admits one it does", () => {
    const authority = onlyInert(["code"]);
    expect(isProvenOrderIndependentCallback(callbackOf('(r) => r.code === "X"'), authority)).toBe(
      true,
    );
    // Same expression SHAPE, different field. If the shape were still deciding, this would pass.
    expect(isProvenOrderIndependentCallback(callbackOf('(r) => r.flag === "X"'), authority)).toBe(
      false,
    );
    // One unvouched read anywhere in the expression is enough to refuse the whole callback.
    expect(
      isProvenOrderIndependentCallback(callbackOf("(r) => r.code === r.flag"), authority),
    ).toBe(false);
  });

  /**
   * The ATTACK CONTROL, run against the real checker-backed authority rather than a double.
   *
   * A getter and a Proxy are the two ways a declared-looking read executes user code. The getter is
   * visible to the checker as a `GetAccessor`, so the authority can refuse it outright. The Proxy
   * is not visible to any checker, which is why the audit ALSO requires the array to be a `const`
   * binding of the query result — no interposition point, nowhere to wrap the rows. Neither half
   * would be enough alone and the limitation is recorded rather than papered over.
   */
  it("refuses a getter-backed read and admits a generated Prisma field", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "order-reach-authority-"));
    const fixture = path.join(dir, "fixture.ts");
    const client = path.resolve(PRISMA_CLIENT_OUTPUT, "client.ts").replace(/\\/g, "/");

    // A getter declared at a path the PROVENANCE rule accepts, so that the two halves of the
    // authority can be told apart. Without it a getter outside the client is refused twice over
    // and either rule could be doing all the work while the other is decorative — which is the
    // failure mode this file has already shipped once.
    const shadow = path.join(dir, "src", "generated", "prisma");
    fs.mkdirSync(shadow, { recursive: true });
    fs.writeFileSync(
      path.join(shadow, "rowlike.ts"),
      "export type RowLike = { id: string; get flag(): boolean };\n",
      "utf8",
    );

    fs.writeFileSync(
      fixture,
      [
        `import type { Source } from "${client.replace(/\.ts$/, "")}";`,
        `import type { RowLike } from "${path.join(shadow, "rowlike").replace(/\\/g, "/")}";`,
        "declare const rows: Source[];",
        "declare const hostile: { id: string; get flag(): boolean }[];",
        "declare const plain: { id: string; flag: boolean }[];",
        "declare const shadowed: RowLike[];",
        'export const a = rows.some((r) => r.code === "X");',
        "export const b = hostile.some((r) => r.flag);",
        "export const c = plain.some((r) => r.flag);",
        "export const d = shadowed.some((r) => r.flag);",
      ].join("\n"),
      "utf8",
    );

    const program = ts.createProgram({
      rootNames: [fixture],
      options: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
    });
    const authority = prismaRowAuthority(program.getTypeChecker());
    const sf = program.getSourceFile(fixture)!;

    const callbacks: ts.Node[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isArrowFunction(n)) callbacks.push(n);
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(callbacks.length, "fixture must parse four callbacks").toBe(4);

    const [prismaRow, getterBacked, handWritten, shadowedGetter] = callbacks;

    // POSITIVE: a real generated field resolves to a PropertySignature under the client output.
    expect(
      isProvenOrderIndependentCallback(prismaRow, authority),
      "a declared Prisma scalar field is an inert read and must discharge",
    ).toBe(true);

    // ATTACK: the getter resolves to a GetAccessor. Reading it runs user code.
    expect(
      isProvenOrderIndependentCallback(getterBacked, authority),
      "a getter-backed read executes user code and must NOT discharge",
    ).toBe(false);

    // And provenance is load-bearing on its own: this one IS a PropertySignature, just not one the
    // generated client declares, so nothing vouches for the object that arrives at runtime.
    expect(
      isProvenOrderIndependentCallback(handWritten, authority),
      "a plain field outside the generated client has no source contract behind it",
    ).toBe(false);

    // ISOLATION: right path, wrong declaration kind. Only the accessor rule can refuse this one,
    // so if it were dropped this control — and nothing else here — would go green.
    expect(
      isProvenOrderIndependentCallback(shadowedGetter, authority),
      "an accessor is user code wherever it is declared; provenance does not excuse it",
    ).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("names the contract it relied on, so a discharge is never anonymous", () => {
    expect(NO_FIELD_AUTHORITY.provenance()).toMatch(/none/);
  });
});
