/**
 * CARDINALITY of the candidate set, for every site the recency audit left UNCLASSIFIED.
 *
 * `[CHATGPT_TASK][MARKET-SEMANTIC-RECENCY-CARDINALITY-20260901]`. `scripts/recency-audit.ts`
 * reported 47 sites, 0 `ARRIVAL_DECIDES`, and 15 `UNCLASSIFIED` — mostly unordered `findFirst` and
 * first-element selections, where the winner is whatever the database returned. That is only a
 * defect if the candidate set can hold more than one row, and the audit could not say. This
 * answers exactly that, and nothing else.
 *
 * WHAT COUNTS AS PROOF, and the point is what does NOT:
 *
 *     `findFirst`, `[0]`, an insertion-ordered id, `createdAt`, `retrievedAt`, or the order the
 *     database happened to return ARE NOT CARDINALITY PROOF. They are the thing being audited.
 *
 * The only accepted proof is a uniqueness constraint the `where` predicate pins by literal
 * EQUALITY on every one of its fields, AND which actually applies to every candidate. A TOTAL
 * index applies unconditionally. A PARTIAL index applies only where its predicate holds, so it
 * proves nothing alone — it counts only as part of a set whose predicates PARTITION the domain
 * (`IS NULL` together with `IS NOT NULL` on one column) with every branch fully pinned. See
 * `proveSingleRow`; an earlier version decided on field presence and merely warned about the
 * predicate in prose, which review correctly called unsound.
 *
 * There are TWO authorities on uniqueness, and the second was learned the hard way. `schema.prisma`
 * gives `@id`, `@unique`, `@@id`, `@@unique`. MIGRATION DDL gives `CREATE UNIQUE INDEX`, including
 * partial ones that Prisma cannot express — and reading only the first made this audit report a
 * defect that the real database refused to reproduce. A relation whose target field is unique also
 * determines its foreign key, and that join is cited rather than assumed.
 *
 * Everything else fails closed:
 *
 *     CARDINALITY_ONE_PROVEN   a named schema key is fully pinned by equality
 *     MULTI_CANDIDATE          no key is pinned; the predicate can admit more than one row
 *     UNPROVEN_FAIL_CLOSED     the predicate could not be read structurally -- spread, helper,
 *                              computed key, or a filter operator this cannot interpret
 *
 * `MULTI_CANDIDATE` is a STATIC finding and deliberately not called `MULTI_CANDIDATE_REPRODUCED`.
 * Promotion to that name requires an actual discriminating pair against a real database, which is
 * a separate step and is not claimed here.
 *
 * Structural throughout, like the audit it extends: the schema is parsed for keys, the `where` is
 * read from object-literal AST members, and no text proximity is used anywhere.
 *
 *   npx tsx scripts/recency-cardinality.ts [--json]
 */

import * as path from "node:path";
import * as ts from "typescript";

type Verdict = "CARDINALITY_ONE_PROVEN" | "MULTI_CANDIDATE" | "UNPROVEN_FAIL_CLOSED";

export interface UniqueKey {
  kind: "@id" | "@unique" | "@@id" | "@@unique" | "MIGRATION_UNIQUE_INDEX";
  fields: string[];
  /** For a PARTIAL index, the SQL predicate it only holds under. */
  partial?: string;
  name?: string;
}

/**
 * Unique indexes created by MIGRATION DDL rather than declared in the schema model.
 *
 * This exists because the first version of this audit was WRONG, and a real-database control is
 * what caught it. It read only the model blocks, found no `@@unique` on `FinancialFact`, and
 * reported `edgar-xbrl/ingest.ts:61` as MULTI_CANDIDATE. Inserting the two rows it claimed the
 * database would accept produced `Unique constraint failed`.
 *
 * The identity of a financial fact includes `periodStart`, which is NULL for instant concepts, and
 * Postgres treats NULL as distinct from NULL in a unique index. So it cannot be a Prisma
 * `@@unique` at all: migration `20260817230000_financial_fact_period_start_identity` enforces it as
 * TWO PARTIAL indexes, one `WHERE periodStart IS NOT NULL` and one `WHERE periodStart IS NULL`.
 *
 * The lesson is about the audit rather than the schema: `schema.prisma` is not the only structural
 * authority on uniqueness, and an audit that treats it as complete under-reports constraints and
 * therefore OVER-reports defects. Migration DDL is read here as the second authority, and a
 * partial index is recorded WITH its predicate — it proves single-row only under that predicate,
 * and saying so is the difference between a citation and a claim.
 */
