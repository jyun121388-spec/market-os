import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every dimension a fixture is single-valued on is a defect it cannot exhibit.
 *
 * `FIXTURE_REALISM` is a five-instance cluster at P0, and every instance has the same shape: a
 * test suite was green because its data could not express the failure. No fixture contained two
 * facts sharing a period end with different durations, so the +232.9985% comparison was
 * unwritable as a test. None exceeded the provider's row cap, so the 1000-of-2240 truncation was
 * unreachable. None had two facts differing only by period start, so a uniqueness key that
 * discarded 168 rows per ingest looked sufficient.
 *
 * The countermeasure the scheduler surfaced: for each fixture, list the dimensions along which the
 * real data varies and mark which are represented by exactly one value.
 *
 * Doing that by hand found the single-valued dimensions below. Each was then checked against the
 * suite, and every one turned out to be covered — by an INLINE stub in a client or normalize test
 * rather than by the shared JSON fixture. That is a real answer and not a comfortable one: the
 * coverage exists, and it exists somewhere the fixture gives no hint of, so the next person to
 * reach for a fixture and conclude "this is what a response looks like" will conclude wrongly.
 *
 * This test is the record of that pairing. It asserts the cardinality that matters and names where
 * the missing variety is covered instead, so a NEW fixture cannot be added single-valued on a
 * dimension that has already cost this project a defect.
 */

const fixture = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "src/server/adapters", path), "utf8"));

const distinct = (values: unknown[]) => new Set(values.map((v) => JSON.stringify(v))).size;

describe("EDGAR companyfacts fixture", () => {
  const raw = fixture("edgar-xbrl/__fixtures__/apple-companyfacts.json");
  const facts = Object.values(
    raw.facts["us-gaap"] as Record<string, { units: Record<string, Record<string, unknown>[]> }>,
  ).flatMap((concept) => Object.values(concept.units).flat());

  /**
   * This fixture carries the variety that cost the most, and it is the one to imitate: two forms,
   * `fy` both null and numeric, `start` both present and absent, and several facts sharing a
   * period end. Every one of those was a separate defect before it was a fixture dimension.
   */
  it("still expresses every dimension that produced a real defect", () => {
    expect(distinct(facts.map((f) => f.form)), "10-K vs 10-Q").toBeGreaterThan(1);
    expect(distinct(facts.map((f) => f.fy === null)), "SEC really returns fy: null").toBe(2);
    expect(
      distinct(facts.map((f) => f.start === undefined)),
      "duration facts have a start, instants do not",
    ).toBe(2);
    // The +232.9985% defect in one line: two facts, one period end, different durations.
    const byEnd = new Map<unknown, number>();
    for (const f of facts) byEnd.set(f.end, (byEnd.get(f.end) ?? 0) + 1);
    expect(Math.max(...byEnd.values()), "facts sharing one period end").toBeGreaterThan(1);
  });
});

describe("dimensions the shared fixtures cannot express", () => {
  /**
   * Each entry names a dimension a fixture is single-valued on, and the test that covers it with
   * an inline stub instead. The pairing is the point: a single-valued dimension is only acceptable
   * while something else exercises it, and this fails if that something else disappears.
   */
  const coveredElsewhere: { dimension: string; coveredBy: string; needle: string }[] = [
    {
      dimension: "edgar submissions: filings.files[] overflow beyond the 1000-row cap",
      coveredBy: "tests/integration/edgar-ingest.test.ts",
      needle: "files:",
    },
    {
      dimension: "dart: total_page > 1, and an empty page before the declared end",
      coveredBy: "tests/adapters/pagination.test.ts",
      needle: "total_page",
    },
    {
      dimension: "fred/ecos: a short page before the provider-declared total",
      coveredBy: "tests/adapters/pagination.test.ts",
      needle: "declared total",
    },
  ];

  it.each(coveredElsewhere)("$dimension → $coveredBy", ({ coveredBy, needle }) => {
    const source = readFileSync(join(process.cwd(), coveredBy), "utf8");
    expect(source).toContain(needle);
  });

  /**
   * And the cardinality itself, asserted so the pairing above cannot silently become stale in the
   * other direction. If a fixture GAINS one of these dimensions the entry should move out of the
   * list above and into the fixture, and this is where that gets noticed.
   */
  it("records that the shared fixtures are still single-valued on those dimensions", () => {
    const submissions = fixture("edgar/__fixtures__/apple-submissions.json");
    expect(submissions.filings.files ?? []).toEqual([]);

    const dart = fixture("dart/__fixtures__/samsung-list.json");
    expect(dart.total_page).toBe(1);

    // Both providers declare a total that equals what they returned, so a short page — the IR-030
    // case — is unreachable from these fixtures.
    const fred = fixture("fred/__fixtures__/dgs10.json");
    expect(fred.count).toBe(fred.observations.length);
    const ecos = fixture("ecos/__fixtures__/base-rate.json");
    const rows = ecos.StatisticSearch.row as { DATA_VALUE: string; TIME: string }[];
    expect(ecos.StatisticSearch.list_total_count).toBe(rows.length);
    expect(distinct(rows.map((r) => r.TIME.length)), "one TIME cycle format only").toBe(1);
  });

  /**
   * Two of the five "single-valued" dimensions in the first pass were a measurement error, and
   * the assertions above caught them before they became a finding.
   *
   * The probe counted MATCHING ROWS and the reader — me — read the answer as a CARDINALITY. One
   * row with a `.` value came back as "1", which looks identical to "one distinct value" and means
   * the opposite. Both fixtures already carry the missing-value marker they were reported as
   * lacking, and writing that up as a gap would have produced exactly the kind of confident,
   * well-formed, wrong finding the EVIDENCE_FABRICATION cluster is about — from a script rather
   * than a model, which is not a meaningful difference.
   */
  it("has the missing-value markers the first pass reported as absent", () => {
    const fred = fixture("fred/__fixtures__/dgs10.json");
    expect(fred.observations.some((o: { value: string }) => o.value === ".")).toBe(true);

    const ecos = fixture("ecos/__fixtures__/base-rate.json");
    const rows = ecos.StatisticSearch.row as { DATA_VALUE: string }[];
    expect(rows.some((r) => !Number.isFinite(Number(r.DATA_VALUE)))).toBe(true);
  });
});
