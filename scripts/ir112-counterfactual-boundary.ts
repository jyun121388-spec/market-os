/**
 * IR-112 span-preserving boundary COUNTERFACTUAL. READ-ONLY: no product code is changed and this
 * script is never imported by the product.
 *
 * `[CHATGPT_DECISION][MARKET-IR112-RIGHT-EDGE-REFRAME-20260831]` item 4 asks for a 500-row
 * counterfactual before any production wiring. The question it has to answer is narrow:
 *
 *     is there a POSITIVE right edge for the eleven opener-only constructions that this
 *     repository can already justify, and what does it cost over the whole corpus?
 *
 * The repository has answered the same question once before, for sentence terminators. `fragments`
 * carry RAW-query coordinates, and `confirmedBoundary` decides whether a fragment break is real by
 * looking at the TAIL'S TEXT -- a clause-initial token, Hangul carrying a predicate, or a
 * boundary-adjacent determiner. The comment above it states the reason arithmetic cannot do it:
 * "At the cover level the bad case and the good one are the SAME OBJECT: fragment 0 reads,
 * fragment 1 does not, the join reads."
 *
 * So this counterfactual changes exactly ONE thing and holds the authority fixed: the candidate
 * geometry is widened from sentence terminators to include the COMMA, and the accept/reject test
 * stays the repository's existing positive tail-text rule. Punctuation is candidate geometry;
 * clause-opening evidence is the authority. That is item 1's shape.
 *
 *   npx tsx scripts/ir112-counterfactual-boundary.ts
 */

import { readFileSync } from "node:fs";
import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";
import { REQUEST_DEVELOPMENT_CORPUS } from "../tests/fixtures/requestDevelopmentCorpus";

/**
 * Copied from `requestAuthority.ts`, which does not export it, and CHECKED against the source
 * below rather than trusted. A stale copy would make every number here a fiction, and this file
 * exists precisely because assumed values were wrong twice in this finding already.
 */
const CLAUSE_OPENING_TOKENS = new Set([
  "what",
  "which",
  "how",
  "who",
  "whom",
  "whose",
  "why",
  "when",
  "where",
  "is",
  "are",
  "was",
  "were",
  "did",
  "do",
  "does",
  "has",
  "have",
  "had",
  "will",
  "would",
  "can",
  "could",
  "may",
  "might",
  "must",
  "there",
  "please",
  "tell",
  "show",
  "give",
  "explain",
  "describe",
  "compare",
  "list",
]);

const BOUNDARY_ADJACENT_DETERMINERS = ["the", "a", "an", "any", "same"];

function assertCopyIsCurrent(): void {
  const source = readFileSync("src/server/domain/requestAuthority.ts", "utf8");
  const start = source.indexOf("const CLAUSE_OPENING_TOKENS = new Set([");
  const end = source.indexOf("]);", start);
  if (start < 0 || end < 0) throw new Error("CLAUSE_OPENING_TOKENS not found in source");
  const inSource = new Set(
    (source.slice(start, end).match(/"[a-z]+"/g) ?? []).map((q) => q.slice(1, -1)),
  );
  const missing = [...inSource].filter((t) => !CLAUSE_OPENING_TOKENS.has(t));
  const extra = [...CLAUSE_OPENING_TOKENS].filter((t) => !inSource.has(t));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`copy is stale. missing=${missing.join(",")} extra=${extra.join(",")}`);
  }
  console.log(`CLAUSE_OPENING_TOKENS copy verified against source: ${inSource.size} members\n`);
}

function tokensOf(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The repository's own positive test, applied unchanged to a comma-delimited tail. */
function tailConfirmsBoundary(tail: string): boolean {
  const tokens = tokensOf(tail);
  if (tokens.length === 0) return false;
  if (BOUNDARY_ADJACENT_DETERMINERS.includes(tokens[0])) return true;
  return tokens.some((token) => CLAUSE_OPENING_TOKENS.has(token));
}

type Row = { id: string; query: string };
const rows = REQUEST_DEVELOPMENT_CORPUS as unknown as readonly Row[];

assertCopyIsCurrent();

let withComma = 0;
const confirmed: string[] = [];
const notConfirmed: string[] = [];

for (const row of rows) {
  const query = row.query;
  const at = query.indexOf(",");
  if (at < 0) continue;
  withComma += 1;
  const tail = query.slice(at + 1).replace(/[?.!]\s*$/, "");
  const authority = resolveRequestAuthority(query);
  const status =
    authority.status === "AUTHORIZED" ? `AUTHORIZED/${authority.operation}` : authority.status;
  const line = `${row.id}  ${status.padEnd(34)} tail="${tail.trim()}"`;
  (tailConfirmsBoundary(tail) ? confirmed : notConfirmed).push(line);
}

console.log(`corpus rows containing a comma: ${withComma}`);
console.log(
  `\nCOMMA WOULD BE A CONFIRMED BOUNDARY (tail carries clause-opening evidence): ${confirmed.length}`,
);
for (const l of confirmed) console.log(`  ${l}`);
console.log(
  `\nCOMMA WOULD NOT BE CONFIRMED (tail is nominal -- the join stays whole): ${notConfirmed.length}`,
);
for (const l of notConfirmed) console.log(`  ${l}`);

console.log("\nTARGETED ANCHORS from the decision, item 4:");
for (const probe of [
  "Latest reading on the eurozone unemployment rate, if you have it.",
  "What is the latest US CPI reading, if available?",
  "What is the latest US CPI reading, thanks?",
  "What is the current Smith, Jones revenue?",
  "What is the current US unemployment rate, and should I move into cash?",
]) {
  const at = probe.indexOf(",");
  const tail = probe.slice(at + 1).replace(/[?.!]\s*$/, "");
  console.log(
    `  ${tailConfirmsBoundary(tail) ? "CONFIRMED    " : "NOT CONFIRMED"}  tail="${tail.trim()}"  <- ${probe}`,
  );
}
