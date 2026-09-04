/**
 * BEFORE-behaviour reproduction for the OBSERVED_CHANGE temporal-binding defect.
 *
 * `findChangeFactors(topic, interval)` computes from `getRecentObservationPair(series.id)` — the
 * last two stored readings — and copies the requested interval string into the returned factor.
 * The label says "this year"; the arithmetic says "since the previous observation". Those are the
 * same number only when the series has exactly two readings.
 *
 * A change figure under a period label is a claim about that period. This script seeds a series
 * dense enough that the latest pair, the year boundaries and the quarter boundaries all disagree,
 * and prints what the current code actually returns for each request.
 *
 * Reproduction only: it asserts nothing and changes nothing.
 *
 * Run: DATABASE_URL=... npx tsx --tsconfig tsconfig.json scripts/reproduce-temporal-binding.ts
 */

import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";

const SOURCE_CODE = "TEST_TEMPORAL_SOURCE";
const DENSE = "TEST Temporal Dense Index";
const SPARSE = "TEST Temporal Sparse Index";

async function reset(): Promise<void> {
  const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
  if (!existing) return;
  await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
  await prisma.series.deleteMany({ where: { sourceId: existing.id } });
  await prisma.source.delete({ where: { id: existing.id } });
}

/** Deliberately explicit: the reader of this output needs to see which dates exist. */
async function seed(
  sourceId: string,
  name: string,
  externalId: string,
  readings: readonly (readonly [string, string])[],
): Promise<void> {
  const series = await prisma.series.create({
    data: { sourceId, externalId, name, unit: "index", frequency: "monthly" },
  });
  for (const [date, value] of readings) {
    await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId,
        observationDate: new Date(`${date}T00:00:00.000Z`),
        value,
        raw: {},
      },
    });
  }
  console.log(`   seeded ${name}: ${readings.map(([d, v]) => `${d}=${v}`).join("  ")}`);
}

async function probe(label: string, query: string): Promise<void> {
  const result = await askMarket(query);
  const shown = result.seriesFactors
    .map((f) =>
      f.kind === "COMPUTED_CHANGE"
        ? `${f.seriesName}: value=${f.value} asOf=${f.asOfDate} change=${f.absoluteChange} (${f.percentChange}%) labelled "${f.interval}"`
        : `${f.seriesName}: ${f.kind}`,
    )
    .join("\n      ");
  console.log(`\n   ${label}`);
  console.log(`      query   ${query}`);
  console.log(`      status  ${result.status}`);
  console.log(`      ${shown || "(no factors)"}`);
}

async function main(): Promise<void> {
  await reset();
  const source = await prisma.source.create({
    data: { code: SOURCE_CODE, name: "Test Temporal Source", tier: "TIER_S" },
  });

  const now = new Date();
  const year = now.getUTCFullYear();

  console.log("=".repeat(96));
  console.log("fixtures");
  console.log("=".repeat(96));

  // Monthly readings across two years, rising by 10 a month. Every candidate boundary gives a
  // different answer from the latest pair, which moves by exactly 10.
  const dense: [string, string][] = [];
  let value = 100;
  for (const y of [year - 1, year]) {
    for (const m of [1, 4, 7, 10]) {
      dense.push([`${y}-${String(m).padStart(2, "0")}-01`, String(value)]);
      value += 10;
    }
  }
  await seed(source.id, DENSE, "TEST_TEMPORAL_DENSE", dense);

  // Two readings only, both inside the previous year: nothing exists at either boundary of a
  // "this year" request.
  await seed(source.id, SPARSE, "TEST_TEMPORAL_SPARSE", [
    [`${year - 1}-02-01`, "500"],
    [`${year - 1}-03-01`, "505"],
  ]);

  console.log("\n" + "=".repeat(96));
  console.log("T1-T4  does the requested period choose the observations?");
  console.log("=".repeat(96));
  console.log(
    `\n   The latest pair of ${DENSE} differs by 10 by construction. Any request whose period` +
      "\n   spans more than one step must therefore differ from it, and any that returns 10 is" +
      "\n   reporting the latest pair under someone else's label.",
  );

  await probe(
    "T1  a full year, which spans four steps",
    `How much has ${DENSE} changed this year?`,
  );
  await probe("T2  a quarter", `How much has ${DENSE} changed last quarter?`);
  await probe("T3  the year before", `How much has ${DENSE} changed last year?`);
  await probe(
    "T4  a period with no readings at either boundary",
    `How much has ${SPARSE} changed this year?`,
  );

  console.log("\n" + "=".repeat(96));
  console.log("T5  revisions at a boundary");
  console.log("=".repeat(96));
  const revised = await prisma.series.create({
    data: {
      sourceId: source.id,
      externalId: "TEST_TEMPORAL_REVISED",
      name: "TEST Temporal Revised Index",
      unit: "index",
      frequency: "monthly",
    },
  });
  const original = await prisma.observation.create({
    data: {
      seriesId: revised.id,
      sourceId: source.id,
      observationDate: new Date(`${year}-01-01T00:00:00.000Z`),
      value: "200",
      raw: {},
      retrievedAt: new Date(Date.now() - 3_600_000),
    },
  });
  await prisma.observation.create({
    data: {
      seriesId: revised.id,
      sourceId: source.id,
      observationDate: new Date(`${year}-01-01T00:00:00.000Z`),
      value: "222",
      raw: {},
      isRevision: true,
      revisionOf: original.id,
    },
  });
  await prisma.observation.create({
    data: {
      seriesId: revised.id,
      sourceId: source.id,
      observationDate: new Date(`${year}-06-01T00:00:00.000Z`),
      value: "260",
      raw: {},
    },
  });
  console.log(
    `   seeded TEST Temporal Revised Index: ${year}-01-01=200 superseded by 222, ${year}-06-01=260`,
  );
  console.log(`   a "this year" change should be 260 - 222 = 38, never 260 - 200 = 60`);
  await probe(
    "T5  the start boundary has a superseded reading",
    `How much has TEST Temporal Revised Index changed this year?`,
  );

  await reset();
  await prisma.$disconnect();
}

void main();
