/**
 * First run of the frozen subject-authority holdout. **The first run is the measurement.**
 *
 * Frozen with a sha256 before `subjectAuthority.ts` was written, labelled from a written eight-rule
 * contract by an independent model shown neither the previous corpus's failures nor this
 * repository's matcher. Nothing in the implementation has been fitted to it.
 *
 * ## What is measured
 *
 * The whole authority decision — request frame, subject resolution, operation binding — through
 * `deriveLegacyCandidateEnvelope`, plus the membership predicates that decide whether the case's target
 * record would be authorized. The production path's planner-call behaviour is proven by the IR-104
 * controls in `tests/integration/output-authority.test.ts`; running 166 natural questions end to
 * end would score the frame classifier and report it as subject authority, which is the mistake
 * IR-103's first matrix made.
 *
 * Mapping from the resolver to the corpus labels, fixed before the run:
 *
 *     status AMBIGUOUS                         -> AMBIGUOUS_NO_PLANNER
 *     status UNRESOLVED                        -> NO_SUBJECT_NO_PLANNER
 *     AUTHORIZED and the target is a candidate -> ANSWERED
 *     AUTHORIZED and it is not                 -> NOT_A_CANDIDATE
 *
 * Each case seeds only its own subjects and tears them down, so one case cannot see another's.
 *
 * No provider, no model, no network.
 */

import { prisma } from "@/server/db/client";
import { classifyRequestFrame } from "@/server/domain/requestFrame";
import {
  claimIsCandidate,
  deriveLegacyCandidateEnvelope,
  explanationIsCandidate,
} from "@/server/domain/candidateEnvelope";
import {
  SUBJECT_AUTHORITY_HOLDOUT,
  SUBJECT_AUTHORITY_SHA256,
  type SubjectAuthorityCase,
} from "../tests/fixtures/subjectAuthorityHoldout";

const SOURCE_CODE = "TEST_SUBJECT_HOLDOUT";
const EDGE_EVIDENCE = "subject-authority holdout";

type Observed = "ANSWERED" | "NOT_A_CANDIDATE" | "AMBIGUOUS_NO_PLANNER" | "NO_SUBJECT_NO_PLANNER";

const isEdge = (name: string) => name.includes("->");

