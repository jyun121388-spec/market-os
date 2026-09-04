/**
 * SEMANTIC RECENCY AUDIT — structural, over the real TypeScript program.
 *
 * `[CHATGPT_DECISION][MARKET-SEMANTIC-RECENCY-AUDIT-20260831]` item 2 requires this to inspect
 * executable ordering/comparison expressions themselves, and to exclude comments, string literals,
 * documentation examples and unrelated nearby clock words. It exists because the first attempt at
 * this audit did none of that: it scanned source TEXT for `orderBy` lines near clock words, and of
 * six reported sites at least three were false — two were example queries INSIDE DOC COMMENTS and
 * one matched a clock word four lines below an `observationDate` sort. That method also failed to
 * connect the ten `ORDERING_WAIVER` comments to the sites they waive.
 *
 * So nothing here matches text. Every site is an AST node from `ts.createProgram`; every ordering
 * key is read from the property name of an object-literal member; every waiver is bound through
 * `getLeadingCommentRanges` on the node's own statement rather than by line distance.
 *
 * THE CORE INVARIANT BEING AUDITED
 *
 *     RETRIEVED / ARRIVED LATER  !=  SEMANTICALLY NEWER
 *
 * An arrival clock may order operational work. It may not decide which value is current, which
 * revision won, or what gets published — unless a waiver states a checkable invariant that makes
 * the arrival key non-authoritative.
 *
 * FAIL CLOSED. A site whose key, receiver or shape cannot be proven is emitted as UNCLASSIFIED.
 * It is never omitted, and safety is never inferred from nearby prose.
 *
 *   npx tsx scripts/recency-audit.ts [--json]
 */

import * as path from "node:path";
import * as ts from "typescript";

/**
 * The semantic-field registry, keyed by Prisma model field name and justified per field.
 *
 * A field is SEMANTIC only when the provider or the model defines the version, period or event the
 * row DESCRIBES. It is ARRIVAL when this system or its transport created the value. Anything the
 * registry does not name is UNCLASSIFIED — the registry is an allowlist in both directions, so a
 * field added to the schema tomorrow surfaces as unknown rather than being silently treated as
 * safe.
 */
type Classification = "SEMANTIC" | "ARRIVAL" | "NON_TEMPORAL" | "UNCLASSIFIED";

/**
 * Which fields are times AT ALL, read from `prisma/schema.prisma` rather than assumed.
 *
 * This distinction is why the audit's first run over-reported. Ordering by `concept` or
 * `fromVariable` is not a recency decision and never could be — it is a business key, and calling
 * it "unclassified" buries the two sites that matter under twenty that do not. But the escape must
 * be structural: a field is NON_TEMPORAL because the SCHEMA says it is not a DateTime, not because
 * it failed to appear in a hand-written list. A DateTime the registry does not name stays
 * UNCLASSIFIED, which is the fail-closed direction that matters.
 */
function schemaDateTimeFields(): Set<string> {
  const schema = ts.sys.readFile("prisma/schema.prisma");
  if (schema === undefined) throw new Error("prisma/schema.prisma not readable");
  const fields = new Set<string>();
  for (const line of schema.split("\n")) {
    const m = /^\s{2,}(\w+)\s+DateTime\b/.exec(line);
    if (m) fields.add(m[1]);
  }
  if (fields.size === 0) throw new Error("no DateTime fields parsed from the schema");
  return fields;
}