function migrationUniqueIndexes(tableToModel: Map<string, string>): Map<string, UniqueKey[]> {
  // Migrations are a SEQUENCE, and the first version of this ignored that. It reported
  // `financial_facts_sourceId_corpCode_concept_unit_periodEnd_ac_key` as live authority when the
  // very migration that introduced the partial indexes DROPS it. Right verdict, dead citation --
  // and a citation nobody can look up is not a proof.
  const files = ts.sys.readDirectory("prisma/migrations", [".sql"]).sort();
  const byName = new Map<string, { table: string; key: UniqueKey }>();
  const dynamicallyDropped = new Set<string>();

  for (const file of files) {
    const sql = ts.sys.readFile(file);
    if (sql === undefined) continue;
    // These migrations quote the SQL they replace, so an unstripped scan reads a dropped
    // constraint as live.
    const live = sql
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");

    // A DO block that drops indexes by SHAPE cannot be resolved statically. Rather than trust the
    // remaining CREATEs for that table, every migration-derived key on it becomes unusable as
    // proof -- fail closed, because the alternative is citing an index that may not exist.
    for (const block of live.match(/DO\s+\$\$[\s\S]*?\$\$;/gi) ?? []) {
      if (!/DROP\s+INDEX/i.test(block)) continue;
      for (const t of block.match(/relname\s*=\s*'(\w+)'/gi) ?? []) {
        const name = /'(\w+)'/.exec(t)?.[1];
        if (name) dynamicallyDropped.add(name);
      }
    }

    for (const d of live.match(/DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+"?([\w-]+)"?/gi) ?? []) {
      const name = /"?([\w-]+)"?\s*$/.exec(d.trim())?.[1];
      if (name) byName.delete(name);
    }

    const re =
      // No `s` flag: the tsconfig target predates it. `[^;]` already spans newlines, and the
      // column list and WHERE clause of these indexes are written across lines.
      /CREATE\s+UNIQUE\s+INDEX\s+"?([\w-]+)"?\s+ON\s+"?(\w+)"?\s*\(([^)]*)\)\s*(WHERE[^;]*)?;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(live)) !== null) {
      const [, name, table, cols, where] = m;
      byName.set(name, {
        table,
        key: {
          kind: "MIGRATION_UNIQUE_INDEX",
          name,
          fields: cols
            .split(",")
            .map((c) => c.trim().replace(/^"|"$/g, ""))
            .filter(Boolean),
          partial: where ? where.replace(/\s+/g, " ").trim() : undefined,
        },
      });
    }
  }

  const out = new Map<string, UniqueKey[]>();
  for (const { table, key } of byName.values()) {
    // A table whose indexes were dropped by shape keeps only its PARTIAL indexes as proof: the DO
    // block in this repository explicitly spares `indpred IS NOT NULL`, and a full index on such a
    // table cannot be shown to have survived.
    if (dynamicallyDropped.has(table) && !key.partial) continue;
    const model = tableToModel.get(table);
    if (!model) continue;
    out.set(model, [...(out.get(model) ?? []), key]);
  }
  return out;
}

/**
 * A relation navigation, so `{ source: { code: "FRED" } }` can be resolved to the scalar it pins.
 *
 * Both this and the unique keys come from `prisma/schema.prisma`, which is the canonical structural
 * authority a proof has to cite. Restating either in TypeScript would be the second
 * hand-maintained copy that drifts — the same rule the gate-ownership unit settled.
 *
 * This is the "relation invariant" the task names alongside schema constraints, and without it the
 * audit fails closed on two real sites that ARE provably single-row:
 * `series.findFirst({ where: { externalId, source: { code } } })` pins `Series.sourceId` — because
 * `Source.code` is `@unique`, exactly one Source has that code — and `@@unique(sourceId,
 * externalId)` is then fully pinned. The proof is two schema facts joined, not an assumption, and
 * the audit cites both.
 */
interface Relation {
  field: string;
  target: string;
  fk: string[];
}

export interface Schema {
  uniqueKeys: Map<string, UniqueKey[]>;
  relations: Map<string, Relation[]>;
}