async function main() {
  console.log(
    `holdout ${SUBJECT_AUTHORITY_HOLDOUT.length} cases, sha256 ${SUBJECT_AUTHORITY_SHA256}`,
  );

  const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
  if (existing) {
    await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
    await prisma.series.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }
  await prisma.causalEdge.deleteMany({ where: { evidence: EDGE_EVIDENCE } });

  const source = await prisma.source.create({
    data: { code: SOURCE_CODE, name: "Subject holdout source", tier: "TIER_S" },
  });

  const rows: { c: SubjectAuthorityCase; observed: Observed; eligibleFrame: boolean }[] = [];

  for (const [index, c] of SUBJECT_AUTHORITY_HOLDOUT.entries()) {
    const seededSeries = new Map<string, string>();
    const seededEdges = new Map<string, string>();

    for (const [i, subject] of c.repositorySubjects.entries()) {
      if (!subject.trim()) continue;
      if (isEdge(subject)) {
        const [from, to] = subject.split("->").map((v) => v.trim());
        const edge = await prisma.causalEdge.create({
          data: {
            fromVariable: from,
            toVariable: to || `${from} outcome`,
            direction: "POSITIVE",
            confidence: "MEDIUM",
            mechanism: "Seeded for the subject-authority holdout.",
            evidence: EDGE_EVIDENCE,
            lag: "1 quarter",
            counterexamples: "Seeded fixture; no empirical limitation recorded.",
          },
        });
        seededEdges.set(subject, edge.id);
      } else {
        const series = await prisma.series.create({
          data: {
            sourceId: source.id,
            externalId: `SAH_${index}_${i}`,
            name: subject,
            unit: "percent",
            frequency: "weekly",
          },
        });
        seededSeries.set(subject, series.id);
      }
    }

    const envelope = await deriveLegacyCandidateEnvelope(c.query);

    let observed: Observed;
    if (envelope.status === "AMBIGUOUS") {
      observed = "AMBIGUOUS_NO_PLANNER";
    } else if (envelope.status === "UNRESOLVED") {
      observed = "NO_SUBJECT_NO_PLANNER";
    } else {
      const target = c.targetSubject;
      const authorized = isEdge(target)
        ? explanationIsCandidate(seededEdges.get(target) ?? "none", envelope)
        : claimIsCandidate(
            c.targetKind === "SERIES_CALCULATION" ? "CALCULATION" : "FACT",
            { seriesId: seededSeries.get(target) ?? "none" },
            envelope,
          );
      observed = authorized ? "ANSWERED" : "NOT_A_CANDIDATE";
    }

    const frame = classifyRequestFrame(c.query);
    const eligibleFrame = frame === "FACTUAL_MECHANISM" || frame === "THIRD_PARTY_REPORTED_FACT";
    rows.push({ c, observed, eligibleFrame });

    for (const id of seededSeries.values()) {
      await prisma.observation.deleteMany({ where: { seriesId: id } });
      await prisma.series.delete({ where: { id } });
    }
    for (const id of seededEdges.values()) await prisma.causalEdge.delete({ where: { id } });
  }

  const agree = rows.filter((r) => r.observed === r.c.expected);
  console.log(`\nagreement ${agree.length}/${rows.length}`);

  // The denominator that matters. Subject authority cannot be measured on a question the request
  // gate never admits, and reporting one number over both would score the frame classifier while
  // calling it subject authority — the mistake IR-103's first matrix made.
  const reachable = rows.filter((r) => r.eligibleFrame);
  const reachableAgree = reachable.filter((r) => r.observed === r.c.expected);
  console.log(
    `frame-eligible ${reachable.length}/${rows.length}; agreement among those ` +
      `${reachableAgree.length}/${reachable.length}`,
  );
  const frameByCategory: Record<string, { total: number; eligible: number }> = {};
  for (const r of rows) {
    frameByCategory[r.c.category] ??= { total: 0, eligible: 0 };
    frameByCategory[r.c.category].total += 1;
    if (r.eligibleFrame) frameByCategory[r.c.category].eligible += 1;
  }
  console.log("\nframe-eligible by category");
  for (const [cat, v] of Object.entries(frameByCategory).sort()) {
    console.log(`  ${cat.padEnd(26)} ${v.eligible}/${v.total}`);
  }

  console.log("\nexpected -> observed");
  const matrix: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    matrix[r.c.expected] ??= {};
    matrix[r.c.expected][r.observed] = (matrix[r.c.expected][r.observed] ?? 0) + 1;
  }
  for (const [expected, obs] of Object.entries(matrix)) {
    console.log(`  ${expected.padEnd(22)} ${JSON.stringify(obs)}`);
  }

  // The only direction that is a safety defect: something authorized that should not have been.
  const unsafe = rows.filter((r) => r.observed === "ANSWERED" && r.c.expected !== "ANSWERED");
  console.log(`\nUNSAFE — authorized but should not be: ${unsafe.length}`);
  for (const r of unsafe) {
    console.log(`  ${r.c.id} ${r.c.category} expected ${r.c.expected}`);
    console.log(`      q: ${r.c.query}`);
    console.log(`      t: ${r.c.targetSubject}`);
  }

  console.log("\nby category (safety-relevant only)");
  const byCat: Record<string, { total: number; unsafe: number }> = {};
  for (const r of rows) {
    byCat[r.c.category] ??= { total: 0, unsafe: 0 };
    byCat[r.c.category].total += 1;
    if (r.observed === "ANSWERED" && r.c.expected !== "ANSWERED") byCat[r.c.category].unsafe += 1;
  }
  for (const [cat, v] of Object.entries(byCat).sort()) {
    console.log(`  ${cat.padEnd(26)} ${v.unsafe}/${v.total} unsafe`);
  }

  const missed = rows.filter((r) => r.c.expected === "ANSWERED" && r.observed !== "ANSWERED");
  console.log(`\nrecall loss — should have answered, did not: ${missed.length}`);
  const missedByLang: Record<string, number> = {};
  for (const r of missed) missedByLang[r.c.language] = (missedByLang[r.c.language] ?? 0) + 1;
  console.log(`  by language ${JSON.stringify(missedByLang)}`);
  const missedEligible = missed.filter((r) => r.eligibleFrame);
  console.log(
    `  of which the request gate admitted at all: ${missedEligible.length} — the rest were ` +
      "never subject-authority questions",
  );
  for (const r of missed.slice(0, 12)) {
    console.log(`  ${r.c.id} ${r.c.language} ${r.c.category} observed ${r.observed}`);
    console.log(`      q: ${r.c.query}`);
  }
  if (missed.length > 12) console.log(`  ... and ${missed.length - 12} more`);

  await prisma.observation.deleteMany({ where: { sourceId: source.id } });
  await prisma.series.deleteMany({ where: { sourceId: source.id } });
  await prisma.source.delete({ where: { id: source.id } });
  await prisma.causalEdge.deleteMany({ where: { evidence: EDGE_EVIDENCE } });
  await prisma.$disconnect();
}

main();