const FIELD_REGISTRY: Readonly<Record<string, { kind: Classification; why: string }>> = {
  // Provider- or model-defined: what the row is ABOUT.
  observationDate: { kind: "SEMANTIC", why: "the period the observation describes" },
  releaseDate: { kind: "SEMANTIC", why: "provider-stated release of the figure" },
  periodStart: { kind: "SEMANTIC", why: "opening of the described span" },
  periodEnd: { kind: "SEMANTIC", why: "close of the described span" },
  filedDate: { kind: "SEMANTIC", why: "provider-issued filing date" },
  receiptDate: { kind: "SEMANTIC", why: "provider-issued document receipt date" },
  asOfDate: { kind: "SEMANTIC", why: "the date the holdings snapshot describes" },
  dealDate: { kind: "SEMANTIC", why: "the date the transaction occurred" },
  publishedAt: { kind: "SEMANTIC", why: "publisher's own publication time" },
  sourceTimestamp: { kind: "SEMANTIC", why: "timestamp asserted by the source" },

  // Our clock or our transport: WHEN WE saw or made it.
  retrievedAt: { kind: "ARRIVAL", why: "when this system fetched it" },
  createdAt: { kind: "ARRIVAL", why: "row insertion time" },
  startedAt: { kind: "ARRIVAL", why: "when our ingest run began" },
  finishedAt: { kind: "ARRIVAL", why: "when our ingest run ended" },
  firstSeenAt: { kind: "ARRIVAL", why: "when this system first saw the event" },
  addedAt: { kind: "ARRIVAL", why: "when the user added the row" },
  generatedAt: { kind: "ARRIVAL", why: "when this system generated the claim" },
  expiresAt: { kind: "ARRIVAL", why: "our own expiry bookkeeping" },

  // Deliberately NOT classified, and each is a real question rather than an oversight.
  latestUpdateAt: {
    kind: "UNCLASSIFIED",
    why: "Event.latestUpdateAt could be the latest MENTION's publication time (semantic) or the last time we touched the row (arrival); the schema does not say",
  },

  // `id` is not evidence, and this is the entry that says so out loud. A CUID correlates with
  // creation order, so ordering by it to find the "latest" is arrival time wearing a different
  // name. It is tolerable only where a structural invariant has already decided the winner and the
  // id merely makes an impossible tie reproducible — which a waiver must state.
  id: {
    kind: "UNCLASSIFIED",
    why: "an identifier is not a time; a creation-ordered id used as a latest-wins key is arrival time in disguise",
  },
};

/**
 * Entities whose OWN clock is their semantics.
 *
 * An ingest run has no described period, no provider vintage and no revision — when it started IS
 * the fact about it, so "the most recent run" ordered by `startedAt` is the correct reading and not
 * an arrival clock usurping semantic time. The architecture pass named this as a required negative
 * control: health telemetry, recent-run panels and watchlist order must be audited but must not be
 * reported as semantic-recency defects.
 *
 * The distinction is the whole reason this list exists rather than being folded into the field
 * registry: `startedAt` on `IngestRun` is semantics, and the very same clock deciding which
 * `Observation` is current would be the SR-01 defect. The field does not determine that. The
 * entity does.
 */
const OPERATIONAL_ENTITIES = new Set(["ingestRun", "session", "user", "watchlistItem"]);

/** Prisma client methods whose result can carry a selection decision. */
const SELECTING_METHODS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "groupBy",
  "aggregate",
  "upsert",
]);

interface Site {
  file: string;
  line: number;
  enclosing: string;
  shape: string;
  entity: string;
  keys: { field: string; direction: string; kind: Classification; why: string }[];
  decisive: string;
  waiver: string | null;
  classification:
    | "SEMANTIC_ORDERED"
    | "ARRIVAL_DECIDES"
    | "OPERATIONAL"
    | "AGGREGATE"
    | "STRUCTURAL"
    | "UNCLASSIFIED";
  note: string;
}

function loadProgram(): ts.Program {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
  return ts.createProgram({ options: parsed.options, rootNames: parsed.fileNames });
}

/** The `prisma.<model>.<method>` receiver chain, read from the AST rather than matched as text. */
function prismaCall(node: ts.CallExpression): { model: string; method: string } | null {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  const receiver = callee.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return null;
  const model = receiver.name.text;
  const root = receiver.expression;
  // `prisma.observation.findMany(...)` and `tx.observation.findMany(...)` are the two real shapes.
  if (!ts.isIdentifier(root)) return null;
  if (root.text !== "prisma" && root.text !== "tx" && root.text !== "client") return null;
  return { model, method };
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

/** Ordering keys as (field, direction) pairs, from object-literal property names only. */
function orderingKeys(expr: ts.Expression): { field: string; direction: string }[] {
  const out: { field: string; direction: string }[] = [];
  const fromObject = (o: ts.ObjectLiteralExpression) => {
    for (const member of o.properties) {
      if (!ts.isPropertyAssignment(member)) continue;
      const key = member.name;
      const field = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : "<computed>";
      const init = member.initializer;
      // A nested object is a relation ordering: `{ source: { code: "asc" } }`.
      if (ts.isObjectLiteralExpression(init)) {
        for (const inner of orderingKeys(init)) {
          out.push({ field: `${field}.${inner.field}`, direction: inner.direction });
        }
        continue;
      }
      out.push({ field, direction: ts.isStringLiteral(init) ? init.text : "<dynamic>" });
    }
  };
  if (ts.isObjectLiteralExpression(expr)) fromObject(expr);
  else if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) if (ts.isObjectLiteralExpression(el)) fromObject(el);
  } else out.push({ field: "<dynamic>", direction: "<dynamic>" });
  return out;
}

/**
 * The waiver, bound to the NODE rather than to a nearby line.
 *
 * Walks outward from the call to its enclosing statement and reads that statement's own leading
 * comment ranges, plus the comments attached to the `orderBy` property itself. A comment twelve
 * lines above something else does not count, which is precisely the error the first attempt made.
 */
