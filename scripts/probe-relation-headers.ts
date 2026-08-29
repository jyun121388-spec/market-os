/**
 * What request headers actually precede an infix relation verb?
 *
 * IR-107 framing positionality. The architect's REFRAME says the parser should consume the request
 * header structurally and emit a cause role containing the identity only, instead of leaving the
 * opener in the region for a downstream framing allowlist to strip. That repair needs to know which
 * headers really occur, and guessing a list is how this codebase has gone wrong before -- so the
 * list is measured off the corpora rather than invented.
 *
 * The prefix-marker constructions (`connects … to`, `impact of … on`) already place the cause after
 * their marker, so they are not the problem and are excluded. Only the infix ones
 * (`["", " affects ", null]` and friends) hand the whole opener to the cause region.
 *
 * For each infix cause region this prints the LONGEST ALL-FRAMING-TOKEN PREFIX -- which is exactly
 * the span the current cover is willing to discard. That set is the header inventory the repair has
 * to cover, and any KIND NOUN appearing in it is the defect class: a word the cover will strip that
 * may instead be part of the identity.
 *
 *   npx tsx scripts/probe-relation-headers.ts
 */

import { readFileSync } from "node:fs";
import { relationSyntax, normalizeSubject } from "@/server/domain/subjectAuthority";

// The infix constructions, by the label `relationSyntax` reports. Prefix-marker constructions carry
// a ` … ` in their label because they have both a before and an after marker.
const isInfix = (construction: string) => !construction.includes("…");

/** The same token set `subjectAuthority.framingIsRecognised` consults, re-derived by probing it. */
import { framingIsRecognised } from "@/server/domain/subjectAuthority";

function longestFramingPrefix(region: string): string {
  const tokens = normalizeSubject(region).trim().split(" ").filter(Boolean);
  let best = 0;
  for (let n = 1; n <= tokens.length; n += 1) {
    if (framingIsRecognised(tokens.slice(0, n).join(" "))) best = n;
    else break;
  }
  return tokens.slice(0, best).join(" ");
}

function collect(queries: Iterable<string>, label: string) {
  const prefixes = new Map<string, number>();
  const examples = new Map<string, string>();
  let infix = 0;
  for (const query of queries) {
    const syntax = relationSyntax(query);
    const clauses =
      syntax.status === "ONE"
        ? [syntax.clause]
        : syntax.status === "MULTIPLE"
          ? syntax.clauses
          : [];
    for (const clause of clauses) {
      if (!isInfix(clause.construction)) continue;
      infix += 1;
      const prefix = longestFramingPrefix(clause.cause);
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
      if (!examples.has(prefix)) examples.set(prefix, query);
    }
  }
  console.log(`\n=== ${label}: ${infix} infix relation clauses, ${prefixes.size} distinct headers`);
  for (const [prefix, count] of [...prefixes].sort((a, b) => b[1] - a[1])) {
    console.log(
      `  ${String(count).padStart(6)}  ${JSON.stringify(prefix).padEnd(34)} e.g. ${JSON.stringify(
        (examples.get(prefix) ?? "").slice(0, 70),
      )}`,
    );
  }
  return prefixes;
}

/**
 * The development corpus. NOT the sealed holdout -- ESC-015 §17 and this unit's brief both forbid
 * spending sealed-holdout evidence on framing debugging, so `requestAuthorityHoldout.ts` and the
 * other holdout fixtures are deliberately not read here.
 */
function devCorpusQueries(): string[] {
  const text = readFileSync("tests/fixtures/requestDevelopmentCorpus.ts", "utf8");
  return [...text.matchAll(/query:\s*["'`]([^"'`\n]{4,200})["'`]/g)].map((m) => m[1]);
}

function testCorpusQueries(): string[] {
  // Every string literal in the relation-bearing test files that looks like a request. Crude on
  // purpose: over-collecting costs nothing here, and under-collecting would hide a header.
  const files = [
    "tests/requestAuthority.test.ts",
    "tests/integration/ask-market.test.ts",
    "tests/integration/relation-role-cover.test.ts",
    "tests/integration/causal-graph.test.ts",
    "tests/askMarketAdversarial.test.ts",
    "tests/subjectClassification.test.ts",
  ];
  const found = new Set<string>();
  for (const file of files) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/["'`]([^"'`\n]{8,160})["'`]/g)) {
      const candidate = match[1];
      if (
        /affect|impact|influence|drive|feed into|passes through|connects|links/i.test(candidate)
      ) {
        found.add(candidate);
      }
    }
  }
  return [...found];
}

const dev = devCorpusQueries();
console.log(`development corpus: ${dev.length} queries read`);
collect(dev, "development corpus");
collect(testCorpusQueries(), "test corpus relation queries");
