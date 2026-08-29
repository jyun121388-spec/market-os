/**
 * Does a framing word before an identity change what the request IS -- and does the DATABASE decide?
 *
 * IR-107 Unit 2, the next bounded unit after the redirect repair. `FRAMING_TOKENS` is one global,
 * position-insensitive bag. `process`, `mechanism` and `procedure` are in it deliberately, because
 * `What process connects A to B?` is a real construction where `process` frames the question. The
 * bag does not know that, so it also strips the word when it sits in front of a stored name.
 *
 * Two claims to separate, because only the second is clearly a defect:
 *
 *   1. `Explain how process A affects B.` authorizes as a relation between A and B. Arguable: a
 *      user may well mean that, and it was measured identically on all three doors, so it is shared
 *      rather than a divergence.
 *
 *   2. THE SAME SENTENCE MEANS DIFFERENT THINGS DEPENDING ON WHAT IS STORED. With `A -> B` in the
 *      repository the sentence is a question about A; with `Process A -> B` stored instead it is a
 *      question about `Process A`. Grammar is being decided by inventory. That is the property this
 *      script exists to measure, and it is why the repair cannot be a token rule -- POSITION and
 *      CONSTRUCTION decide grammatical role, not membership in a global bag.
 *
 * Three inventory states, the same probes in each. A row whose parse changes between S1 and S2 is
 * the defect; a row that stays constant is the parser deciding grammar on its own, which is what it
 * must do.
 *
 * Run: DATABASE_URL=...market_os_test npx tsx --tsconfig tsconfig.json \
 *   scripts/reproduce-framing-position.ts
 */
import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";
import { resolveRequestAuthority, asPlannerRequest } from "@/server/domain/requestAuthority";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import {
  deriveCanonicalCandidateEnvelope,
  deriveLegacyCandidateEnvelope,
} from "@/server/domain/candidateEnvelope";

const A = "TEST Frame Alpha";
const PA = "Process TEST Frame Alpha";
const B = "TEST Frame Beta";

const PROBES = [
  { id: "F1", query: `Explain how process ${A} affects ${B}.` },
  { id: "F2", query: `Explain how mechanism ${A} affects ${B}.` },
  { id: "F3", query: `Explain how procedure ${A} affects ${B}.` },
  // Positive controls. PC1 is the construction the framing allowlist exists FOR -- if a repair
  // breaks this, it has traded one wrong answer for another. PC2 is the plain relation, which must
  // keep working throughout.
  { id: "PC1", query: `What process connects ${A} to ${B}?` },
  { id: "PC2", query: `Explain how ${A} affects ${B}.` },
];

async function clean() {
  await prisma.causalEdge.deleteMany({ where: { fromVariable: { in: [A, PA] } } });
}

async function seed(from: string) {
  await prisma.causalEdge.create({
    data: {
      fromVariable: from,
      toVariable: B,
      direction: "POSITIVE",
      confidence: "MEDIUM",
      mechanism: "test transmission mechanism",
      evidence: "test fixture",
      lag: "1 quarter",
      counterexamples: "test fixture",
    },
  });
}

/**
 * Which stored edge a door actually selected, by name -- not how many.
 *
 * The first version of this printed counts, and counts cannot see the thing being measured: two
 * doors that both answer "1 edge" may have chosen DIFFERENT edges from the same request. In S3,
 * where both `A -> B` and `Process A -> B` are stored, that distinction is the whole finding.
 */
async function edgeNames(ids: readonly string[]): Promise<string> {
  if (ids.length === 0) return "none";
  const rows = await prisma.causalEdge.findMany({ where: { id: { in: [...ids] } } });
  return rows.map((e) => `${e.fromVariable} -> ${e.toVariable}`).join(", ");
}

async function canonicalDoor(query: string): Promise<string> {
  const authorization = authorizeInference(query);
  if (!authorization.eligible) return `blocked/${authorization.blockedBy}`;
  if (authorization.provenance !== "CANONICAL") return `provenance/${authorization.provenance}`;
  const plannerRequest = asPlannerRequest(authorization.request);
  if (plannerRequest === null) return "not-planner-permitted";
  const envelope = await deriveCanonicalCandidateEnvelope(query, plannerRequest);
  return `${envelope.status} ${await edgeNames(envelope.causalEdgeIds)}`;
}

async function measure(
  stateLabel: string,
  selected: Record<string, string>,
  roles: Record<string, string>,
) {
  console.log(`\n=== ${stateLabel}`);
  console.log(
    `  id   ${"cause region".padEnd(30)} ${"parse".padEnd(22)} ${"deterministic".padEnd(30)} ` +
      `${"legacy door".padEnd(24)} canonical door`,
  );
  const parses: Record<string, string> = {};
  for (const { id, query } of PROBES) {
    const a = resolveRequestAuthority(query);
    const cause = a.status === "AUTHORIZED" ? (a.causeRegion ?? "-") : "-";
    const parse = a.status === "AUTHORIZED" ? a.operation : a.status;

    const served = await askMarket(query);
    const edges = served.causalFactors.map((f) => `${f.fromVariable} -> ${f.toVariable}`);
    const deterministic = `${served.status}${edges.length ? " " + JSON.stringify(edges) : ""}`;

    let legacy = "-";
    try {
      const e = await deriveLegacyCandidateEnvelope(query);
      legacy = `${e.status}/${e.causalEdgeIds.length} edge(s)`;
    } catch (error) {
      legacy = `THREW ${(error as Error).message.slice(0, 24)}`;
    }

    const canonical = await canonicalDoor(query);

    parses[id] = `${parse}|${cause}`;
    // The cause-side stored identity this state actually selected. `-` when nothing was served,
    // which is a legitimate availability outcome rather than a grammar difference.
    selected[id] = edges.length > 0 ? edges[0].split(" -> ")[0] : "-";
    roles[id] = cause;
    console.log(
      `  ${id.padEnd(4)} ${cause.padEnd(30)} ${parse.padEnd(22)} ${deterministic.padEnd(30)} ` +
        `${legacy.padEnd(24)} ${canonical}`,
    );
  }
  return parses;
}

