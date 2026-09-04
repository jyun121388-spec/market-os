import { describe, expect, it } from "vitest";
import { auditCardinality, parseSchema, type Schema } from "../scripts/recency-cardinality";
import { prisma } from "@/server/db/client";

/**
 * The cardinality classifier, held to the rule that makes it worth anything.
 *
 * `scripts/recency-audit.ts` left 15 sites UNCLASSIFIED because an unordered `findFirst` is only a
 * defect when more than one row can match. `recency-cardinality.ts` answers that from the SCHEMA,
 * and these are the controls that stop it answering "yes" for a bad reason.
 *
 * The controls are the ones the governing task named, and each is here because a plausible wrong
 * implementation would pass without it.
 */

const rows = auditCardinality();
const rowAt = (set: typeof rows, file: string, line: number) => {
  const row = set.find((r) => r.file === file && r.line === line);
  if (!row) throw new Error(`no audited site at ${file}:${line} — the audit's scope moved`);
  return row;
};
const at = (file: string, line: number) => rowAt(rows, file, line);

/**
 * A deep-enough copy of the real schema with one authority removed.
 *
 * Copied rather than mutated in place, because `parseSchema()` reads the real files and every
 * other test in this file shares the unweakened result.
 */
const weakenSchema = (mutate: (s: Schema) => void): Schema => {
  const base = parseSchema();
  const copy: Schema = {
    uniqueKeys: new Map([...base.uniqueKeys].map(([k, v]) => [k, v.map((x) => ({ ...x }))])),
    relations: new Map([...base.relations].map(([k, v]) => [k, v.map((x) => ({ ...x }))])),
    nullableFields: new Map([...base.nullableFields].map(([k, v]) => [k, new Set(v)])),
  };
  mutate(copy);
  return copy;
};

