import { describe, expect, it } from "vitest";
import { auditCardinality } from "../scripts/recency-cardinality";
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
const at = (file: string, line: number) => {
  const row = rows.find((r) => r.file === file && r.line === line);
  if (!row) throw new Error(`no audited site at ${file}:${line} — the audit's scope moved`);
  return row;
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
   * The control that caught this audit being WRONG, kept as a regression.
   *
   * `edgar-xbrl/ingest.ts:61` was first reported MULTI_CANDIDATE, because the audit read only
   * `schema.prisma` and `FinancialFact` declares no `@@unique`. The real database refused the
   * duplicate. The identity of a fact includes `periodStart`, which is NULL for instant concepts,
   * and Postgres treats NULL as distinct from NULL in a unique index — so it CANNOT be a Prisma
   * `@@unique` and is enforced by two partial indexes in migration DDL instead.
   *
   * So the citation must name the LIVE partial index and its predicate. Naming the old
   * `..._periodEnd_ac_key` would be a dead citation: the same migration drops it, by shape, in a
   * DO block. A proof nobody can look up is not a proof.
   */
  it("reads migration DDL as a second uniqueness authority, and cites the live index", () => {
    const row = at("adapters/edgar-xbrl/ingest.ts", 61);
    expect(row.verdict).toBe("CARDINALITY_ONE_PROVEN");
    expect(row.citation).toContain("financial_facts_duration_identity_unique");
    expect(row.citation).toContain("PARTIAL");
    expect(row.citation).toContain("IS NOT NULL");
    // The dropped constraint must never be cited as live authority.
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
