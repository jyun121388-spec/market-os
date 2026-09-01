/**
 * Does the same request return its rows in the same ORDER every time?
 *
 * A different question from `recency-audit.ts`, and it exists because that audit could not see the
 * defect IR-113 turned out to be. Its rule is "does an arrival clock decide which row WINS", so a
 * `findMany` that returns a whole collection and selects nothing is either classified STRUCTURAL —
 * "orders presentation rather than deciding a winner here" — or, when it has no `orderBy` at all
 * and no first-element access, not reported by it at all.
 *
 * That is where IR-113 was. `findSeriesFactors` in `askMarket.ts` reads its candidates with no
 * `orderBy`, so when two providers report the same indicator the factors come back in whatever
 * order Postgres chose. Both figures are correct and both are attributed; the ORDER is not stable,
 * and one integration assertion picked the other one on 2026-09-01 and failed.
 *
 * ## WHAT COUNTS AS DETERMINISTIC
 *
 * A TOTAL order: the ordering keys must end in something that cannot tie. In practice that means
 * they include a field of some unique key on the model — `id` is the usual one. `[periodEnd desc]`
 * is not total, because two rows can share a period end and the database is then free to return
 * them in either order. `[periodEnd desc, id asc]` is.
 *
 * Uniqueness comes from `prisma/schema.prisma` and the migration DDL, through the same parser the
 * cardinality audit uses. One authority, not a second copy.
 *
 * ## WHAT THIS DOES NOT SAY
 *
 * Nondeterministic order is not automatically a defect. A set the caller aggregates, sorts again,
 * or reduces to a single number does not care. This reports the property and names where it
 * reaches a caller; deciding which of those matter is a reading task, not something to infer from
 * the query shape. Every site is emitted, and an unreadable one is UNKNOWN rather than dropped.
 *
 *   npx tsx scripts/presentation-order.ts [--json]
 */

import * as path from "node:path";
import * as ts from "typescript";
import { parseSchema, type Schema } from "./recency-cardinality";

type Determinism = "TOTAL_ORDER" | "PARTIAL_ORDER" | "NO_ORDER" | "UNKNOWN";

interface Site {
  file: string;
  line: number;
  enclosing: string;
  model: string;
  method: string;
  keys: string[];
  determinism: Determinism;
  why: string;
}

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

function prismaCall(node: ts.CallExpression): { model: string; method: string } | null {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const receiver = callee.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return null;
  const root = receiver.expression;
  if (!ts.isIdentifier(root)) return null;
  if (root.text !== "prisma" && root.text !== "tx" && root.text !== "client") return null;
  return { model: receiver.name.text, method: callee.name.text };
}

function propOf(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const member of obj.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = member.name;
    const text = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
    if (text === name) return member.initializer;
  }
  return null;
}

/** Ordering key NAMES, in order, from object-literal property names only. */
function orderingKeys(expr: ts.Expression): string[] | null {
  const out: string[] = [];
  const fromObject = (o: ts.ObjectLiteralExpression): boolean => {
    for (const member of o.properties) {
      if (!ts.isPropertyAssignment(member)) return false;
      const key = member.name;
      if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return false;
      // A nested object is a relation ordering: `{ source: { code: "asc" } }`. It orders by a
      // field of ANOTHER model, which this cannot resolve to a uniqueness fact here, so the site
      // becomes UNKNOWN rather than being counted either way.
      if (ts.isObjectLiteralExpression(member.initializer)) return false;
      out.push(key.text);
    }
    return true;
  };
  if (ts.isObjectLiteralExpression(expr)) return fromObject(expr) ? out : null;
  if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) {
      if (!ts.isObjectLiteralExpression(el)) return null;
      if (!fromObject(el)) return null;
    }
    return out;
  }
  return null;
}

function enclosingName(node: ts.Node): string {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (
      (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
      cur.parent &&
      ts.isVariableDeclaration(cur.parent) &&
      ts.isIdentifier(cur.parent.name)
    ) {
      return cur.parent.name.text;
    }
    cur = cur.parent;
  }
  return "<module scope>";
}

/**
 * Do these ordering keys pin a TOTAL order?
 *
 * Two conditions, and the second was missing until review found it.
 *
 * COVERAGE. The ordering must contain every field of some unique key. Half of a compound key still
 * leaves ties.
 *
 * NON-NULLABILITY. Every field of that key must be declared non-null. PostgreSQL treats NULL as
 * distinct from NULL in an ordinary unique index, so a unique key containing a nullable column
 * admits MANY rows whose column is NULL — and ordering by the whole key then still ties on them.
 * This repository records that exact trap in its own schema: `Observation.revisionOf String?` sits
 * inside `@@unique([seriesId, observationDate, isRevision, revisionOf])`, and a hand-written
 * partial index exists precisely because that `@@unique` does not guarantee one original per
 * series and date.
 *
 * A PARTIAL index still proves nothing here, for the reason the cardinality audit settled: it does
 * not order the rows outside its predicate. So a nullable key is not rescued by the partial index
 * that compensates for it elsewhere — that index constrains a subset, and a total order is a
 * statement about all of them. Fail closed rather than reasoning about which rows are in scope.
 *
 * Nullability comes from the schema's own `Type?` marker, never from a field name, an `id`
 * convention, or whichever rule makes a site green.
 */
