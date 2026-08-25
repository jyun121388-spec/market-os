/**
 * First run of the frozen candidate-relevance holdout. **The first run is the measurement.**
 *
 * Frozen with a sha256 before `candidateEnvelope.ts` existed, labelled from a written six-rule
 * contract by an independent model that was shown neither this repository's matcher nor the IR-103
 * probes. Nothing in the implementation has been fitted to it.
 *
 * ## What is measured, and why it is the envelope rather than the whole path
 *
 * The corpus asks natural questions, and the request gate admits a narrow set of shapes — measured,
 * not assumed: of a dozen ordinary phrasings only three were eligible. Running 140 natural
 * questions end to end would score the frame classifier and report it as candidate relevance. So
 * this measures `deriveLegacyCandidateEnvelope` directly, which is the property the corpus is about, and
 * deliberately stays on the LEGACY entry point after B2-B split it from the canonical one. The
 * canonical door requires a recognised parse and would refuse most of this corpus, so pointing a
 * sealed measurement at it would change what the score means without changing the score's name.
 * the production path's binding is proven separately by the IR-103 controls in
 * `tests/integration/output-authority.test.ts` with frame-eligible queries.
 *
 * The mapping from envelope to the corpus's outcome labels, fixed before the run:
 *
 *     record is in the envelope          -> ANSWERED
 *     envelope is empty                  -> NOT_ASKED
 *     envelope non-empty, record not in   -> OUTPUT_SUPPRESSED
 *
 * Each case is seeded and torn down alone, so one case's record cannot appear in another's
 * envelope.
 *
 * No provider, no model, no network.
 */

import { prisma } from "@/server/db/client";
import { deriveLegacyCandidateEnvelope, isEmptyEnvelope } from "@/server/domain/candidateEnvelope";
import {
  CANDIDATE_RELEVANCE_HOLDOUT,
  CANDIDATE_RELEVANCE_SHA256,
  type CandidateRelevanceCase,
} from "../tests/fixtures/candidateRelevanceHoldout";

const SOURCE_CODE = "TEST_CANDIDATE_HOLDOUT";

type Observed = "ANSWERED" | "OUTPUT_SUPPRESSED" | "NOT_ASKED";

async function main() {
  console.log(
    `holdout ${CANDIDATE_RELEVANCE_HOLDOUT.length} cases, sha256 ${CANDIDATE_RELEVANCE_SHA256}`,
  );

  const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
  if (existing) {
    await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
    await prisma.series.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }
  await prisma.causalEdge.deleteMany({ where: { evidence: "candidate-relevance holdout" } });

  const source = await prisma.source.create({
    data: { code: SOURCE_CODE, name: "Candidate holdout source", tier: "TIER_S" },
  });

  const rows: { c: CandidateRelevanceCase; observed: Observed }[] = [];

  for (const [index, c] of CANDIDATE_RELEVANCE_HOLDOUT.entries()) {
    let seededSeriesId: string | null = null;
    let seededEdgeId: string | null = null;

    if (c.recordSubject.trim()) {
      if (c.recordKind === "CAUSAL_EDGE") {
        const [from, to] = c.recordSubject.split("->").map((v) => v.trim());
        const edge = await prisma.causalEdge.create({
          data: {
            fromVariable: from || c.recordSubject,
            toVariable: to || `${c.recordSubject} outcome`,
            direction: "POSITIVE",
            confidence: "MEDIUM",
            mechanism: "Seeded for the candidate-relevance holdout.",
            evidence: "candidate-relevance holdout",
            lag: "1 quarter",
            counterexamples: "Seeded fixture; no empirical limitation recorded.",
          },
        });
        seededEdgeId = edge.id;
      } else {
        const series = await prisma.series.create({
          data: {
            sourceId: source.id,
            externalId: `CRH_${index}`,
            name: c.recordSubject,
            unit: "percent",
            frequency: "weekly",
          },
        });
        seededSeriesId = series.id;
      }
    }

    const envelope = await deriveLegacyCandidateEnvelope(c.query);
    const inEnvelope = seededSeriesId
      ? envelope.seriesIds.includes(seededSeriesId)
      : seededEdgeId
        ? envelope.causalEdgeIds.includes(seededEdgeId)
        : false;

    const observed: Observed = isEmptyEnvelope(envelope)
      ? "NOT_ASKED"
      : inEnvelope
        ? "ANSWERED"
        : "OUTPUT_SUPPRESSED";

    rows.push({ c, observed });

    if (seededSeriesId) {
      await prisma.observation.deleteMany({ where: { seriesId: seededSeriesId } });
      await prisma.series.delete({ where: { id: seededSeriesId } });
    }
    if (seededEdgeId) await prisma.causalEdge.delete({ where: { id: seededEdgeId } });
  }

  const agree = rows.filter((r) => r.observed === r.c.expected);
  console.log(`\nagreement ${agree.length}/${rows.length}`);

  const matrix: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    matrix[r.c.relation] ??= {};
    matrix[r.c.relation][r.observed] = (matrix[r.c.relation][r.observed] ?? 0) + 1;
  }
  console.log("\nrelation -> observed");
  for (const [relation, obs] of Object.entries(matrix)) {
    console.log(`  ${relation.padEnd(18)} ${JSON.stringify(obs)}`);
  }

  const overIncluded = rows.filter((r) => r.observed === "ANSWERED" && r.c.expected !== "ANSWERED");
  console.log(`\nover-included (the failure that matters): ${overIncluded.length}`);
  for (const r of overIncluded) {
    console.log(`  ${r.c.id} ${r.c.relation} ${r.c.recordKind}`);
    console.log(`      q: ${r.c.query}`);
    console.log(`      r: ${r.c.recordSubject}`);
  }

  const overExcluded = rows.filter((r) => r.c.expected === "ANSWERED" && r.observed !== "ANSWERED");
  console.log(`\nover-excluded (safe, but the product is narrower): ${overExcluded.length}`);
  for (const r of overExcluded.slice(0, 20)) {
    console.log(`  ${r.c.id} ${r.c.language} observed ${r.observed}`);
    console.log(`      q: ${r.c.query}`);
    console.log(`      r: ${r.c.recordSubject}`);
  }
  if (overExcluded.length > 20) console.log(`  ... and ${overExcluded.length - 20} more`);

  await prisma.observation.deleteMany({ where: { sourceId: source.id } });
  await prisma.series.deleteMany({ where: { sourceId: source.id } });
  await prisma.source.delete({ where: { id: source.id } });
  await prisma.causalEdge.deleteMany({ where: { evidence: "candidate-relevance holdout" } });
  await prisma.$disconnect();
}

main();
