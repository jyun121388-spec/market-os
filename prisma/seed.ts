/**
 * Seeds the initial Tier S source registry. Idempotent: safe to run multiple times
 * (upsert by unique `code`).
 */
import { prisma } from "../src/server/db/client";
import { SOURCES } from "./sources";

async function main() {
  for (const source of SOURCES) {
    await prisma.source.upsert({
      where: { code: source.code },
      update: { name: source.name, tier: source.tier },
      create: source,
    });
  }
  console.log(`Seeded ${SOURCES.length} sources.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
