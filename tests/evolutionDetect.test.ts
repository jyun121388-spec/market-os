import { describe, expect, it } from "vitest";
import { BACKFILLED_LEDGER, type LedgerEntry } from "@/server/evolution/ledger";
import {
  detectWeaknesses,
  isolatedIncidents,
  MIN_INSTANCES_FOR_WEAKNESS,
} from "@/server/evolution/detect";

/**
 * Evolution Engine — detection slice (docs/EVOLUTION_ENGINE.md).
 *
 * The promotion criterion set out in the architecture doc is the standard applied here: the
 * detector must **rediscover the known weaknesses from ledger data without them being hard-coded**.
 * If it cannot re-derive history it already has, it will not detect anything new — the same
 * positive-control requirement that disqualified the local review models, turned on this layer.
 *
 * The negative controls matter equally. A detector that calls everything a weakness has detected
 * nothing, and would bury the real clusters in noise.
 */

describe("Evolution — rediscovers this project's real weaknesses", () => {
  const weaknesses = detectWeaknesses(BACKFILLED_LEDGER);
  const categories = weaknesses.map((w) => w.category);

  it("finds the fixture-realism cluster, the largest one", () => {
    // Fixtures containing one of something the real world has many of: one duration, one CIK
    // representation, one provider. The single most productive lesson in this repository.
    const fixture = weaknesses.find((w) => w.category === "FIXTURE_REALISM")!;
    expect(fixture).toBeDefined();
    expect(fixture.instances.length).toBeGreaterThanOrEqual(4);
    expect(fixture.instances).toContain("FG-01"); // the +233% comparison
    expect(fixture.instances).toContain("FG-05"); // single-provider fixtures
  });

  it.each([
    "IDENTITY_MODELLING",
    "SILENT_DEGRADATION",
    "PROVIDER_ASSUMPTION",
    "GUARDRAIL_COVERAGE",
    "CONCURRENCY",
    "PROVENANCE",
  ])("finds the %s cluster", (category) => {
    expect(categories).toContain(category);
  });

  it("labels a cluster SYSTEMIC only when it spans more than one subsystem", () => {
    // An earlier version of this test DEMANDED breadth of every weakness, and it failed —
    // correctly. Two different concurrency mistakes inside one module are still a recurring
    // cause worth naming; they are just weaker evidence that the whole codebase shares it. The
    // detector records the distinction instead of deciding for the reader.
    for (const w of weaknesses) {
      const expected = w.subsystems.length > 1 ? "SYSTEMIC" : "LOCALISED";
      expect(w.scope, `${w.category} mislabelled`).toBe(expected);
    }
    expect(weaknesses.some((w) => w.scope === "SYSTEMIC")).toBe(true);
  });

  it("ranks the most-recurring cluster first", () => {
    expect(weaknesses[0].instances.length).toBeGreaterThanOrEqual(weaknesses[1].instances.length);
  });

  it("carries the lessons, not just the labels", () => {
    // The category is a filing label. The lesson is the content, and a reader has to be able to
    // judge the cluster rather than trust the name it was given.
    for (const w of weaknesses) {
      expect(w.lessons.length).toBe(w.instances.length);
      for (const lesson of w.lessons) expect(lesson.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("Evolution — does not manufacture weaknesses", () => {
  it("reports nothing for an empty ledger", () => {
    expect(detectWeaknesses([])).toEqual([]);
  });

  it("does not promote a single incident to a weakness", () => {
    // One occurrence is an incident. Calling it systemic would let any one-off drive a proposal.
    const single = BACKFILLED_LEDGER.filter((e) => e.category === "CONCURRENCY").slice(0, 1);
    expect(single).toHaveLength(1);
    expect(detectWeaknesses(single)).toEqual([]);
  });

  it("promotes it once it recurs", () => {
    const pair = BACKFILLED_LEDGER.filter((e) => e.category === "CONCURRENCY").slice(0, 2);
    expect(pair).toHaveLength(MIN_INSTANCES_FOR_WEAKNESS);
    const found = detectWeaknesses(pair);
    expect(found).toHaveLength(1);
    expect(found[0].category).toBe("CONCURRENCY");
  });

  it("keeps non-recurring entries visible rather than discarding them", () => {
    // A single incident must not vanish just because it is not yet a pattern; it is the first
    // half of one.
    const single = BACKFILLED_LEDGER.filter((e) => e.category === "CONCURRENCY").slice(0, 1);
    expect(isolatedIncidents(single).map((e) => e.id)).toEqual([single[0].id]);
  });

  it("reports every ledger entry exactly once, as either clustered or isolated", () => {
    // Nothing may be silently dropped. Losing an entry between the two paths would be this
    // layer's own version of the silent-degradation weakness it exists to detect.
    const clustered = detectWeaknesses(BACKFILLED_LEDGER).flatMap((w) => w.instances);
    const isolated = isolatedIncidents(BACKFILLED_LEDGER).map((e) => e.id);
    expect([...clustered, ...isolated].sort()).toEqual(BACKFILLED_LEDGER.map((e) => e.id).sort());
  });
});

describe("Evolution — the ledger itself", () => {
  it("has unique ids", () => {
    const ids = BACKFILLED_LEDGER.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states a lesson, not a fix, for every entry", () => {
    // "Fixed the diff" is a changelog line. The Engine reads lessons, so an entry phrased as a
    // fix contributes nothing and would quietly weaken its cluster.
    for (const entry of BACKFILLED_LEDGER) {
      expect(entry.lesson.trim().length, `${entry.id} has no lesson`).toBeGreaterThan(20);
      expect(entry.lesson.toLowerCase(), `${entry.id} describes a fix`).not.toMatch(
        /^(fixed|added|removed|changed|updated)\b/,
      );
    }
  });
});

/**
 * Cases identified as untested by an independent audit of this module (`gpt-5.6-luna`).
 * Constructed inputs rather than the backfilled ledger, because each one needs a shape the real
 * history does not happen to contain - which is precisely why they were missing.
 */
describe("Evolution — detector mechanics", () => {
  const entry = (over: Partial<LedgerEntry> & Pick<LedgerEntry, "id">): LedgerEntry => ({
    ledger: "REVIEW_FINDING",
    subsystem: "alpha",
    severity: "P3",
    summary: "synthetic",
    lesson: "A synthetic lesson long enough to satisfy the ledger's own content requirement.",
    category: "CONCURRENCY",
    ...over,
  });

  it("reports the WORST severity in a cluster, not the first or last", () => {
    // Ordering the input P3, P1, P0 and then P0, P1, P3 catches a reducer that simply keeps
    // whichever it saw first.
    const ascending = [
      entry({ id: "a", severity: "P3" }),
      entry({ id: "b", severity: "P1" }),
      entry({ id: "c", severity: "P0" }),
    ];
    expect(detectWeaknesses(ascending)[0].worstSeverity).toBe("P0");
    expect(detectWeaknesses([...ascending].reverse())[0].worstSeverity).toBe("P0");
  });

  it("deduplicates subsystems", () => {
    const found = detectWeaknesses([
      entry({ id: "a", subsystem: "alpha" }),
      entry({ id: "b", subsystem: "alpha" }),
      entry({ id: "c", subsystem: "beta" }),
    ]);
    expect(found[0].subsystems.sort()).toEqual(["alpha", "beta"]);
  });

  it("labels a deliberately single-subsystem cluster LOCALISED", () => {
    const found = detectWeaknesses([
      entry({ id: "a", subsystem: "alpha" }),
      entry({ id: "b", subsystem: "alpha" }),
    ]);
    expect(found[0].scope).toBe("LOCALISED");
  });

  it("breaks a tie on instance count by category name, so output is stable", () => {
    // Two clusters of equal size must not swap places between runs; an unstable order would make
    // any diff of this output unreadable.
    const input = [
      entry({ id: "a", category: "CONCURRENCY" }),
      entry({ id: "b", category: "CONCURRENCY" }),
      entry({ id: "c", category: "PROVENANCE" }),
      entry({ id: "d", category: "PROVENANCE" }),
    ];
    const first = detectWeaknesses(input).map((w) => w.category);
    const second = detectWeaknesses([...input].reverse()).map((w) => w.category);
    expect(first).toEqual(["CONCURRENCY", "PROVENANCE"]);
    expect(second).toEqual(first);
  });

  it("separates clustered from isolated when both are present in one input", () => {
    const input = [
      entry({ id: "a", category: "CONCURRENCY" }),
      entry({ id: "b", category: "CONCURRENCY" }),
      entry({ id: "lonely", category: "PROVENANCE" }),
    ];
    expect(detectWeaknesses(input).flatMap((w) => w.instances)).toEqual(["a", "b"]);
    expect(isolatedIncidents(input).map((e) => e.id)).toEqual(["lonely"]);
  });
});
