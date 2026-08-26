/**
 * Can two MAXIMAL authorizing runs partially overlap? Searched, not argued.
 *
 * This decides the disposition of mutation M-CON-2. The exactly-one-maximal-run guard in
 * `recogniseInformationalConstituent` survives every test in the suite, because the
 * outside-construction check rejects the multi-maximal cases the suite contains before the count
 * matters. The count would only be load-bearing for two runs that PARTIALLY OVERLAP:
 *
 *     run A = fragments [0..1]
 *     run B = fragments [1..2]      neither contains the other
 *
 * because then B's construction can sit in the overlap, INSIDE A, where the outside check is blind.
 *
 * I could not construct such an input by hand, and review would not accept that as evidence -- it
 * required "a generated/exhaustive fragment-run property before certification". This is that: an
 * exhaustive search over every ordered combination of a fragment pool, replicating the production
 * selection exactly (authorize each contiguous run, drop composites, keep maximal) and reporting any
 * partial overlap it finds.
 *
 * `resolveRequestAuthority` stands in for the non-exported `recogniseOperation`. That substitution
 * is sound ONLY for spans the advice screen does not claim, so any span detected as advice is
 * reported separately rather than silently treated as a recognition result.
 *
 * A clean run is EVIDENCE OVER THE SEARCHED SPACE and nothing more. It is not the structural proof
 * that would let the guard be deleted; it bounds where the hole is not.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/search-overlapping-runs.ts
 */
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";

/**
 * Fragments chosen to make overlap as easy as possible: complete operations, bare subjects that
 * only authorize when joined to a neighbour, trailing-subject constructions whose region runs to
 * the end of the span, and BEFORE-subject constructions whose region runs backwards. If overlap is
 * reachable at all, a run built from these should reach it.
 */
const POOL = [
  "What is the current Alpha",
  "What is the definition of Beta",
  "What is the change in Gamma this year",
  "What did Reuters publish about Delta",
  "Explain how Alpha affects Beta",
  "Epsilon rose",
  "Zeta",
  "the current Eta",
  "latest Theta",
  "most recent Iota",
  "Kappa moved",
  "what does Lambda mean",
];

const TERMINATORS = ["? ", ". ", "; ", "! "];

interface Run {
  start: number;
  end: number;
}

function analyse(fragments: string[], terminator: string) {
  // Rebuild the exact query and the fragment offsets the production splitter would produce.
  const query = fragments.join(terminator) + terminator.trim();
  const offsets: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const fragment of fragments) {
    offsets.push({ start: cursor, end: cursor + fragment.length + 1 });
    cursor += fragment.length + terminator.length;
  }

  const authorized: Run[] = [];
  let adviceClaimed = false;
  for (let first = 0; first < fragments.length; first += 1) {
    for (let last = first; last < fragments.length; last += 1) {
      const span = query.slice(offsets[first].start, Math.min(offsets[last].end, query.length));
      const a = resolveRequestAuthority(span);
      if (a.status === "PROHIBITED") {
        adviceClaimed = true;
        continue;
      }
      if (a.status === "AUTHORIZED") authorized.push({ start: first, end: last });
    }
  }

  const composite = (span: Run) =>
    authorized.some(
      (a) =>
        a.start >= span.start &&
        a.end <= span.end &&
        authorized.some((b) => b.start > a.end && b.end <= span.end && b.start >= span.start),
    );
  const candidates = authorized.filter((s) => !composite(s));
  const maximal = candidates.filter(
    (s) => !candidates.some((o) => o !== s && o.start <= s.start && o.end >= s.end),
  );

  // The count guard is only LOAD-BEARING when three things hold at once, and the first of them is
  // what my hand analysis missed: if the WHOLE query authorizes, `recogniseInformationalConstituent`
  // returns it immediately and never reaches run selection at all. Measured on the production path,
  // the first candidate this search produced was decided there -- the attribution parser claimed the
  // entire string, two unrelated questions included -- so it could not have killed the mutant.
  const wholeAuthorized = authorized.some((r) => r.start === 0 && r.end === fragments.length - 1);

  // Partial overlap: they share a fragment and neither contains the other.
  const overlapping: [Run, Run][] = [];
  for (let i = 0; i < maximal.length; i += 1) {
    for (let j = i + 1; j < maximal.length; j += 1) {
      const [a, b] = [maximal[i], maximal[j]];
      const share = a.start <= b.end && b.start <= a.end;
      const contains =
        (a.start <= b.start && a.end >= b.end) || (b.start <= a.start && b.end >= a.end);
      if (share && !contains) overlapping.push([a, b]);
    }
  }
  // The third condition: with the count guard removed the mutant takes `maximal[0]`, so the guard
  // only decides the outcome if the OUTSIDE-construction check would then let that run through.
  // Attribution is deliberately absent from CONSTRUCTIONS -- it binds three roles in its own parser
  // -- so an attribution sitting outside the chosen run is invisible to that check. That is the gap
  // the count is covering.
  const MARKERS = [
    " current ",
    " latest ",
    " most recent ",
    " change in ",
    " changed ",
    " moved ",
    " rose ",
    " fell ",
    " definition of ",
    " what is a ",
    " what is an ",
    " what does ",
  ];
  const normalise = (s: string) =>
    ` ${s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()} `;
  let outsideWouldCatch = true;
  if (maximal.length > 0) {
    const chosen = maximal[0];
    const outside =
      query.slice(0, offsets[chosen.start].start) +
      " " +
      query.slice(Math.min(offsets[chosen.end].end, query.length));
    outsideWouldCatch = MARKERS.some((m) => normalise(outside).includes(m));
  }

  const guardIsLoadBearing = !wholeAuthorized && overlapping.length > 0 && !outsideWouldCatch;

  return { query, maximal, overlapping, adviceClaimed, wholeAuthorized, guardIsLoadBearing };
}

function main() {
  let examined = 0;
  let multiMaximal = 0;
  let adviceSpans = 0;
  const found: { query: string; a: Run; b: Run }[] = [];

  for (const size of [2, 3, 4]) {
    const indices = new Array(size).fill(0);
    for (;;) {
      const fragments = indices.map((i) => POOL[i]);
      for (const terminator of TERMINATORS) {
        const r = analyse(fragments, terminator);
        examined += 1;
        if (r.adviceClaimed) adviceSpans += 1;
        if (r.maximal.length > 1) multiMaximal += 1;
        if (r.guardIsLoadBearing) {
          found.push({ query: r.query, a: r.overlapping[0][0], b: r.overlapping[0][1] });
        }
      }
      // odometer over POOL^size
      let carry = size - 1;
      while (carry >= 0) {
        indices[carry] += 1;
        if (indices[carry] < POOL.length) break;
        indices[carry] = 0;
        carry -= 1;
      }
      if (carry < 0) break;
    }
  }

  console.log(`combinations examined      : ${examined}`);
  console.log(`with >1 maximal run        : ${multiMaximal}`);
  console.log(`spans the advice screen took: ${adviceSpans}`);
  console.log(`GUARD-LOAD-BEARING cases    : ${found.length}`);
  for (const f of found.slice(0, 10)) {
    console.log(`  [${f.a.start}..${f.a.end}] vs [${f.b.start}..${f.b.end}]  ${f.query}`);
  }
  console.log(
    found.length > 0
      ? "\nM-CON-2 = REPRODUCED over the searched space. Pin the smallest case above."
      : "\nNo overlap in the searched space. This is EVIDENCE, NOT PROOF: it bounds where the hole" +
          " is not, and does not license deleting the guard.",
  );
}

main();