async function main() {
  await clean();

  const sel: Record<string, Record<string, string>> = {};
  const roles: Record<string, Record<string, string>> = {};
  for (const k of ["S1", "S2", "S3"]) {
    sel[k] = {};
    roles[k] = {};
  }

  await seed(A);
  const s1 = await measure(`S1  only "${A} -> ${B}" stored`, sel.S1, roles.S1);

  await clean();
  await seed(PA);
  const s2 = await measure(`S2  only "${PA} -> ${B}" stored`, sel.S2, roles.S2);

  await clean();
  await seed(A);
  await seed(PA);
  const s3 = await measure(`S3  BOTH stored`, sel.S3, roles.S3);

  await clean();
  await prisma.$disconnect();

  // ---------------------------------------------------------------------------------------------
  // THREE SEPARATE QUESTIONS, because the first one alone reported a clean tree over a live defect.
  //
  // The original summary compared only `operation|causeRegion` and printed "0/5 inventory-dependent"
  // while F1 was demonstrably answering about `A` in one state and `Process A` in another. Of course
  // it did: the parser never reads the repository, so its output is stable by construction and
  // comparing it can only ever confirm that. Stability of the parse is necessary and nowhere near
  // sufficient.
  //
  //   GRAMMAR ROLE            what span the parser assigned to the cause. Must be constant.
  //   REPOSITORY AVAILABILITY whether an exact identity for that span exists. May differ freely.
  //   SELECTED IDENTITY       which stored name was actually published. Must COVER the role.
  //
  // The last one is the real test, and it needs no hard-coded expectation: if a state publishes an
  // identity that does not account for the whole grammatical role, then something other than grammar
  // decided where the role ended -- and the only other thing in the loop is inventory.
  // ---------------------------------------------------------------------------------------------
  console.log(`
--- 1. GRAMMAR ROLE stability (necessary, not sufficient)`);
  const unstable = PROBES.filter(({ id }) => !(s1[id] === s2[id] && s2[id] === s3[id])).map(
    ({ id }) => id,
  );
  for (const { id } of PROBES) {
    console.log(`  ${id.padEnd(4)} ${unstable.includes(id) ? "UNSTABLE" : "stable  "}  ${s1[id]}`);
  }

  console.log(`
--- 2. REPOSITORY AVAILABILITY (differences here are legitimate)`);
  for (const { id } of PROBES) {
    console.log(
      `  ${id.padEnd(4)} S1 ${(sel.S1[id] ?? "-").padEnd(28)} S2 ${(sel.S2[id] ?? "-").padEnd(28)} ` +
        `S3 ${sel.S3[id] ?? "-"}`,
    );
  }

  console.log(`
--- 3. SELECTED IDENTITY vs GRAMMAR ROLE  (a mismatch is the defect)`);
  const violations: string[] = [];
  for (const { id } of PROBES) {
    for (const state of ["S1", "S2", "S3"] as const) {
      const identity = sel[state][id];
      const role = roles[state][id];
      if (!identity || identity === "-") continue;
      // Does the published identity account for the WHOLE role? Compared on normalized tokens, and
      // allowing only the request header the parser is supposed to have consumed. Deliberately not
      // reusing `regionIsExactlyFramingAndIdentity` -- that function is the thing under test, and a
      // harness that asks the accused to certify itself measures nothing.
      const roleTokens = role.trim().split(/\s+/).filter(Boolean);
      const idTokens = identity
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const tail = roleTokens.slice(roleTokens.length - idTokens.length).join(" ");
      const residue = roleTokens.slice(0, roleTokens.length - idTokens.length);
      const covers = tail === idTokens.join(" ");
      // Everything the identity did not explain. A KIND NOUN here is the defect: the repository
      // decided a semantically loaded word was framing.
      const KIND_NOUNS = ["process", "mechanism", "procedure", "rate", "value", "level", "figure"];
      const loaded = residue.filter((w) => KIND_NOUNS.includes(w));
      const verdict = !covers
        ? "IDENTITY DOES NOT COVER ROLE"
        : loaded.length > 0
          ? `INVENTORY DECIDED GRAMMAR: discarded ${JSON.stringify(loaded.join(" "))}`
          : "ok";
      if (verdict !== "ok") violations.push(`${id}/${state} ${verdict}`);
      console.log(
        `  ${id.padEnd(4)} ${state}  role=${JSON.stringify(role).padEnd(42)} ` +
          `published=${JSON.stringify(identity).padEnd(30)} ${verdict}`,
      );
    }
  }

  console.log(
    `
GRAMMAR ROLE unstable: ${unstable.length}/${PROBES.length}` +
      `   SELECTION VIOLATIONS: ${violations.length}`,
  );
  for (const v of violations) console.log(`  ${v}`);
  console.log(
    violations.length > 0
      ? "REPRODUCED. A published identity failed to account for its grammatical role."
      : "No selection violation over these probes and states.",
  );
}

void main();
