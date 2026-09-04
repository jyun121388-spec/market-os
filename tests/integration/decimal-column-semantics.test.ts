import { describe, expect, it } from "vitest";
import { sameDecimalValue } from "@/server/domain/observationIngest";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

/**
 * The contract `sameDecimalValue` is actually making, checked against the database rather than
 * against reasoning about the database.
 *
 * The helper compares incoming values at `Decimal(20, 6)` — the observation column's real type —
 * rounding half away from zero. Both of those are claims about PostgreSQL, and both were, until
 * this file existed, claims supported only by what a JavaScript test asserted about a JavaScript
 * function. That is the kind of agreement that holds right up until the column disagrees.
 *
 * So the assertions here are generated FROM the database. Each candidate is cast through
 * `numeric(20, 6)` by PostgreSQL itself, and the helper is required to agree with what came back:
 *
 *  - a value the column stores identically must compare EQUAL, or ingest manufactures a revision
 *    that records no change;
 *  - a value the column stores differently must compare UNEQUAL, or a real revision is silently
 *    dropped and the rollback guard can be walked past with a different notation.
 *
 * `numeric` rounding is half away from zero rather than banker's rounding, which is why
 * `1.2345665` lands on `1.234567` here and would land on `1.234566` under the other rule. Nothing
 * in this repository had established that before; the helper was written to match the assumption,
 * and this file is what turns the assumption into a checked fact.
 */
describeIfDb("sameDecimalValue agrees with the column it models (integration)", () => {
  /**
   * Every spelling the adapters can deliver plus the rounding boundaries, including both signs of
   * the exact-half case, which is where half-away-from-zero and banker's rounding disagree.
   */
  const CANDIDATES = [
    "0.0000005",
    "-0.0000005",
    "0.0000004",
    "-0.0000004",
    "1.2345675",
    "-1.2345675",
    "1.2345665",
    "-1.2345665",
    "1.2345678",
    "2.5e-7",
    "1e5",
    "1E+5",
    "+1",
    ".5",
    "10.500000",
    "-0.000000",
    "10000000000000.000001",
    "10000000000000.000002",
  ] as const;

  async function storedForm(values: readonly string[]): Promise<Map<string, string>> {
    const { prisma } = await import("@/server/db/client");
    const rows = await prisma.$queryRawUnsafe<{ raw: string; stored: string }[]>(
      `select v as raw, cast(v as numeric(20,6))::text as stored
         from unnest($1::text[]) as t(v)`,
      values as unknown as string[],
    );
    return new Map(rows.map((row) => [row.raw, row.stored]));
  }

  it("calls two values the same figure exactly when the column does", async () => {
    const stored = await storedForm(CANDIDATES);
    expect(stored.size, "every candidate must come back from the database").toBe(CANDIDATES.length);

    const disagreements: string[] = [];
    for (const left of CANDIDATES) {
      for (const right of CANDIDATES) {
        // What the database says: identical once both have landed in the column.
        const columnSaysSame = stored.get(left) === stored.get(right);
        const helperSaysSame = sameDecimalValue(left, right);
        if (columnSaysSame !== helperSaysSame) {
          disagreements.push(
            `${left} vs ${right}: column stores ${stored.get(left)} and ${stored.get(right)} ` +
              `(same=${columnSaysSame}) but the helper says same=${helperSaysSame}`,
          );
        }
      }
    }

    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  it("rounds half away from zero, in both directions, as numeric does", async () => {
    // Pinned separately from the sweep above because it is the specific rule the helper encodes,
    // and a sweep that happened to contain no exact-half pair would pass without testing it.
    const stored = await storedForm([
      "0.0000005",
      "-0.0000005",
      "1.2345665",
      "-1.2345665",
      "0.000001",
      "-0.000001",
      "1.234567",
      "-1.234567",
    ]);

    expect(stored.get("0.0000005")).toBe("0.000001");
    expect(stored.get("-0.0000005")).toBe("-0.000001");
    expect(stored.get("1.2345665")).toBe("1.234567");
    expect(stored.get("-1.2345665")).toBe("-1.234567");

    expect(sameDecimalValue("0.0000005", "0.000001")).toBe(true);
    expect(sameDecimalValue("-0.0000005", "-0.000001")).toBe(true);
    expect(sameDecimalValue("1.2345665", "1.234567")).toBe(true);
    expect(sameDecimalValue("-1.2345665", "-1.234567")).toBe(true);
  });

  it("keeps the six-decimal difference a double cannot see", async () => {
    // D1 restated as a column fact: these are two DIFFERENT rows in PostgreSQL, and the original
    // `Number()` comparison could not tell them apart.
    const stored = await storedForm(["10000000000000.000001", "10000000000000.000002"]);
    expect(stored.get("10000000000000.000001")).not.toBe(stored.get("10000000000000.000002"));
    expect(sameDecimalValue("10000000000000.000001", "10000000000000.000002")).toBe(false);
  });
});