export function parseSchema(): Schema {
  const text = ts.sys.readFile("prisma/schema.prisma");
  if (text === undefined) throw new Error("prisma/schema.prisma not readable");
  const uniqueKeys = new Map<string, UniqueKey[]>();
  const relations = new Map<string, Relation[]>();
  const tableToModel = new Map<string, string>();
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(text)) !== null) {
    const [, name, body] = m;
    const keys: UniqueKey[] = [];
    const rels: Relation[] = [];
    let tableName: string | null = null;
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      const field = /^(\w+)\s+\S+/.exec(line);
      if (field && /@id\b/.test(line)) keys.push({ kind: "@id", fields: [field[1]] });
      if (field && /@unique\b/.test(line)) keys.push({ kind: "@unique", fields: [field[1]] });
      const bu = /^@@unique\(\[([^\]]+)\]/.exec(line);
      if (bu) keys.push({ kind: "@@unique", fields: bu[1].split(",").map((f) => f.trim()) });
      const bi = /^@@id\(\[([^\]]+)\]/.exec(line);
      if (bi) keys.push({ kind: "@@id", fields: bi[1].split(",").map((f) => f.trim()) });
      const map = /^@@map\("([^"]+)"\)/.exec(line);
      if (map) tableName = map[1];
      const rel = /^(\w+)\s+(\w+)\??\s+@relation\(fields:\s*\[([^\]]+)\]/.exec(line);
      if (rel) {
        rels.push({
          field: rel[1],
          target: rel[2][0].toLowerCase() + rel[2].slice(1),
          fk: rel[3].split(",").map((f) => f.trim()),
        });
      }
    }
    // Prisma models are PascalCase; the client property is camelCase.
    const key = name[0].toLowerCase() + name.slice(1);
    uniqueKeys.set(key, keys);
    relations.set(key, rels);
    tableToModel.set(tableName ?? name, key);
  }
  if (uniqueKeys.size === 0) throw new Error("no models parsed from the schema");

  // The migration DDL is the SECOND authority, merged in rather than replacing the first.
  const fromMigrations = migrationUniqueIndexes(tableToModel);
  let merged = 0;
  for (const [model, keys] of fromMigrations) {
    uniqueKeys.set(model, [...(uniqueKeys.get(model) ?? []), ...keys]);
    merged += keys.length;
  }
  if (merged === 0) {
    throw new Error(
      "no unique indexes parsed from prisma/migrations — the second authority is silently empty, which would under-report constraints and over-report defects",
    );
  }
  return { uniqueKeys, relations };
}

/**
 * The fields a `where` pins by literal EQUALITY, and whether anything defeated the reading.
 *
 * `{ id }` and `{ id: x }` pin `id`. `{ sourceId, receiptNo }` pins both. What does NOT pin:
 * a nested filter object (`{ gte: … }`, `{ in: … }`, `{ not: … }`), `OR`/`NOT`/`some`, a spread,
 * a computed property name, or anything this cannot resolve to a plain field. Those set
 * `opaque`, which forces `UNPROVEN_FAIL_CLOSED` rather than a guess.
 *
 * `AND` is descended into, because `{ AND: [{ a: 1 }, { b: 2 }] }` genuinely pins both.
 */
function equalityFields(
  expr: ts.Expression,
  model: string,
  schema: Schema,
): { fields: Set<string>; opaque: string | null; via: string[] } {
  const fields = new Set<string>();
  const via: string[] = [];
  let opaque: string | null = null;

  const walk = (e: ts.Expression): void => {
    if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) if (ts.isExpression(el)) walk(el);
      return;
    }
    if (!ts.isObjectLiteralExpression(e)) {
      opaque = opaque ?? `predicate is not an object literal (${ts.SyntaxKind[e.kind]})`;
      return;
    }
    for (const member of e.properties) {
      if (ts.isSpreadAssignment(member)) {
        opaque = opaque ?? "predicate carries a spread, so its fields are not statically known";
        continue;
      }
      const nameNode = ts.isPropertyAssignment(member) ? member.name : member.name;
      if (!nameNode || ts.isComputedPropertyName(nameNode)) {
        opaque = opaque ?? "predicate has a computed key";
        continue;
      }
      const key =
        ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) ? nameNode.text : "<unknown>";

      if (key === "AND") {
        if (ts.isPropertyAssignment(member)) walk(member.initializer);
        continue;
      }
      if (key === "OR" || key === "NOT" || key === "none" || key === "some" || key === "every") {
        opaque = opaque ?? `predicate uses \`${key}\`, which does not pin a field to one value`;
        continue;
      }
      // Shorthand `{ id }` is an equality on `id`.
      if (ts.isShorthandPropertyAssignment(member)) {
        fields.add(key);
        continue;
      }
      if (!ts.isPropertyAssignment(member)) {
        opaque = opaque ?? "predicate member is neither an assignment nor shorthand";
        continue;
      }
      const init = member.initializer;
      // A nested object under a field is a FILTER, not an equality: `{ retrievedAt: { gte: t } }`.
      if (ts.isObjectLiteralExpression(init)) {
        const inner = init.properties
          .map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : "?"))
          .join(",");
        if (init.properties.length === 1 && inner === "equals") {
          fields.add(key);
          continue;
        }
        // A RELATION navigation, resolved rather than refused. `{ source: { code: X } }` pins the
        // foreign key iff the field it filters on is unique on the target model -- then exactly one
        // target row matches and the FK is determined. Both schema facts are recorded in `via` so
        // the verdict cites them instead of asserting the join.
        const relation = (schema.relations.get(model) ?? []).find((r) => r.field === key);
        if (relation && init.properties.length === 1) {
          const targetKeys = schema.uniqueKeys.get(relation.target) ?? [];
          const hit = targetKeys.find((k) => k.fields.length === 1 && k.fields[0] === inner);
          if (hit) {
            for (const fk of relation.fk) fields.add(fk);
            via.push(
              `${relation.field} -> ${relation.target}.${hit.kind}(${inner}) determines ${relation.fk.join(", ")}`,
            );
            continue;
          }
        }
        opaque = opaque ?? `\`${key}\` uses a filter object (${inner}) rather than an equality`;
        continue;
      }
      fields.add(key);
    }
  };

  walk(expr);
  return { fields, opaque, via };
}

