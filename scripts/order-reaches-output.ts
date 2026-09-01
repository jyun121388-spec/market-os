/**
 * Of the sequences whose order is not deterministic, WHICH ONES can a reader see?
 *
 * `scripts/presentation-order.ts` reports 34 `findMany` sites whose order is not total, and says
 * outright that this is a property rather than a verdict: a set the caller aggregates, re-sorts, or
 * reduces to one number does not care what order it arrived in. It also says deciding which of
 * them matter is a reading task. This is that reading task, done structurally so it converges on a
 * short list instead of producing another long one.
 *
 * ## THE BOUND, DECLARED RATHER THAN IMPLIED
 *
 * This looks only at how the result BINDING is used inside its own enclosing function. It does not
 * follow the value across function boundaries, through a returned object into a caller, or into a
 * closure captured elsewhere. That bound is why the third verdict exists: a site whose consumption
 * cannot be read here is UNREAD, not "fine".
 *
 * An interprocedural version would be more complete and much easier to be quietly wrong about. The
 * useful output today is a short list of sites where the nondeterminism demonstrably survives to a
 * caller, plus an honest count of the ones this cannot see.
 *
 *   ORDER_DISCARDED   every use is ORDER-BLIND: a boolean over the whole set (`.some`, `.every`,
 *                     `.includes`) or a count (`.length`). Nothing else qualifies — see
 *                     `ORDER_BLIND` for why `find`, `reduce`, `sort`, `Map` and `fromEntries` were
 *                     all removed from this list after review.
 *   ORDER_SURVIVES    the sequence is returned, mapped, spread or pushed onward, OR consumed by
 *                     something whose result depends on which row came first.
 *   UNREAD            the binding is used in a way this cannot classify, or not obviously used at
 *                     all in its own function.
 *
 *   npx tsx scripts/order-reaches-output.ts [--json]
 */

import * as path from "node:path";
import * as ts from "typescript";
import { auditPresentationOrder } from "./presentation-order";

type Reach = "ORDER_DISCARDED" | "ORDER_SURVIVES" | "UNREAD";

interface Row {
  file: string;
  line: number;
  enclosing: string;
  model: string;
  determinism: string;
  reach: Reach;
  why: string;
}

/**
 * Operations whose observable result CANNOT depend on arrival order.
 *
 * Deliberately tiny, and it shrank after review. The first version listed `find`, `findIndex`,
 * `reduce`, `reduceRight`, `sort`, `toSorted`, `Object.fromEntries`, `Map` and `Set` as discarding,
 * and every one of those can carry arrival order into its result:
 *
 *   find / findIndex   return the FIRST match, so which of several matches you get is the order
 *   reduce             is order-dependent unless the operation is proven associative-commutative,
 *                      which nothing here proves
 *   fromEntries / Map  a duplicate key means last-wins, so which value survives is the order —
 *   / Set              and their iteration order IS insertion order, which is observable
 *   sort / toSorted    stable sorts preserve input order among comparator ties, so a partial
 *                      comparator lets arrival order through
 *
 * What is left is genuinely order-blind: a boolean over the whole set, or a count.
 */
export const ORDER_BLIND = new Set(["some", "every", "includes", "length"]);

/** Methods that carry order onward, whether by preserving it or by reading position from it. */
export const PRESERVES = new Set([
  "map",
  "filter",
  "flatMap",
  "slice",
  "concat",
  "forEach",
  "push",
  // Order-SENSITIVE rather than order-preserving, and the distinction does not change the verdict:
  // either way the result can differ because the rows arrived differently.
  "find",
  "findIndex",
  "reduce",
  "reduceRight",
  "sort",
  "toSorted",
  "at",
  "indexOf",
]);

/**
 * Built once. `ts.createProgram` over this repository takes seconds and CREATING THE CHECKER makes
 * it slower still, so rebuilding per call turned three controls into 5s timeouts under suite load.
 * The program is identical every time; only the injected schema varies.
 */
let cachedProgram: ts.Program | null = null;

function loadProgram(): ts.Program {
  if (cachedProgram) return cachedProgram;
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram({ options: parsed.options, rootNames: parsed.fileNames });
  // BINDING IS WHAT SETS `node.parent`, and creating the checker is what binds. Without this line
  // every parent pointer is undefined, `enclosingName` silently answers "<module scope>" for every
  // site, and any analysis that walks upward reports the same empty answer everywhere. That
  // uniformity is the tell: 34 of 34 sites returning one identical reason is a broken tool, not a
  // finding. The recency audit had a `getTypeChecker()` call it never otherwise used, and this is
  // what it was for.
  program.getTypeChecker();
  cachedProgram = program;
  return program;
}

/** The `const x = await prisma...` name this call is bound to, if it is bound to one. */
function boundName(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node;
  for (let d = 0; d < 3 && cur; d++) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    cur = cur.parent;
  }
  return null;
}