describe("what counts as proof that only one row can match", () => {
  it("audits a non-empty set of sites, so a silent zero cannot pass as clean", () => {
    // The vacuous control. Every assertion below is about a classification, and an empty result
    // would satisfy all of them by having nothing to contradict. This project has been bitten by a
    // silent zero more than once; the audit itself already throws when the schema parses to no
    // models, and this is the same guard at the other end.
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.verdict)).size).toBeGreaterThan(1);
  });

  it("proves single-row cardinality from a single-column unique constraint", () => {
    const row = at("verify/shadowRun.ts", 315);
    expect(row.verdict).toBe("CARDINALITY_ONE_PROVEN");
    expect(row.citation).toContain("@unique(code)");
  });

  /**
   * The relation invariant, and the reason it is not a shortcut.
   *
   * `series.findFirst({ where: { externalId, source: { code } } })` names no `sourceId` anywhere.
   * It is still single-row, because `Source.code` is unique — so exactly one Source has that code
   * and `sourceId` is determined — and `@@unique(sourceId, externalId)` is then fully pinned. Two
   * schema facts joined. The citation must show BOTH, because a verdict that showed only the
   * `@@unique` would be asserting the join rather than proving it.
   */
  it("proves single-row cardinality through a relation whose target field is unique", () => {
    for (const [file, line] of [
      ["domain/macroRegime.ts", 85],
      ["verify/shadowRun.ts", 401],
    ] as const) {
      const row = at(file, line);
      expect(row.verdict, `${file}:${line}`).toBe("CARDINALITY_ONE_PROVEN");
      expect(row.citation).toContain("@@unique(sourceId, externalId)");
      expect(row.citation).toContain("source.@unique(code)");
    }
  });

  /**
   * The wrong-reason control.
   *
   * Every site in scope is UNORDERED by construction — an ordered site belongs to the recency
   * audit, not to this one. So no verdict here may have been reached because of an `orderBy`, and
   * nothing in the corpus can quietly satisfy cardinality by sorting. Stated as an invariant over
   * the whole result rather than one case, because the failure it guards against is a classifier
   * that starts accepting "it is ordered, so it is fine".
   */
  it("never treats ordering as cardinality proof, because ordered sites are out of scope", () => {
    for (const row of rows) {
      expect(row.citation.toLowerCase(), `${row.file}:${row.line}`).not.toContain("orderby");
      expect(row.citation.toLowerCase(), `${row.file}:${row.line}`).not.toContain("findfirst");
      expect(row.citation.toLowerCase(), `${row.file}:${row.line}`).not.toContain("createdat");
      expect(row.citation.toLowerCase(), `${row.file}:${row.line}`).not.toContain("retrievedat");
    }
  });

  it("fails closed rather than guessing when the predicate cannot be read", () => {
    // A spread hides its fields; `not` and `in` are filters, not equalities. Each must land in
    // UNPROVEN_FAIL_CLOSED with the reason named, never in CARDINALITY_ONE_PROVEN.
    const spread = at("domain/companyXray.ts", 206);
    expect(spread.verdict).toBe("UNPROVEN_FAIL_CLOSED");
    expect(spread.citation).toContain("spread");

    const negated = at("domain/companyXray.ts", 107);
    expect(negated.verdict).toBe("UNPROVEN_FAIL_CLOSED");
    expect(negated.citation).toContain("not");

    for (const row of rows) {
      if (row.verdict !== "UNPROVEN_FAIL_CLOSED") continue;
      expect(row.citation.length, `${row.file}:${row.line} gives no reason`).toBeGreaterThan(20);
    }
  });

  it("reports a model with no unique key at all as multi-candidate", () => {
    const row = at("domain/causalGraph.ts", 27);
    expect(row.verdict).toBe("MULTI_CANDIDATE");
    expect(row.model).toBe("causalEdge");
    expect(row.whereFields).toEqual(["fromVariable", "toVariable"]);
  });

  /**
   * The partial-index proof, and why field presence was not enough.
   *
   * Review found the classifier unsound: it chose an authority with
   * `keys.find((k) => k.fields.every((f) => fields.has(f)))` and, when the winner was PARTIAL,
   * appended prose saying it "holds only WHERE …". A warning is not a proof. A partial index
   * constrains only the rows its predicate selects, so pinning its columns says nothing about a
   * candidate outside it — and `periodStart: fact.periodStart` is exactly a value this cannot
   * evaluate statically.
   *
   * What makes this site sound is that the two partial indexes PARTITION the domain: every
   * candidate has `periodStart` either null or not null, and each branch has an index with all its
   * fields pinned. The citation has to show the union, because showing one index would be the
   * unsound inference again.
   */
  it("proves a partial-index site only as a union that partitions the domain", () => {
    const row = at("adapters/edgar-xbrl/ingest.ts", 61);
    expect(row.verdict).toBe("CARDINALITY_ONE_PROVEN");
    expect(row.citation).toContain("UNION OF PARTIAL INDEXES");
    expect(row.citation).toContain("financial_facts_duration_identity_unique");
    expect(row.citation).toContain("financial_facts_instant_identity_unique");
    // The dropped constraint must never be cited as live authority.
    expect(row.citation).not.toContain("periodEnd_ac_key");
  });

  /**
   * Half a partition covers half the domain.
   *
   * The fixture keeps ONE of the two complementary indexes — the duration one, `WHERE periodStart
   * IS NOT NULL` — and nothing else changes. The query still pins every one of its columns, so the
   * old field-presence rule would still promote it. It must not: an instant fact has a null
   * `periodStart`, falls outside the index, and is unconstrained.
   */
  it("refuses a lone partial index even when the query pins all of its columns", () => {
    const weakened = weakenSchema((s) => {
      const keys = s.uniqueKeys.get("financialFact") ?? [];
      s.uniqueKeys.set(
        "financialFact",
        keys.filter((k) => k.name !== "financial_facts_instant_identity_unique"),
      );
    });
    const row = rowAt(auditCardinality(weakened), "adapters/edgar-xbrl/ingest.ts", 61);
    expect(row.verdict).not.toBe("CARDINALITY_ONE_PROVEN");
    expect(row.citation).not.toContain("UNION OF PARTIAL INDEXES");
  });

  /**
   * The uniqueness mutation the governing task required, and it is not self-proof: the classifier
   * consumes the schema, so weakening the schema tests the classifier's reasoning rather than an
   * expected table it also owns.
   *
   * Removing `@unique` from `Source.code` breaks TWO proofs at once, and both must move. The
   * direct one is `source.findFirst({ where: { code } })`. The derived one is the relation
   * invariant: without a unique `code`, `{ source: { code } }` no longer determines `sourceId`, so
   * `@@unique(sourceId, externalId)` is no longer pinned either.
   */
  it("stops proving cardinality when the uniqueness authority it cited is removed", () => {
    const weakened = weakenSchema((s) => {
      const keys = s.uniqueKeys.get("source") ?? [];
      // BOTH authorities, and finding that out was the point of running it. Removing only the
      // schema `@unique` changed nothing, because migration DDL declares `sources_code_key` over
      // the same column and the classifier correctly still proved the site. The two authorities
      // are genuinely independent, so a mutation that weakens one is not a weakening at all.
      s.uniqueKeys.set(
        "source",
        keys.filter((k) => k.fields.join() !== "code"),
      );
    });
    const after = auditCardinality(weakened);

    const direct = rowAt(after, "verify/shadowRun.ts", 315);
    expect(direct.verdict).not.toBe("CARDINALITY_ONE_PROVEN");

    for (const [file, line] of [
      ["domain/macroRegime.ts", 85],
      ["verify/shadowRun.ts", 401],
    ] as const) {
      const derived = rowAt(after, file, line);
      expect(derived.verdict, `${file}:${line}`).not.toBe("CARDINALITY_ONE_PROVEN");
    }

    // And the mutation must be targeted: a site that never cited Source.code is unaffected.
    expect(rowAt(after, "adapters/edgar-xbrl/ingest.ts", 61).verdict).toBe(
      "CARDINALITY_ONE_PROVEN",
    );
  });

  /**
   * Migration DDL as the second uniqueness authority, and the ordering that keeps it honest.
   *
   * `FinancialFact` declares no `@@unique`, so a schema-only audit called this site
   * MULTI_CANDIDATE and the real database refused to reproduce it. Both indexes that DO constrain
   * it come from migration SQL. The citation must name only LIVE ones: the same migration drops
   * `..._periodEnd_ac_key` in a `DO` block that drops by shape, so citing it would be a proof
   * nobody can look up.
   */
  /**
   * Complementary partials partition the UNIVERSE, which is not the same as making the union
   * unique. Review found the first version accepting exactly that.
   *
   * Here the two partial indexes are moved to partition over `fiscalYear`, a column the ingest
   * query does not constrain, while every KEY field they name stays pinned. Each index is still
   * individually unique. The query can therefore match one row on each side of the partition — two
   * rows, one `findFirst`, an arbitrary winner — so it must NOT be promoted.
   */
  it("refuses a partition the query does not constrain, even with both branches fully pinned", () => {
    const weakened = weakenSchema((s) => {
      const keys = (s.uniqueKeys.get("financialFact") ?? []).map((k) =>
        k.partial
          ? {
              ...k,
              partial: k.partial.replace(/"periodStart"/, '"fiscalYear"'),
            }
          : k,
      );
      s.uniqueKeys.set("financialFact", keys);
    });
    const row = rowAt(auditCardinality(weakened), "adapters/edgar-xbrl/ingest.ts", 61);
    expect(row.verdict).not.toBe("CARDINALITY_ONE_PROVEN");
    expect(row.whereFields).not.toContain("fiscalYear");
  });

  /**
   * The positive half of that pair, on the real schema: the same site, the same key coverage, and
   * the partition column IS pinned. The citation must say so — a union proof that does not mention
   * the query's constraint on the partition column is the unsound version wearing the right words.
   */
  it("accepts the union only when the query pins the partition column", () => {
    const row = at("adapters/edgar-xbrl/ingest.ts", 61);
    expect(row.verdict).toBe("CARDINALITY_ONE_PROVEN");
    expect(row.citation).toContain("pins `periodStart` by equality");
    expect(row.citation).toContain("exactly one partition");
    expect(row.whereFields).toContain("periodStart");
  });

  it("reads migration DDL as a second uniqueness authority, and cites only live indexes", () => {
    const row = at("adapters/edgar-xbrl/ingest.ts", 61);
    expect(row.verdict).toBe("CARDINALITY_ONE_PROVEN");
    for (const liveIndex of [
      "financial_facts_duration_identity_unique",
      "financial_facts_instant_identity_unique",
    ]) {
      expect(row.citation).toContain(liveIndex);
    }
    expect(row.citation).not.toContain("periodEnd_ac_key");
  });
});

