import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every ordering in the domain layer must be total, or say why it need not be.
 *
 * The `IDENTITY_MODELLING` cluster stands at ten recorded instances and the Evolution scheduler
 * ranked it first, with a countermeasure that reads: enumerate every ordering in
 * `src/server/domain`, state the scope each is unique within, and the mismatches are the next
 * instances before they happen. This is that enumeration, as a test rather than a document, so it
 * keeps working after the person who ran it has moved on.
 *
 * The failure it guards against is specific and has happened three times here. A query orders on a
 * column that TIES, the database is free to return either row first, and something downstream
 * treats the first row as the answer. `retrievedAt` on a `timestamp(3)` did it twice —
 * non-deterministically, which is the worst way for a financial figure to be wrong, because it is
 * right most of the time. `periodEnd` does it structurally: one filing reports the same concept
 * over a nine-month and a three-month span ending on the same date, so a nine-way tie at the top
 * of an Apple query is ordinary rather than exotic.
 *
 * A site passes if its ordering ends in something unique — `id` — or if it carries an
 * `ORDERING_WAIVER:` comment saying why ties cannot matter there. The waiver is deliberately a
 * sentence someone has to write: "this list is only displayed" is a fine reason and "I did not
 * think about it" is not, and the difference is only visible when it is spelled out.
 */

const DOMAIN_DIR = join(process.cwd(), "src", "server", "domain");
const WAIVER = "ORDERING_WAIVER:";

interface OrderingSite {
  file: string;
  line: number;
  expression: string;
  waived: boolean;
}

/**
 * Finds every `orderBy` and captures the expression, by matching brackets rather than by regex.
 *
 * A regex over a multi-line Prisma ordering would either stop at the first newline or swallow the
 * rest of the query, and a checker that silently mis-parses is worse than none — it reports green
 * over sites it never read.
 */
function findOrderings(source: string, file: string): OrderingSite[] {
  const sites: OrderingSite[] = [];
  const needle = "orderBy:";

  for (
    let index = source.indexOf(needle);
    index !== -1;
    index = source.indexOf(needle, index + 1)
  ) {
    // Skip occurrences inside a comment or a string: the domain files quote past defective
    // orderings in their own explanations, and flagging those would be flagging documentation.
    const lineStart = source.lastIndexOf("\n", index) + 1;
    const linePrefix = source.slice(lineStart, index);
    if (/^\s*(\/\/|\*|\/\*)/.test(linePrefix) || /["'`]\s*$/.test(linePrefix.trimEnd())) continue;

    let depth = 0;
    let end = index + needle.length;
    while (end < source.length) {
      const char = source[end];
      if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      } else if (char === "," && depth === 0) break;
      end++;
    }

    const expression = source.slice(index, end);
    const line = source.slice(0, index).split("\n").length;
    // The waiver may sit on the line above, or anywhere in the twelve lines before — Prisma calls
    // are wrapped, and demanding an exact position would make the escape hatch harder to use than
    // the thing it excuses.
    const before = source.slice(Math.max(0, lineStart - 900), lineStart);
    sites.push({ file, line, expression, waived: before.includes(WAIVER) });
  }

  return sites;
}

const orderingSites = readdirSync(DOMAIN_DIR)
  .filter((name) => name.endsWith(".ts"))
  .flatMap((name) => findOrderings(readFileSync(join(DOMAIN_DIR, name), "utf8"), `domain/${name}`));

/**
 * Sites that genuinely can tie, where the tie genuinely matters, and which are NOT fixed.
 *
 * Both are in Ask Market and both are latent: today one provider and one matching company make the
 * outcome deterministic in practice. They are P2 — nothing wrong is displayed, the answer is just
 * not guaranteed to be the same answer twice — and v1 is frozen except for reproduced P0/P1. They
 * are listed here rather than waived because a waiver claims ties cannot matter, and here they can.
 *
 * Recorded in `docs/REVIEW_DEBT.md`. The list is checked in BOTH directions below: a new undecided
 * site fails, and so does an entry here that has been fixed, so it cannot quietly become a place
 * where defects are parked.
 */
const DEFERRED_BY_FREEZE = [
  // `filing.findMany({ orderBy: receiptDate desc })` then `.find(name matches)` — with two
  // companies matching one topic, which company answers depends on an unstable order.
  "domain/askMarket.ts",
  // `financialFact.findMany({ orderBy: periodEnd desc, take: 10 })` — Apple has nine facts sharing
  // one periodEnd, including a nine-month and a quarterly NetIncomeLoss. At ten or more, which
  // figures reach the reader becomes unspecified. companyXray and filingDiff both fixed this; this
  // path was missed.
  "domain/askMarket.ts",
];

describe("orderings in the domain layer", () => {
  it("finds the orderings at all, so a green result means something", () => {
    // A parser that matched nothing would pass every assertion below. The count is asserted
    // loosely — it should grow with the codebase — but a collapse to zero is caught.
    expect(orderingSites.length).toBeGreaterThanOrEqual(10);
  });

  it("is either total or explains itself", () => {
    const undecided = orderingSites.filter(
      (site) => !site.waived && !/\bid:\s*"(asc|desc)"/.test(site.expression),
    );

    const unexpected = undecided.filter((s) => !DEFERRED_BY_FREEZE.includes(s.file));
    expect(
      unexpected.map((s) => `${s.file}:${s.line}`),
      "these orderings can tie, and nothing says what happens when they do — add a unique " +
        `tiebreak or an ${WAIVER} comment saying why ties cannot matter`,
    ).toEqual([]);
  });

  /**
   * The deferred list cannot rot in either direction. If Ask Market's orderings are made total the
   * count drops and this fails, forcing the entry out — otherwise a list of known gaps slowly
   * becomes a list of things nobody has looked at since.
   */
  it("still has exactly the deferred gaps it claims, no more and no fewer", () => {
    const undecided = orderingSites.filter(
      (site) => !site.waived && !/\bid:\s*"(asc|desc)"/.test(site.expression),
    );
    expect(undecided.map((s) => s.file)).toEqual(DEFERRED_BY_FREEZE);
  });

  it("does not accept a waiver that says nothing", () => {
    // The escape hatch has to cost a sentence, or it becomes the default.
    const files = readdirSync(DOMAIN_DIR).filter((name) => name.endsWith(".ts"));
    for (const name of files) {
      const source = readFileSync(join(DOMAIN_DIR, name), "utf8");
      for (const line of source.split("\n")) {
        if (!line.includes(WAIVER)) continue;
        const reason = line.slice(line.indexOf(WAIVER) + WAIVER.length).trim();
        expect(reason.length, `${name}: ${line.trim()}`).toBeGreaterThan(25);
      }
    }
  });
});