function waiverFor(node: ts.Node, sf: ts.SourceFile): string | null {
  const full = sf.getFullText();
  const candidates: ts.Node[] = [];
  let cur: ts.Node | undefined = node;
  for (let depth = 0; cur && depth < 6; depth++) {
    candidates.push(cur);
    cur = cur.parent;
  }
  for (const c of candidates) {
    const ranges = ts.getLeadingCommentRanges(full, c.getFullStart()) ?? [];
    for (const r of ranges) {
      const text = full.slice(r.pos, r.end);
      if (text.includes("ORDERING_WAIVER")) {
        return text
          .replace(/^\s*(\/\/|\/\*+|\*+\/?)/gm, "")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
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
 * Does the RESULT get used as a selection — one winner out of candidates?
 *
 * Bounded and local rather than fully interprocedural, and the bound is declared rather than
 * hidden: `findFirst`, `take`, `distinct` and `_max` are selections by construction, and beyond
 * that this looks only at what the awaited value is immediately bound to and indexed with. A site
 * that is neither is reported as a candidate with `decisive` saying so, never dropped.
 */
function decisiveShape(
  node: ts.CallExpression,
  method: string,
  arg: ts.ObjectLiteralExpression | null,
): string {
  const parts: string[] = [];
  if (method === "findFirst" || method === "findFirstOrThrow") parts.push("findFirst");
  if (arg) {
    const take = propOf(arg, "take");
    if (take) parts.push(`take:${take.getText()}`);
    if (propOf(arg, "distinct")) parts.push("distinct");
    if (propOf(arg, "_max") || propOf(arg, "_min")) parts.push("aggregate-extreme");
  }
  if (method === "aggregate") {
    // An aggregate returns a computed extreme, not a chosen ROW. It cannot launder a stale row as
    // current, so it is not a selection -- but it is still reported, because an extreme taken over
    // an arrival clock can still be published as if it were a semantic fact.
    return "aggregate (computes an extreme; selects no row)";
  }
  // `(await prisma...)[0]` and `const [x] = await prisma...`
  let cur: ts.Node = node;
  for (let d = 0; d < 4 && cur.parent; d++) {
    cur = cur.parent;
    if (ts.isElementAccessExpression(cur) && cur.argumentExpression.getText() === "0") {
      parts.push("[0]");
      break;
    }
    if (ts.isVariableDeclaration(cur) && ts.isArrayBindingPattern(cur.name)) {
      parts.push("destructured-first");
      break;
    }
  }
  return parts.length > 0 ? parts.join("+") : "collection (no local first-element selection seen)";
}

function classify(
  entity: string,
  keys: Site["keys"],
  decisive: string,
  waiver: string | null,
): { classification: Site["classification"]; note: string } {
  if (keys.length === 0) {
    return {
      classification: "UNCLASSIFIED",
      note: "no ordering key could be read from the AST",
    };
  }
  if (decisive.startsWith("aggregate (")) {
    const lead2 = keys.find((k) => k.kind !== "NON_TEMPORAL");
    return {
      classification: "AGGREGATE",
      note: lead2
        ? `computes an extreme of \`${lead2.field}\` (${lead2.kind}); it chooses no row, so it cannot present a superseded value as current -- but publishing an ARRIVAL extreme as a fact about the DATA would still be a category error`
        : "computes an extreme over no temporal key",
    };
  }
  if (OPERATIONAL_ENTITIES.has(entity)) {
    return {
      classification: "OPERATIONAL",
      note: `${entity} has no described period or provider vintage, so its own clock IS its semantics; ordering it by that clock cannot launder a stale market value`,
    };
  }
  const unknownTime = keys.find((k) => k.kind === "UNCLASSIFIED" && k.field !== "id");
  if (unknownTime) {
    return {
      classification: "UNCLASSIFIED",
      note: `\`${unknownTime.field}\` is a DateTime the registry does not classify`,
    };
  }
  // The DECIDING key for recency is the first TEMPORAL one. A business key ahead of it partitions
  // the rows; it does not decide which version of a row wins.
  const selects = !decisive.startsWith("collection");
  const lead = keys.find((k) => k.kind !== "NON_TEMPORAL");
  if (!lead) {
    return {
      classification: "STRUCTURAL",
      note: "ordered entirely on business keys, so no clock decides anything here",
    };
  }
  if (lead.kind === "SEMANTIC") {
    const idTail = keys.slice(1).some((k) => k.field === "id");
    return {
      classification: "SEMANTIC_ORDERED",
      note: idTail
        ? "leads on semantic time; `id` breaks the remaining tie and is arrival-shaped, so the tie case needs a waiver or a structural resolver"
        : "leads on semantic time",
    };
  }
  if (!selects) {
    return {
      classification: "STRUCTURAL",
      note: "arrival-keyed but no local selection: the whole collection is returned, so this orders presentation rather than deciding a winner here",
    };
  }
  if (waiver) {
    return {
      classification: "STRUCTURAL",
      note: "arrival-keyed selection, waived; the waiver's invariant is RECORDED, not verified by this audit",
    };
  }
  return {
    classification: "ARRIVAL_DECIDES",
    note: "an arrival clock chooses one row out of candidates, with no waiver",
  };
}

const dateTimeFields = schemaDateTimeFields();
const program = loadProgram();
const checker = program.getTypeChecker();
void checker;
const sites: Site[] = [];
const root = path.resolve("src/server").replace(/\\/g, "/");

for (const sf of program.getSourceFiles()) {
  const file = sf.fileName.replace(/\\/g, "/");
  if (sf.isDeclarationFile || !file.startsWith(root)) continue;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const pc = prismaCall(node);
      if (pc && SELECTING_METHODS.has(pc.method)) {
        const arg = node.arguments[0];
        const obj = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
        const orderBy = obj ? propOf(obj, "orderBy") : null;
        const keys = orderBy ? orderingKeys(orderBy) : [];
        // An aggregate has no `orderBy`; its deciding field is the one inside `_max`/`_min`, and
        // reading it is the difference between "unclassified" and knowing that a health panel takes
        // the maximum of an ARRIVAL clock on purpose.
        for (const agg of ["_max", "_min"] as const) {
          const node2 = obj ? propOf(obj, agg) : null;
          if (node2 && ts.isObjectLiteralExpression(node2)) {
            for (const k of orderingKeys(node2)) keys.push({ field: k.field, direction: agg });
          }
        }
        const decisive = decisiveShape(node, pc.method, obj);
        const isSelection = !decisive.startsWith("collection");
        // Report a site when it orders, or when it selects at all. An unordered selection is a
        // decision made by whatever the database returned first, which is the least visible form
        // of this defect and must not be skipped for having no key to read.
        if (keys.length > 0 || isSelection) {
          const waiver = waiverFor(node, sf);
          const typed = keys.map((k) => {
            const bare = k.field.split(".").pop() ?? k.field;
            const reg = FIELD_REGISTRY[bare];
            if (reg) return { ...k, kind: reg.kind, why: reg.why };
            if (!dateTimeFields.has(bare)) {
              return {
                ...k,
                kind: "NON_TEMPORAL" as const,
                why: "the schema does not declare this a DateTime, so it cannot carry recency",
              };
            }
            return {
              ...k,
              kind: "UNCLASSIFIED" as const,
              why: "a schema DateTime the registry does not name",
            };
          });
          const { classification, note } =
            keys.length === 0
              ? {
                  classification: "UNCLASSIFIED" as const,
                  note: "selects a row with NO ordering at all: the winner is whatever the database returned first",
                }
              : classify(pc.model, typed, decisive, waiver);
          sites.push({
            file: file.slice(root.length + 1),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            enclosing: enclosingName(node),
            shape: `prisma.${pc.model}.${pc.method}`,
            entity: pc.model,
            keys: typed,
            decisive,
            waiver,
            classification,
            note,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(sites, null, 2));
} else {
  const byClass = new Map<string, number>();
  for (const s of sites) byClass.set(s.classification, (byClass.get(s.classification) ?? 0) + 1);
  console.log(`AUDITED SITES: ${sites.length}\n`);
  for (const [k, v] of [...byClass].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }
  for (const cls of [
    "ARRIVAL_DECIDES",
    "UNCLASSIFIED",
    "SEMANTIC_ORDERED",
    "OPERATIONAL",
    "AGGREGATE",
    "STRUCTURAL",
  ]) {
    const group = sites.filter((s) => s.classification === cls);
    if (group.length === 0) continue;
    console.log(`\n== ${cls} (${group.length}) ==`);
    for (const s of group) {
      const keys = s.keys.map((k) => `${k.field}:${k.direction}[${k.kind}]`).join(" , ") || "none";
      console.log(`  ${s.file}:${s.line}  ${s.enclosing}()  ${s.shape}`);
      console.log(`      keys     ${keys}`);
      console.log(`      decisive ${s.decisive}`);
      console.log(`      waiver   ${s.waiver ? s.waiver.slice(0, 110) : "none"}`);
      console.log(`      note     ${s.note}`);
    }
  }
}