/**
 * The static verdict is a claim about DDL. This asks the real database whether it behaves that way,
 * because only the second one settles it — and on the first run the two disagreed.
 */
describe("the cardinality verdicts, against a real database", () => {
  it("refuses a second FinancialFact the ingest predicate cannot tell apart", async () => {
    const source = await prisma.source.create({
      data: { code: `CARD-TEST-${Date.now()}`, name: "cardinality control", tier: "TIER_S" },
    });
    const shared = {
      sourceId: source.id,
      corpCode: "CARD0001",
      concept: "Revenues",
      unit: "USD",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-03-31"),
      accessionNumber: "0000000000-26-000001",
      taxonomy: "us-gaap",
      form: "10-Q",
      filedDate: new Date("2026-04-15"),
      raw: {},
      retrievedAt: new Date(),
    };
    try {
      await prisma.financialFact.create({ data: { ...shared, value: 100 } });
      // The partial index holds because `periodStart` is not null. Two rows identical under the
      // ingest's predicate cannot coexist, so its unordered `findFirst` has nothing to choose
      // between and the missing `orderBy` decides nothing.
      await expect(
        prisma.financialFact.create({ data: { ...shared, value: 200 } }),
      ).rejects.toThrow();
    } finally {
      await prisma.financialFact.deleteMany({ where: { sourceId: source.id } });
      await prisma.source.delete({ where: { id: source.id } });
    }
  });

  /**
   * The two-partition witness: the concrete reason the partition column has to be constrained.
   *
   * Two FinancialFact rows, identical on every field the ingest predicate pins EXCEPT
   * `periodStart` — one null, one a real date. Both persist, because each falls under a different
   * partial index and neither index constrains the other's side. A query that omits `periodStart`
   * therefore matches BOTH, and an unordered `findFirst` picks one arbitrarily. This is what the
   * first version of the union proof would have called single-row.
   */
  it("keeps one row on each side of the partition, so an unconstrained query matches both", async () => {
    const source = await prisma.source.create({
      data: { code: `PART-TEST-${Date.now()}`, name: "partition control", tier: "TIER_S" },
    });
    const shared = {
      sourceId: source.id,
      corpCode: "PART0001",
      concept: "Assets",
      unit: "USD",
      periodEnd: new Date("2026-03-31"),
      accessionNumber: "0000000000-26-000009",
      taxonomy: "us-gaap",
      form: "10-Q",
      filedDate: new Date("2026-04-15"),
      raw: {},
      retrievedAt: new Date(),
    };
    try {
      const instant = await prisma.financialFact.create({
        data: { ...shared, periodStart: null, value: 10 },
      });
      const duration = await prisma.financialFact.create({
        data: { ...shared, periodStart: new Date("2026-01-01"), value: 20 },
      });
      expect(instant.id).not.toBe(duration.id);

      // The predicate WITHOUT the partition column -- exactly the shape the fixed proof refuses.
      const both = await prisma.financialFact.findMany({
        where: {
          sourceId: shared.sourceId,
          corpCode: shared.corpCode,
          concept: shared.concept,
          unit: shared.unit,
          periodEnd: shared.periodEnd,
          accessionNumber: shared.accessionNumber,
        },
      });
      expect(both.length).toBe(2);

      // And WITH it, each side is single-row, which is what makes the real site provable.
      const one = await prisma.financialFact.findMany({
        where: {
          sourceId: shared.sourceId,
          corpCode: shared.corpCode,
          concept: shared.concept,
          unit: shared.unit,
          periodEnd: shared.periodEnd,
          accessionNumber: shared.accessionNumber,
          periodStart: null,
        },
      });
      expect(one.length).toBe(1);
      expect(Number(one[0].value)).toBe(10);
    } finally {
      await prisma.financialFact.deleteMany({ where: { sourceId: source.id } });
      await prisma.source.delete({ where: { id: source.id } });
    }
  });

  it("accepts two CausalEdge rows that its predicate cannot tell apart", async () => {
    const tag = `CARD-${Date.now()}`;
    try {
      const first = await prisma.causalEdge.create({
        data: {
          fromVariable: tag,
          toVariable: `${tag}-to`,
          direction: "POSITIVE",
          confidence: "MEDIUM",
          mechanism: "cardinality control",
          evidence: "synthetic row for an audit control",
          lag: "n/a",
          counterexamples: "none; this row exists only to prove two can coexist",
        },
      });
      const second = await prisma.causalEdge.create({
        data: {
          fromVariable: tag,
          toVariable: `${tag}-to`,
          direction: "NEGATIVE",
          confidence: "MEDIUM",
          mechanism: "cardinality control",
          evidence: "synthetic row for an audit control",
          lag: "n/a",
          counterexamples: "none; this row exists only to prove two can coexist",
        },
      });
      expect(second.id).not.toBe(first.id);
      const matching = await prisma.causalEdge.findMany({
        where: { fromVariable: tag, toVariable: `${tag}-to` },
      });
      // Two rows, identical under the predicate, OPPOSITE directions. An unordered `findFirst`
      // returns whichever the database hands back, and the two disagree about the sign of the
      // relationship — which is the whole content of the edge.
      expect(matching.length).toBe(2);
      expect(new Set(matching.map((r) => r.direction))).toEqual(new Set(["POSITIVE", "NEGATIVE"]));
    } finally {
      await prisma.causalEdge.deleteMany({ where: { fromVariable: tag } });
    }
  });
});
