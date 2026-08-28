/**
 * Generated adversarial combinations, checked against INVARIANTS rather than expected outputs.
 *
 * Every other corpus in this unit compares two versions of the code and reports what differs. That
 * finds regressions and cannot find a defect both versions share. This one asserts properties that
 * must hold of ANY output, so it can fail on a tree that never had a working predecessor.
 *
 * The combinations are generated, not chosen, because every hand-picked corpus in this unit has
 * turned out to cover the half of the space where the mechanism cannot fail -- five times, by
 * count. Directive heads are crossed with informational clauses, name fragments carrying internal
 * punctuation, coordinators, comparators and Korean, at every boundary character.
 *
 *   npx tsx scripts/adversarial-publication-invariants.ts
 */

import { resolveRequestAuthority } from "../src/server/domain/requestAuthority";

const HEADS = [
  "Should I buy stock",
  "Should I sell Alpha now",
  "What did Reuters publish about Alpha",
  "What is the current Acme Inc",
  "What is the definition of Yahoo",
  "Explain how Alpha affects Beta",
  "What is the current U.S",
  "기준금리는 얼마인가요",
];

const TAILS = [
  "Summarize Gamma",
  "Who published Gamma",
  "The Gamma level too",
  "revenue",
  "Finance",
  "Gamma Corp",
  "and Gamma",
  "or Gamma",
  "versus Gamma",
  "compared with Gamma",
  "Gamma, Delta",
  "현재 기준금리는 얼마인가요",
  "삼성전자",
  "Q3 Gamma",
  "Zorbulate Gamma",
  "what is the current Beta",
  "should I buy Gamma",
];

const BOUNDARIES = [". ", "? ", "! ", "; ", ", ", " "];

/** Text that must never appear in anything the system offers to answer. */
const DIRECTIVE_MARKERS = ["should i buy", "should i sell", "buy stock", "sell alpha"];

/** Closed function words that mean a region names more than one thing. */
const MULTI_OBJECT = ["and", "or", "versus", "vs", "compared", "nor", "plus"];

const failures: string[] = [];
let generated = 0;
let authorized = 0;
let prohibited = 0;

function check(query: string): void {
  generated += 1;
  const a = resolveRequestAuthority(query);

  if (a.status === "PROHIBITED") {
    prohibited += 1;
    // INVARIANT 1 -- prohibited dominance. The authority object carries a status and a detail and
    // nothing else; there is no field through which a payload could travel.
    const keys = Object.keys(a).sort().join(",");
    if (keys !== "detail,status") {
      failures.push(`PROHIBITED carries fields beyond status/detail (${keys}): ${query}`);
    }
    return;
  }
  if (a.status !== "AUTHORIZED") return;
  authorized += 1;

  const regions: [string, string][] = [
    ["subject", a.subjectRegion],
    ["source", a.sourceRegion ?? ""],
    ["cause", a.causeRegion ?? ""],
    ["effect", a.effectRegion ?? ""],
    ["interval", a.interval ?? ""],
  ];

  for (const [role, region] of regions) {
    const text = region.toLowerCase();
    // INVARIANT 2 -- no directive text in any served role, on any authorized reading.
    for (const marker of DIRECTIVE_MARKERS) {
      if (text.includes(marker)) {
        failures.push(`AUTHORIZED ${role} region contains "${marker}": ${query} -> ${region}`);
      }
    }
    // INVARIANT 3 -- a served CAUSE or EFFECT names exactly one thing. Subject regions are exempt
    // by contract: `Smith, Jones` is one issuer and cardinality-1 operations say so.
    if (role === "cause" || role === "effect") {
      const tokens = text.split(/[^0-9a-z가-힣]+/u).filter(Boolean);
      for (const marker of MULTI_OBJECT) {
        if (tokens.includes(marker)) {
          failures.push(`AUTHORIZED ${role} region names two things via "${marker}": ${query}`);
        }
      }
    }
  }
}

for (const head of HEADS) {
  for (const b of BOUNDARIES) {
    for (const tail of TAILS) {
      check(`${head}${b.trimEnd()} ${tail}?`);
      for (const b2 of BOUNDARIES) {
        check(`${head}${b.trimEnd()} ${tail}${b2.trimEnd()} ${tail}?`);
      }
    }
  }
}

process.stdout.write(
  `generated ${generated}   authorized ${authorized}   prohibited ${prohibited}\n`,
);
process.stdout.write(`invariant violations: ${failures.length}\n`);
for (const f of failures.slice(0, 25)) {
  process.stdout.write(`  ${f}\n`);
}
if (failures.length > 25) {
  process.stdout.write(`  ... and ${failures.length - 25} more, NOT shown\n`);
}
process.exit(failures.length === 0 ? 0 : 1);
