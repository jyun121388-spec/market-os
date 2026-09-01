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
 *   ORDER_DISCARDED   every use is ORDER-BLIND. Unconditionally that is only `.length` and a
 *                     value-only `.includes`. `.some` and `.every` qualify ONLY when their
 *                     callback is PROVEN order-independent from its own shape — they short-circuit
 *                     and run user code, so the method name proves nothing. See `ORDER_BLIND` and
 *                     `isProvenOrderIndependentCallback` for why `find`, `reduce`, `sort`, `Map`
 *                     and `fromEntries` were removed and why these two are now conditional.
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
export const ORDER_BLIND = new Set(["includes", "length"]);

/**
 * `some` and `every` are order-blind ONLY IF their callback is.
 *
 * They short-circuit and they call user code, so the METHOD NAME proves nothing: a callback that
 * mutates captured state, throws, reads its index, or calls anything of unknown purity produces
 * different observable behaviour depending on which row arrives first — even when the boolean it
 * eventually returns does not.
 *
 * So purity is PROVEN from the callback's own shape, not assumed and not inferred from its name.
 * The proof is a whitelist of EXPRESSION FORMS over the callback's first parameter: property
 * access, literals, comparison and logical operators, and `!`. Anything else — an assignment, an
 * increment, a `throw`, a call of any kind, `await`, `new`, a second or third parameter, an
 * identifier that is not the element — is not proven and the site is not discharged.
 *
 * A name whitelist was available and is exactly what the review forbade, for the same reason a
 * method-name whitelist failed one level up: the name is not the behaviour.
 *
 * ## AND A SHAPE IS NOT A BEHAVIOUR EITHER — THE SAME MISTAKE, ONE LEVEL DOWN
 *
 * The paragraph above was still wrong, in the way this branch keeps being wrong: it enforced the
 * invariant on one side of a boundary. `x.flag` is a syntactic property read; it is not an inert
 * one. The property may be an accessor, or the row may be a Proxy, and then the read RUNS USER
 * CODE — and because `some`/`every` short-circuit, reversing arrival order changes which reads
 * happen at all. Reproduced before repairing, with getter-backed and proxy-backed rows:
 *
 *     forward   result=true  effects=[read:A, read:B]
 *     reversed  result=true  effects=[read:C, read:B]
 *
 * The boolean is stable; the OBSERVABLE BEHAVIOUR is not, and observable behaviour is the property
 * that was claimed. A `PropertyAccessExpression` node is not evidence about either.
 *
 * So a property read now needs a `FieldAuthority`, consulted per read, with no default: omitting
 * it is a type error rather than a silent admission.
 *
 * ## AND A SAFE READ IS NOT A SAFE USE — THE SAME MISTAKE AT THE OPERATOR BOUNDARY
 *
 * Third time, one boundary further out. Proving that `r.value` is a declared field of a generated
 * row proves the READ. It says nothing about what `>` then does with the value, and JavaScript's
 * relational operators run ToPrimitive on object operands — `Symbol.toPrimitive`, `valueOf`,
 * `toString`. This schema has `DateTime`, `Decimal` and `Json` fields, so object-valued generated
 * fields are not hypothetical, and `Prisma.Decimal.valueOf` is library code rather than an
 * intrinsic. Reproduced before repairing, with a `valueOf` that records being called:
 *
 *     forward   result=true  effects=[convert:A, convert:B]
 *     reversed  result=true  effects=[convert:C, convert:B]
 *
 * `===` and `!==` are a genuinely different operator class: strict equality performs no numeric or
 * string coercion, so it is not swept up in this and is deliberately not treated as if it were.
 */

/**
 * The authority that says a property read executes no user code, and that its value can be
 * COMPARED without executing any either. Two questions, because they have two answers.
 *
 * An interface because the real one needs a type checker, and the controls must exercise both
 * answers on shapes no checker in this repository would ever produce.
 */
export interface FieldAuthority {
  /** What contract is being relied on, so that a discharge is never anonymous. */
  provenance(): string;
  /** Does reading `.field` off `receiver` provably run no user code? */
  isInertRead(receiver: ts.Node, field: string): boolean;
  /**
   * Does `.field` hold ONLY primitives, so that `<` `<=` `>` `>=` coerce nothing?
   *
   * Separate from `isInertRead` because the two are independent: `Decimal` is an inert read of an
   * object, and an object operand is exactly what makes a relational operator run code.
   */
  isPrimitiveField(receiver: ts.Node, field: string): boolean;
}

/** Where `prisma/schema.prisma` writes the generated client. The contract is anchored here. */
export const PRISMA_CLIENT_OUTPUT = "src/generated/prisma";

/**
 * Refuses every property read: the fail-closed default for a caller with no checker. An absent
 * authority must never read as a permissive one.
 */
export const NO_FIELD_AUTHORITY: FieldAuthority = {
  provenance: () => "none — no property read can be proven inert",
  isInertRead: () => false,
  isPrimitiveField: () => false,
};