export function isTotalOrder(
  keys: readonly string[],
  model: string,
  schema: Schema,
): string | null {
  const present = new Set(keys);
  const nullable = schema.nullableFields.get(model) ?? new Set<string>();
  const uniqueKeys = schema.uniqueKeys.get(model) ?? [];
  for (const key of uniqueKeys) {
    if (key.partial) continue;
    if (!key.fields.every((f) => present.has(f))) continue;
    const nullableInKey = key.fields.filter((f) => nullable.has(f));
    if (nullableInKey.length > 0) {
      // Covered, and still not total. Skipped rather than returned, because another key on the
      // same model may yet prove it.
      continue;
    }
    return `${key.kind}${key.name ? ` ${key.name}` : ""}(${key.fields.join(", ")}) is fully in the ordering and every field is non-null, so no two rows can tie`;
  }
  return null;
}

/**
 * Why a covered key was rejected, for the report. Purely explanatory — it decides nothing.
 */
export function nullableBlockers(
  keys: readonly string[],
  model: string,
  schema: Schema,
): string | null {
  const present = new Set(keys);
  const nullable = schema.nullableFields.get(model) ?? new Set<string>();
  for (const key of schema.uniqueKeys.get(model) ?? []) {
    if (key.partial) continue;
    if (!key.fields.every((f) => present.has(f))) continue;
    const blockers = key.fields.filter((f) => nullable.has(f));
    if (blockers.length > 0) {
      return (
        `${key.kind}(${key.fields.join(", ")}) is fully in the ordering, but ${blockers.join(", ")} ` +
        `is nullable and PostgreSQL treats NULL as distinct from NULL, so rows holding NULL there can still tie`
      );
    }
  }
  return null;
}

export function auditPresentationOrder(injected?: Schema): Site[] {
  const schema = injected ?? parseSchema();
  const program = loadProgram();
  const sites: Site[] = [];
  const root = path.resolve("src/server").replace(/\\/g, "/");

  for (const sf of program.getSourceFiles()) {
    const file = sf.fileName.replace(/\\/g, "/");
    if (sf.isDeclarationFile || !file.startsWith(root)) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const pc = prismaCall(node);
        // `findMany` only: it is the shape that hands a caller more than one row, and order is a
        // property of a sequence. `findFirst` and aggregates are the cardinality audit's business.
        if (pc && pc.method === "findMany") {
          const arg = node.arguments[0];
          const obj = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
          const orderBy = obj ? propOf(obj, "orderBy") : null;
          const keys = orderBy === null ? [] : orderingKeys(orderBy);

          let determinism: Determinism;
          let why: string;
          if (keys === null) {
            determinism = "UNKNOWN";
            why = "the ordering could not be read structurally (dynamic, or a relation ordering)";
          } else if (keys.length === 0) {
            determinism = "NO_ORDER";
            why = "no `orderBy` at all: the sequence is whatever the database returned";
          } else {
            const total = isTotalOrder(keys, pc.model, schema);
            if (total) {
              determinism = "TOTAL_ORDER";
              why = total;
            } else {
              determinism = "PARTIAL_ORDER";
              why =
                nullableBlockers(keys, pc.model, schema) ??
                `ordered by ${keys.join(", ")}, none of which completes a unique key, so rows that tie can come back in either order`;
            }
          }

          sites.push({
            file: file.slice(root.length + 1),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            enclosing: enclosingName(node),
            model: pc.model,
            method: pc.method,
            keys: keys ?? [],
            determinism,
            why,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return sites;
}

if (process.argv[1] && process.argv[1].includes("presentation-order")) {
  const sites = auditPresentationOrder();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(sites, null, 2));
  } else {
    const counts = new Map<string, number>();
    for (const s of sites) counts.set(s.determinism, (counts.get(s.determinism) ?? 0) + 1);
    console.log(`findMany SITES: ${sites.length}\n`);
    for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)}  ${k}`);
    }
    for (const kind of ["NO_ORDER", "PARTIAL_ORDER", "UNKNOWN", "TOTAL_ORDER"] as Determinism[]) {
      const group = sites.filter((s) => s.determinism === kind);
      if (group.length === 0) continue;
      console.log(`\n== ${kind} (${group.length}) ==`);
      for (const s of group) {
        console.log(`  ${s.file}:${s.line}  ${s.enclosing}()  prisma.${s.model}.findMany`);
        console.log(`      ${s.why}`);
      }
    }
  }
}
