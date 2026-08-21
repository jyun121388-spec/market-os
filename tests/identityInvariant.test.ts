import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PHASE — EVOLUTION RECURRENCE ANALYSIS, and the one guard it argued for.
 *
 * Measuring the ledger by SPREAD — distinct subsystems divided by instances — separated the two
 * largest clusters into opposite shapes, which no instance count had shown:
 *
 * | cluster              | inst | subsystems | P0/P1 | spread |
 * | -------------------- | ---- | ---------- | ----- | ------ |
 * | `GUARDRAIL_COVERAGE` | 12   | 8          | 8     | 0.67   |
 * | `IDENTITY_MODELLING` | 11   | 11         | 9     | 1.00   |
 *
 * `GUARDRAIL_COVERAGE` repeats in places it has already been fixed, along an axis nobody enumerated
 * — a new grammatical person, a second language's negation, an unlisted channel. Its fix is local
 * and its lesson is to enumerate axes at each guardrail.
 *
 * `IDENTITY_MODELLING` has never once recurred in the same subsystem. Eleven instances, eleven
 * distinct places, nine of them P0 or P1: the largest producer of serious defects in the project,
 * and every fix so far has been correct and local, which is exactly why it keeps arriving somewhere
 * new. A cluster at spread 1.00 is not being fixed. It is being outrun.
 *
 * That argues for a global invariant rather than a twelfth local fix, and this file is it.
 *
 * **The enumeration found no defect.** Every clause in the domain layer that filters on a field
 * which names an entity without identifying one already carries its discriminator, and the three
 * that do not are each deliberate and named below. Recording a no-finding is the honest outcome of
 * an audit that found nothing — the point of the guard is that the twelfth instance cannot arrive
 * silently, since it will land in a subsystem nobody is watching, as all eleven did.
 */

const DOMAIN = join(process.cwd(), "src/server/domain");

/** Names an entity; does not identify one. `corpCode` is ambiguous across sources — IR-032. */
const AMBIGUOUS = ["corpCode", "externalId", "concept"];

/** Supplies the missing half. `source: { code:` is the relation form and counts — see below. */
const DISCRIMINATORS = [/\bsourceId\b/, /\bsourceCode\b/, /\bunit\b/, /source:\s*\{\s*code\b/];

/**
 * Clauses that identify no single entity by design, each with the reason.
 *
 * Keyed by `file:exportedFunction` rather than by line, because a line number is invalidated by an
 * unrelated edit above it and the waiver would then either fail or, worse, silently move onto a
 * different clause.
 */
const WAIVERS: Record<string, string> = {
  "companyXray.ts:findKnownCorpCodes":
    "Asks whether ANY source knows a watchlist ref, so constraining it to one source would " +
    "answer a different question. Cross-source by intent.",
  "companyXray.ts:listCompanySources":
    "Enumerates the sources that hold a corpCode. A source discriminator here would make the " +
    "function return its own argument.",
};

interface Clause {
  file: string;
  line: number;
  text: string;
  /** The nearest exported function above the clause, which is what a waiver is keyed on. */
  owner: string;
}

function whereClauses(file: string, source: string): Clause[] {
  const found: Clause[] = [];
  for (const match of source.matchAll(/where:\s*\{/g)) {
    const start = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const before = source.slice(0, start);
    const owners = [...before.matchAll(/export (?:async )?function (\w+)/g)];
    found.push({
      file,
      line: before.split("\n").length,
      text: source.slice(start, end + 1).replace(/\s+/g, " "),
      owner: owners.length > 0 ? owners[owners.length - 1][1] : "(module)",
    });
  }
  return found;
}

const files = readdirSync(DOMAIN).filter((name) => name.endsWith(".ts"));
const clauses = files.flatMap((name) =>
  whereClauses(name, readFileSync(join(DOMAIN, name), "utf8")),
);

describe("an entity is never looked up by a field that does not identify it", () => {
  it("has clauses to check, so a green result means something", () => {
    // The check silently passes if the brace matcher breaks, which is the failure mode of every
    // source-scanning test. This is the floor that makes the rest of the file evidence.
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(clauses.length).toBeGreaterThanOrEqual(10);
    expect(clauses.filter((c) => AMBIGUOUS.some((f) => c.text.includes(f))).length).toBeGreaterThan(
      3,
    );
  });

  it("pairs every ambiguous field with a discriminator, or names why not", () => {
    for (const clause of clauses) {
      const ambiguous = AMBIGUOUS.filter((field) => new RegExp(`\\b${field}\\b`).test(clause.text));
      if (ambiguous.length === 0) continue;
      if (DISCRIMINATORS.some((pattern) => pattern.test(clause.text))) continue;

      const key = `${clause.file}:${clause.owner}`;
      expect(
        WAIVERS[key],
        `${clause.file}:${clause.line} in ${clause.owner} filters on ` +
          `[${ambiguous.join(", ")}] with nothing to disambiguate it, and has no recorded waiver.` +
          `\n  ${clause.text.slice(0, 160)}\n` +
          "  IDENTITY_MODELLING has produced 11 defects in 11 different subsystems, nine of them " +
          "P0 or P1. If this clause is deliberately cross-source, add it to WAIVERS with the " +
          "reason; if it is not, it is the twelfth.",
      ).toBeTruthy();
    }
  });

  it("keeps every waiver pointing at a clause that still exists", () => {
    // A waiver whose clause has been deleted or renamed is a hole with a comment over it: the next
    // bare clause in that function inherits the exemption without anyone deciding to grant it.
    for (const key of Object.keys(WAIVERS)) {
      const [file, owner] = key.split(":");
      const match = clauses.find((c) => c.file === file && c.owner === owner);
      expect(match, `waiver ${key} names a clause that no longer exists`).toBeTruthy();
      expect(
        DISCRIMINATORS.some((pattern) => pattern.test(match?.text ?? "")),
        `waiver ${key} is no longer needed — the clause now carries a discriminator, so drop it`,
      ).toBe(false);
    }
  });

  it("counts the relation form as a discriminator, because it is one", () => {
    // The enumeration's own false positive, pinned. `source: { code: resolvedSourceCode }` scopes
    // a query exactly as `sourceId` does, and the first pass reported it as bare — which would
    // have produced a fabricated finding against correct code had it not been read.
    const relationForm = clauses.find((c) => /source:\s*\{\s*code/.test(c.text));
    expect(relationForm, "the relation-scoped clause has gone").toBeTruthy();
    expect(DISCRIMINATORS.some((p) => p.test(relationForm?.text ?? ""))).toBe(true);
  });
});