/**
 * Types a relational operator can compare without invoking ToPrimitive.
 *
 * Spelled out rather than using `ts.TypeFlags.Primitive`, which is an internal alias whose members
 * TypeScript is free to change: this mask is the actual claim being made, and it should break
 * visibly if it stops being true rather than silently follow someone else's definition. `Null` and
 * `Undefined` belong here — `null < "m"` coerces nothing and runs nothing. `Any` and `Unknown`
 * deliberately do not.
 */
const PRIMITIVE_TYPE_FLAGS =
  ts.TypeFlags.String |
  ts.TypeFlags.Number |
  ts.TypeFlags.Boolean |
  ts.TypeFlags.BigInt |
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.BigIntLiteral |
  ts.TypeFlags.Enum |
  ts.TypeFlags.EnumLiteral |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined;

/**
 * The real contract, checked rather than assumed.
 *
 * A read discharges only when the checker resolves the property to EXACTLY ONE declaration, that
 * declaration is a `PropertySignature` — never a `GetAccessor`, `SetAccessor`, method or index
 * signature — and it lives in the GENERATED PRISMA CLIENT.
 *
 * Measured on this repository's own client before being relied on. `SourceModel` is
 * `DefaultSelection<$SourcePayload>`, a MAPPED type, so it was not obvious the checker would reach
 * a field declaration at all; it does, resolving `code` to a `PropertySignature` in
 * `src/generated/prisma/models/Source.ts`. A getter in a hand-written object resolves to
 * `GetAccessor`, and a plain field in one resolves to a `PropertySignature` OUTSIDE the generated
 * output. All three are distinguished, so both halves of the rule are load-bearing rather than one
 * of them being decorative.
 *
 * ## WHAT THIS DOES NOT PROVE, STATED RATHER THAN GLOSSED
 *
 * It is a claim about the DECLARED SOURCE, not about the object that arrives at runtime — anything
 * can be wrapped in a Proxy in principle. What closes that for the audited sites is the separate
 * `const`-binding requirement in `classifyUses`: no interposition point exists between the client
 * and the callback. Neither half suffices alone, and the pair is why a discharge is defensible.
 */
export function prismaRowAuthority(checker: ts.TypeChecker): FieldAuthority {
  const marker = `/${PRISMA_CLIENT_OUTPUT}/`;
  return {
    provenance: () => `a declared PropertySignature under ${PRISMA_CLIENT_OUTPUT}`,
    isInertRead(receiver, field) {
      const symbol = checker.getTypeAtLocation(receiver).getProperty(field);
      if (!symbol) return false;
      const decls = symbol.getDeclarations() ?? [];
      // Merged or overloaded declarations mean no single source answers for the read.
      if (decls.length !== 1) return false;
      const decl = decls[0];
      // An accessor IS user code, which is the entire defect this replaced.
      if (!ts.isPropertySignature(decl)) return false;
      return decl.getSourceFile().fileName.replace(/\\/g, "/").includes(marker);
    },
    isPrimitiveField(receiver, field) {
      const symbol = checker.getTypeAtLocation(receiver).getProperty(field);
      if (!symbol) return false;
      const type = checker.getTypeOfSymbolAtLocation(symbol, receiver);
      // EVERY constituent, because a union is only as safe as its worst member: `Decimal | null`
      // coerces exactly as hard as `Decimal`. Measured on this schema — `string | null` and the
      // `SourceTier` string-literal union pass; `Decimal` and `Date` are `Object` and do not.
      const parts = type.isUnion() ? type.types : [type];
      return parts.length > 0 && parts.every((p) => (p.flags & PRIMITIVE_TYPE_FLAGS) !== 0);
    },
  };
}

/**
 * @param authority consulted for every property read. Deliberately has no default.
 */
