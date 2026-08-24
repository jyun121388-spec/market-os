/**
 * BEFORE-behaviour reproduction for the Unit 2 production-binding candidates.
 *
 * A parser verdict is not a served answer. This seeds a real repository and asks what `askMarket`
 * actually returns, because the whole question is whether `resolveRequestAuthority` decides
 * anything past its own return statement.
 *
 * Two candidates:
 *   RA-PB-01  operation authority may not bind the output class — a DEFINITION request served a
 *             number, a level request served a change and a mechanism, and so on.
 *   RA-PB-02  attribution identity may be lost after parsing — the grammar binds WHICH source, and
 *             a boolean records only THAT one existed. Two providers publish the same subject with
 *             different values; naming one must not serve the other.
 *
 * Reproduction only. It changes nothing and asserts nothing; it prints what happens today so the
 * repair has a baseline to be measured against.
 *
 * Run: DATABASE_URL=... npx tsx --tsconfig tsconfig.json scripts/reproduce-production-binding.ts
 */

import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";

const SOURCE_A = "TEST_PB_SOURCE_A";
const SOURCE_B = "TEST_PB_SOURCE_B";
const SUBJECT = "TEST Vespucci Freight Index";
const OTHER_SUBJECT = "TEST Vespucci Shipping Cost";

async function reset(): Promise<void> {
  for (const code of [SOURCE_A, SOURCE_B]) {
    const existing = await prisma.source.findUnique({ where: { code } });
    if (!existing) continue;
    await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
    await prisma.series.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }
  await prisma.causalEdge.deleteMany({ where: { fromVariable: SUBJECT } });
}

async function seedSeries(
  sourceCode: string,
  sourceName: string,
  externalId: string,
  value: string,
  previous: string,
): Promise<void> {
  const source = await prisma.source.create({
    data: { code: sourceCode, name: sourceName, tier: "TIER_S" },
  });
  const series = await prisma.series.create({
    data: { sourceId: source.id, externalId, name: SUBJECT, unit: "index", frequency: "daily" },
  });
  for (const [date, v] of [
    ["2026-08-10T00:00:00.000Z", previous],
    ["2026-08-17T00:00:00.000Z", value],
  ] as const) {
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId: source.id,
        observationDate: new Date(date),
        value: v,
        raw: {},
      },
    });
  }
}

function line(label: string, text: string): void {
  console.log(`   ${label.padEnd(26)} ${text}`);
}

async function probe(title: string, query: string): Promise<void> {
  const authority = resolveRequestAuthority(query);
  const result = await askMarket(query);
  console.log(`\n${title}`);
  line("query", query);
  line(
    "authority",
    authority.status === "AUTHORIZED"
      ? `${authority.status} ${authority.operation} (recordClass ${authority.contract.recordClass})`
      : authority.status,
  );
  line("served status", result.status);
  line(
    "series factors",
    result.seriesFactors.length === 0
      ? "none"
      : result.seriesFactors
          .map(
            (f) =>
              `${f.sourceCode}:${f.value}${
                f.kind === "COMPUTED_CHANGE"
                  ? ` (change ${f.absoluteChange}, ${f.percentChange}% over "${f.interval}")`
                  : ""
              }`,
          )
          .join("  "),
  );
  line(
    "causal factors",
    result.causalFactors.length === 0
      ? "none"
      : result.causalFactors.map((c) => `${c.fromVariable} -> ${c.toVariable}`).join("  "),
  );
  line("company facts", String(result.companyFacts.length));
}

async function main(): Promise<void> {
  await reset();
  // Same subject name, two authentic providers, different values. This is ordinary: `Series` is
  // unique on (sourceId, externalId) and never on name.
  await seedSeries(SOURCE_A, "Test PB Source A", "TEST_PB_SERIES_A", "140.0", "100.0");
  await seedSeries(SOURCE_B, "Test PB Source B", "TEST_PB_SERIES_B", "260.0", "200.0");
  await prisma.causalEdge.create({
    data: {
      fromVariable: SUBJECT,
      toVariable: OTHER_SUBJECT,
      direction: "POSITIVE",
      confidence: "MEDIUM",
      mechanism: "Test mechanism for the production-binding reproduction.",
      lag: "1 month",
      counterexamples: "none recorded",
      evidence: "Seeded for the production-binding reproduction; not a claim about the world.",
    },
  });

  console.log("=".repeat(96));
  console.log("RA-PB-01  does the operation bind what is served?");
  console.log("=".repeat(96));
  await probe("A. DEFINITION of a term that is also a stored series", `What is a ${SUBJECT}?`);
  await probe("B. CURRENT_OBSERVATION — a level, nothing else", `What is the current ${SUBJECT}?`);
  await probe(
    "C. STORED_MECHANISM — a causal edge, nothing else",
    `Explain how the ${SUBJECT} affects the ${OTHER_SUBJECT}.`,
  );
  await probe(
    "D. ATTRIBUTED_REPORTED_OBSERVATION — an attributed report, nothing else",
    `What did Test PB Source A publish about the ${SUBJECT}?`,
  );

  console.log("\n" + "=".repeat(96));
  console.log("RA-PB-02  does the bound source survive the parse?");
  console.log("=".repeat(96));
  console.log(
    "\n   Source A holds 140.0, Source B holds 260.0, for the same subject. The request names A.",
  );
  await probe(
    "E. attributed request naming Source A only",
    `What did Test PB Source A publish about the ${SUBJECT}?`,
  );

  await reset();
  await prisma.$disconnect();
}

void main();