export interface Row {
  file: string;
  line: number;
  enclosing: string;
  model: string;
  method: string;
  shape: string;
  whereFields: string[];
  verdict: Verdict;
  citation: string;
}

/**
 * The TypeScript program, built once.
 *
 * `ts.createProgram` over this repository takes seconds, and the controls call `auditCardinality`
 * three times with different schemas. Rebuilding it each time made those tests pass alone and time
 * out under full-suite load — the program is identical every call, only the schema varies.
 */
let cachedProgram: ts.Program | null = null;

function loadProgram(): ts.Program {
  if (cachedProgram) return cachedProgram;
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
  cachedProgram = ts.createProgram({ options: parsed.options, rootNames: parsed.fileNames });
  return cachedProgram;
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

/** Does this call SELECT one row out of many? Ordered sites are the recency audit's business. */
function selectsOneRow(
  node: ts.CallExpression,
  method: string,
  arg: ts.ObjectLiteralExpression | null,
): boolean {
  if (method === "findFirst" || method === "findFirstOrThrow") return true;
  if (arg && propOf(arg, "distinct")) return true;
  let cur: ts.Node = node;
  for (let d = 0; d < 4 && cur.parent; d++) {
    cur = cur.parent;
    if (ts.isElementAccessExpression(cur) && cur.argumentExpression.getText() === "0") return true;
    if (ts.isVariableDeclaration(cur) && ts.isArrayBindingPattern(cur.name)) return true;
  }
  return false;
}

/**
 * Does a UNIQUENESS AUTHORITY actually prove at most one row, given what the query pins?
 *
 * The first version of this decided on field presence alone —
 * `keys.find((k) => k.fields.every((f) => fields.has(f)))` — and, when the winner was a PARTIAL
 * index, appended prose saying it "holds only WHERE …". Review was right that this is unsound: a
 * warning in a citation is not a proof. A partial index constrains only the rows satisfying its
 * predicate, so pinning its columns says nothing about a candidate that falls outside it.
 *
 * Two things now count, and nothing else does.
 *
 * TOTAL INDEX. A non-partial key whose every field is pinned. At most one row, unconditionally.
 *
 * UNION OF PARTITIONS. Partial indexes whose predicates PARTITION the domain of one field —
 * `IS NULL` and `IS NOT NULL` on the same column — where EVERY branch has an index with all its
 * fields pinned. Then whichever branch a candidate falls into, some index makes it unique, so the
 * whole domain is covered. That is the real shape in this repository: the identity of a financial
 * fact cannot be one Prisma `@@unique` because `periodStart` is null for instant concepts, so it is
 * enforced as two complementary partial indexes.
 *
 * Everything else returns null and the caller fails closed. In particular a LONE partial index
 * never proves anything here: proving the query implies its predicate would need the runtime value,
 * and `periodStart: fact.periodStart` is exactly the case where that value is unknown statically.
 * Only `IS NULL` / `IS NOT NULL` partitions are implemented; any other predicate is not understood
 * and therefore not accepted.
 */
function proveSingleRow(keys: UniqueKey[], pinned: Set<string>): string | null {
  const covers = (k: UniqueKey) => k.fields.every((f) => pinned.has(f));

  const total = keys.find((k) => !k.partial && covers(k));
  if (total) {
    return `${total.kind}${total.name ? ` ${total.name}` : ""}(${total.fields.join(", ")}) fully pinned by equality`;
  }

  // Group the partial indexes by the column their predicate tests.
  const nullPredicate = /^WHERE\s+"?(\w+)"?\s+IS\s+(NOT\s+)?NULL\s*$/i;
  const byColumn = new Map<string, { isNull?: UniqueKey; isNotNull?: UniqueKey }>();
  for (const k of keys) {
    if (!k.partial) continue;
    const m = nullPredicate.exec(k.partial);
    if (!m) continue; // a predicate this cannot read proves nothing
    const [, column, not] = m;
    const slot = byColumn.get(column) ?? {};
    if (not) slot.isNotNull = slot.isNotNull ?? k;
    else slot.isNull = slot.isNull ?? k;
    byColumn.set(column, slot);
  }

  for (const [column, slot] of byColumn) {
    const { isNull, isNotNull } = slot;
    if (!isNull || !isNotNull) continue; // half a partition covers half the domain
    if (!covers(isNull) || !covers(isNotNull)) continue;
    return (
      `UNION OF PARTIAL INDEXES over \`${column}\`, both fully pinned: ` +
      `${isNotNull.name}(${isNotNull.fields.join(", ")}) WHERE NOT NULL and ` +
      `${isNull.name}(${isNull.fields.join(", ")}) WHERE NULL — the two predicates partition the ` +
      `domain, so every candidate falls under one of them`
    );
  }

  return null;
}

export function auditCardinality(injected?: Schema): Row[] {
  // The schema is injectable so a control can WEAKEN an authority and watch the verdict move.
  // Without a seam the only way to test that is to edit `prisma/schema.prisma`, which would be
  // editing the thing under test, and the review was explicit that self-proof does not count.
  const schema = injected ?? parseSchema();
  const uniqueKeys = schema.uniqueKeys;
  const program = loadProgram();
  const rows: Row[] = [];
  const root = path.resolve("src/server").replace(/\\/g, "/");

  for (const sf of program.getSourceFiles()) {
    const file = sf.fileName.replace(/\\/g, "/");
    if (sf.isDeclarationFile || !file.startsWith(root)) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const pc = prismaCall(node);
        if (pc) {
          const arg = node.arguments[0];
          const obj = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
          // Only sites that select a row AND have no ordering are in scope: an ordered site is
          // already classified by the recency audit, and an aggregate selects no row at all.
          const ordered = obj !== null && propOf(obj, "orderBy") !== null;
          if (!ordered && selectsOneRow(node, pc.method, obj)) {
            const where = obj ? propOf(obj, "where") : null;
            const keys = uniqueKeys.get(pc.model) ?? [];
            let verdict: Verdict;
            let citation: string;
            let pinned: string[] = [];

            if (!where) {
              verdict = "MULTI_CANDIDATE";
              citation = "no `where` at all: every row of the model is a candidate";
            } else {
              const { fields, opaque, via } = equalityFields(where, pc.model, schema);
              pinned = [...fields].sort();
              const proof = proveSingleRow(keys, fields);
              if (proof) {
                verdict = "CARDINALITY_ONE_PROVEN";
                citation = proof + (via.length > 0 ? `, via ${via.join("; ")}` : "");
              } else if (opaque) {
                verdict = "UNPROVEN_FAIL_CLOSED";
                citation = opaque;
              } else if (keys.length === 0) {
                verdict = "MULTI_CANDIDATE";
                citation = "the model declares no unique key at all";
              } else {
                verdict = "MULTI_CANDIDATE";
                citation = `no unique key is fully pinned; nearest is ${keys
                  .map((k) => `${k.kind}(${k.fields.join(", ")})`)
                  .join(" | ")}`;
              }
            }

            rows.push({
              file: file.slice(root.length + 1),
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              enclosing: enclosingName(node),
              model: pc.model,
              method: pc.method,
              shape: `prisma.${pc.model}.${pc.method}`,
              whereFields: pinned,
              verdict,
              citation,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return rows;
}

if (process.argv[1] && process.argv[1].includes("recency-cardinality")) {
  const rows = auditCardinality();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
    console.log(`UNORDERED SELECTING SITES: ${rows.length}\n`);
    for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)}  ${k}`);
    }
    for (const v of [
      "MULTI_CANDIDATE",
      "UNPROVEN_FAIL_CLOSED",
      "CARDINALITY_ONE_PROVEN",
    ] as Verdict[]) {
      const group = rows.filter((r) => r.verdict === v);
      if (group.length === 0) continue;
      console.log(`\n== ${v} (${group.length}) ==`);
      for (const r of group) {
        console.log(`  ${r.file}:${r.line}  ${r.enclosing}()  ${r.shape}`);
        console.log(`      where pins  ${r.whereFields.join(", ") || "nothing"}`);
        console.log(`      why         ${r.citation}`);
      }
    }
  }
}