function enclosingFunction(node: ts.Node): ts.Node | null {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isFunctionExpression(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * How is `name` used inside `scope`?
 *
 * Every reference is looked at, and the STRONGEST reading wins: one use that carries order onward
 * makes the site ORDER_SURVIVES even if ten others discard it, because one is enough for a reader
 * to see the sequence. A site whose every use discards is ORDER_DISCARDED. Anything else is UNREAD.
 */
function classifyUses(name: string, scope: ts.Node, decl: ts.Node): { reach: Reach; why: string } {
  let survives: string | null = null;
  let discarded = 0;
  let unclassified = 0;
  let references = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      !decl.getFullText().includes(node.getText() + " =")
    ) {
      // Skip the declaration's own name node.
      if (node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name === node) {
        ts.forEachChild(node, visit);
        return;
      }
      references += 1;
      const parent = node.parent;
      // `x.method(...)`
      if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        const method = parent.name.text;
        if (ORDER_BLIND.has(method)) discarded += 1;
        else if (PRESERVES.has(method))
          survives = survives ?? `\`.${method}()\` lets the arrival order reach the result`;
        else unclassified += 1;
        ts.forEachChild(node, visit);
        return;
      }
      // `return x`, `[...x]`, `f(x)` where f is Map/Set/fromEntries, or a property value.
      if (parent && ts.isReturnStatement(parent)) {
        survives = survives ?? "returned directly";
      } else if (parent && ts.isSpreadElement(parent)) {
        survives = survives ?? "spread into another sequence";
      } else if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) {
        survives = survives ?? `assigned to \`${parent.name.getText()}\` on a returned object`;
      } else if (parent && ts.isCallExpression(parent)) {
        // `Object.fromEntries(x)`, `new Map(x)`, `new Set(x)` are NOT discarding: a duplicate key
        // means last-wins, and iteration order is insertion order. They are order-sensitive.
        const callee = parent.expression.getText();
        const last = callee.split(".").pop() ?? callee;
        if (ORDER_BLIND.has(last)) discarded += 1;
        else if (last === "fromEntries" || last === "Map" || last === "Set") {
          survives =
            survives ?? `passed to \`${last}\`, where duplicate keys make arrival order decide`;
        } else unclassified += 1;
      } else if (parent && ts.isForOfStatement(parent) && parent.expression === node) {
        // Iteration order is the arrival order; whether it matters depends on the body, which is
        // beyond this bound. Counted as unclassified rather than assumed either way.
        unclassified += 1;
      } else {
        unclassified += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);

  if (survives) return { reach: "ORDER_SURVIVES", why: survives };
  if (references === 0)
    return { reach: "UNREAD", why: "no reference found in the enclosing function" };
  if (unclassified === 0 && discarded > 0) {
    return {
      reach: "ORDER_DISCARDED",
      why: `every one of ${discarded} use(s) is order-blind — a boolean over the whole set, or a count`,
    };
  }
  return {
    reach: "UNREAD",
    why: `${unclassified} of ${references} use(s) could not be classified within the enclosing function`,
  };
}

export function auditOrderReach(): Row[] {
  const nonTotal = auditPresentationOrder().filter((s) => s.determinism !== "TOTAL_ORDER");
  const wanted = new Set(nonTotal.map((s) => `${s.file}:${s.line}`));
  const program = loadProgram();
  const rows: Row[] = [];
  const root = path.resolve("src/server").replace(/\\/g, "/");

  for (const sf of program.getSourceFiles()) {
    const file = sf.fileName.replace(/\\/g, "/");
    if (sf.isDeclarationFile || !file.startsWith(root)) continue;
    const rel = file.slice(root.length + 1);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const key = `${rel}:${line}`;
        if (wanted.has(key)) {
          const site = nonTotal.find((s) => `${s.file}:${s.line}` === key)!;
          const name = boundName(node);
          const scope = enclosingFunction(node);
          const { reach, why } =
            name === null || scope === null
              ? {
                  reach: "UNREAD" as const,
                  why:
                    name === null
                      ? "the result is not bound to a name this can follow"
                      : "no enclosing function to read the uses in",
                }
              : classifyUses(name, scope, node);
          rows.push({
            file: rel,
            line,
            enclosing: site.enclosing,
            model: site.model,
            determinism: site.determinism,
            reach,
            why,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return rows;
}

if (process.argv[1] && process.argv[1].includes("order-reaches-output")) {
  const rows = auditOrderReach();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.reach, (counts.get(r.reach) ?? 0) + 1);
    console.log(`NON-TOTAL-ORDER SITES EXAMINED: ${rows.length}\n`);
    for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)}  ${k}`);
    }
    for (const kind of ["ORDER_SURVIVES", "UNREAD", "ORDER_DISCARDED"] as Reach[]) {
      const group = rows.filter((r) => r.reach === kind);
      if (group.length === 0) continue;
      console.log(`\n== ${kind} (${group.length}) ==`);
      for (const r of group) {
        console.log(`  ${r.file}:${r.line}  ${r.enclosing}()  ${r.model}  [${r.determinism}]`);
        console.log(`      ${r.why}`);
      }
    }
    console.log(
      "\nBOUND: uses are read only inside the enclosing function. Nothing here follows a value\n" +
        "into a caller, so UNREAD means unexamined rather than safe.",
    );
  }
}
