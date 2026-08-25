/**
 * Does what is STORED decide whether a two-subject Korean request is answerable?
 *
 * IR-107 Unit 2 Phase B, third adversarial round, finding 4. The claim: `금리와환율은 얼마인가요?`
 * names two subjects, the parser cannot see the fused conjunction and authorizes it with one
 * subject region, and the downstream cardinality guard only refuses when MORE THAN ONE stored name
 * matches. So with only 환율 stored the request is served — about half of what it asked — and with
 * both stored it is refused. Inventory would then be deciding what the sentence meant, which is the
 * one thing this design says it must never do.
 *
 * That is a claim about the production path with a real database behind it, so it is run rather
 * than reasoned about. Seeds its own rows, prints, and deletes them again.
 *
 * Run with the test database:
 *   DATABASE_URL=postgresql://...market_os_test npx tsx --tsconfig tsconfig.json \
 *     scripts/reproduce-korean-cardinality.ts
 */

import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";

const SOURCE_CODE = "TEST_KO_CARD";
const NARROW = "환율";
const OTHER = "금리";

async function seed(names: string[]): Promise<void> {
  const source = await prisma.source.upsert({
    where: { code: SOURCE_CODE },
    update: {},
    create: { code: SOURCE_CODE, name: "TEST Korean Cardinality Source", tier: "TIER_S" },
  });
  for (const [index, name] of names.entries()) {
    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: `TEST_KO_CARD_${index}`,
        name,
        unit: "percent",
        frequency: "monthly",
      },
    });
    // Two readings a month apart so cadence is derivable and the newest is fresh.
    for (const [step, day] of [
      [0, new Date(Date.now() - 62 * 86_400_000)],
      [1, new Date(Date.now() - 31 * 86_400_000)],
      [2, new Date()],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: source.id,
          observationDate: day,
          value: 100 + step * 10,
          retrievedAt: new Date(),
          raw: {},
        },
      });
    }
  }
}

async function clean(): Promise<void> {
  const source = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
  if (!source) return;
  await prisma.observation.deleteMany({ where: { sourceId: source.id } });
  await prisma.series.deleteMany({ where: { sourceId: source.id } });
  await prisma.source.delete({ where: { id: source.id } });
}

async function ask(query: string): Promise<string> {
  const result = await askMarket(query);
  const factors = result.seriesFactors.map((f) => `${f.seriesName}=${f.value}`).join(", ");
  return `${result.status}${factors ? ` [${factors}]` : ""}`;
}

async function main(): Promise<void> {
  await clean();
  const query = "금리와환율은 얼마인가요?";
  const authority = resolveRequestAuthority(query);
  console.log(
    `parser: ${authority.status}` +
      (authority.status === "AUTHORIZED" ? ` subject="${authority.subjectRegion.trim()}"` : ""),
  );

  try {
    await seed([NARROW]);
    console.log(`only "${NARROW}" stored   -> ${await ask(query)}`);
    await clean();

    await seed([NARROW, OTHER]);
    console.log(`"${NARROW}" and "${OTHER}"  -> ${await ask(query)}`);
    await clean();

    await seed([]);
    console.log(`neither stored       -> ${await ask(query)}`);
    await clean();

    // The control that decides whether the three lines above mean anything. If Korean never serves
    // ANY subject, "not reproduced" is vacuous -- it would say only that this path is dead.
    await seed([NARROW]);
    console.log(`
control: exact stem  -> ${await ask("환율은 얼마인가요?")}`);
    console.log(`control: embedded    -> ${await ask("금리와환율은 얼마인가요?")}`);
    await clean();

    // Round four falsified the explanation above for regions that carry punctuation. Normalization
    // turns `-` and `/` into spaces, so a stored name that is one component of a hyphenated pair
    // becomes a whole token occurrence and matches. Exact-stem identity is NOT a property of the
    // Korean path; it is a property of FUSED HANGUL, which has no boundary to expose.
    await seed(["KRW"]);
    console.log(`
only "KRW" stored:`);
    for (const q of ["USD-KRW는 얼마인가요?", "USD/KRW는 얼마인가요?", "USD-KRW 얼마인가요?"]) {
      console.log(`  ${q.padEnd(22)} -> ${await ask(q)}`);
    }
  } finally {
    await clean();
    await prisma.$disconnect();
  }

  console.log(
    "\nThe finding is reproduced if the three lines differ: one stored name serves, two refuse,\n" +
      "none finds nothing. Then the repository decides whether the request was answerable.",
  );
}

void main();