export function isProvenOrderIndependentCallback(
  node: ts.Node,
  authority: FieldAuthority,
): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  // A second or third parameter is the INDEX or the whole array. Either makes position readable.
  if (node.parameters.length !== 1) return false;
  const param = node.parameters[0];
  if (!ts.isIdentifier(param.name)) return false;
  const element = param.name.text;

  const body = node.body;
  // A block body could hold anything; only a single expression is checked.
  if (ts.isBlock(body)) return false;

  const pure = (e: ts.Node): boolean => {
    if (ts.isIdentifier(e)) return e.text === element;
    if (
      ts.isStringLiteral(e) ||
      ts.isNumericLiteral(e) ||
      e.kind === ts.SyntaxKind.TrueKeyword ||
      e.kind === ts.SyntaxKind.FalseKeyword ||
      e.kind === ts.SyntaxKind.NullKeyword
    ) {
      return true;
    }
    if (ts.isPropertyAccessExpression(e)) {
      // DEPTH ONE ONLY. `x.a.b` reads `x.a` and then reads INTO whatever that returned, and the
      // authority answers about a declared field of the row — not about the shape of its value.
      // Recursing here is what let an unbounded chain through on nothing but syntax.
      if (!ts.isIdentifier(e.expression) || e.expression.text !== element) return false;
      return authority.isInertRead(e.expression, e.name.text);
    }
    if (ts.isParenthesizedExpression(e)) return pure(e.expression);
    if (ts.isPrefixUnaryExpression(e)) {
      // `!x` only. `++x` and `--x` mutate.
      return e.operator === ts.SyntaxKind.ExclamationToken && pure(e.operand);
    }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      // Strict identity and the logical operators coerce NOTHING. `===`/`!==` compare without
      // conversion, and `&&`/`||` just select an operand. The read authority is the whole story.
      const nonCoercing =
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken;
      if (nonCoercing) return pure(e.left) && pure(e.right);

      // Relational operators call ToPrimitive on an object operand, so BOTH operands must be proven
      // primitive on top of being proven readable. This is a second, independent authority
      // question, and answering only the first is what admitted `r.value > 0` on a `Decimal`.
      const relational =
        op === ts.SyntaxKind.LessThanToken ||
        op === ts.SyntaxKind.LessThanEqualsToken ||
        op === ts.SyntaxKind.GreaterThanToken ||
        op === ts.SyntaxKind.GreaterThanEqualsToken;
      if (relational) {
        return (
          pure(e.left) && pure(e.right) && primitiveOperand(e.left) && primitiveOperand(e.right)
        );
      }
      return false;
    }
    return false;
  };

  /**
   * Can this operand reach a relational operator without anything being converted?
   *
   * Fails closed on everything it does not recognise, and it deliberately does NOT recurse the way
   * `pure` does: a nested relational or logical expression as an operand of another relational
   * operator is not a shape worth admitting to save.
   */
  const primitiveOperand = (e: ts.Node): boolean => {
    if (
      ts.isStringLiteral(e) ||
      ts.isNumericLiteral(e) ||
      ts.isBigIntLiteral(e) ||
      e.kind === ts.SyntaxKind.TrueKeyword ||
      e.kind === ts.SyntaxKind.FalseKeyword ||
      e.kind === ts.SyntaxKind.NullKeyword
    ) {
      return true;
    }
    if (ts.isParenthesizedExpression(e)) return primitiveOperand(e.expression);
    // `!x` is always a boolean whatever `x` was.
    if (ts.isPrefixUnaryExpression(e)) return e.operator === ts.SyntaxKind.ExclamationToken;
    if (ts.isPropertyAccessExpression(e)) {
      if (!ts.isIdentifier(e.expression) || e.expression.text !== element) return false;
      return authority.isPrimitiveField(e.expression, e.name.text);
    }
    return false;
  };

  return pure(body);
}

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
let cached: { program: ts.Program; checker: ts.TypeChecker } | null = null;

function loadProgram(): { program: ts.Program; checker: ts.TypeChecker } {
  if (cached) return cached;
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram({ options: parsed.options, rootNames: parsed.fileNames });
  // BINDING IS WHAT SETS `node.parent`, and creating the checker is what binds. Without this call
  // every parent pointer is undefined, `enclosingName` silently answers "<module scope>" for every
  // site, and any analysis that walks upward reports the same empty answer everywhere. That
  // uniformity is the tell: 34 of 34 sites returning one identical reason is a broken tool, not a
  // finding. The recency audit had a `getTypeChecker()` call it never otherwise used, and this is
  // what it was for.
  //
  // It is RETURNED rather than discarded now, because the field authority needs the same checker.
  // One call, one binding: a second `getTypeChecker()` elsewhere would have made deleting this one
  // harmless, and the mutant that proves parents matter would have quietly gone equivalent.
  const checker = program.getTypeChecker();
  cached = { program, checker };
  return cached;
}

/**
 * The `const x = await prisma...` name this call is bound to, and WHETHER IT IS ACTUALLY `const`.
 *
 * The constness is not bookkeeping. The field authority proves things about the row type the
 * generated client declares, which says nothing about the object that reaches the callback if the
 * binding can be reassigned in between — `rows = rows.map(wrapInProxy)` reintroduces exactly the
 * interposition the authority was meant to exclude. A `let` binding therefore cannot discharge.
 */
function boundName(node: ts.Node): { name: string; isConst: boolean } | null {
  let cur: ts.Node | undefined = node;
  for (let d = 0; d < 3 && cur; d++) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
      const list = cur.parent;
      const isConst =
        !!list && ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
      return { name: cur.name.text, isConst };
    }
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
function classifyUses(
  name: string,
  scope: ts.Node,
  decl: ts.Node,
  authority: FieldAuthority,
): { reach: Reach; why: string } {
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
        else if (method === "some" || method === "every") {
          // Order-blind only with a callback proven order-independent. Unproven fails closed.
          const call = parent.parent;
          const arg = call && ts.isCallExpression(call) ? call.arguments[0] : undefined;
          if (arg && isProvenOrderIndependentCallback(arg, authority)) discarded += 1;
          else
            survives =
              survives ??
              `\`.${method}()\` runs a callback whose order-independence is not proven, and it short-circuits`;
        } else if (PRESERVES.has(method))
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
  const { program, checker } = loadProgram();
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
              : classifyUses(
                  name.name,
                  scope,
                  node,
                  // A reassignable binding admits an interposition the field authority cannot see,
                  // so it gets an authority that proves nothing rather than the real one.
                  name.isConst ? prismaRowAuthority(checker) : NO_FIELD_AUTHORITY,
                );
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
