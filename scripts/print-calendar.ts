/**
 * Real invocation path for the Economic Calendar (M12) — prints a cadence-projected next
 * expected observation date for every tracked series. See economicCalendar.ts's module
 * docstring for this milestone's honest scope (no consensus/surprise data — cadence projection
 * from real ingested history only).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/print-calendar.ts
 */
import { computeCalendar } from "../src/server/domain/economicCalendar";
import { prisma } from "../src/server/db/client";

async function main() {
  const calendar = await computeCalendar();
  for (const entry of calendar) {
    if (entry.status === "PROJECTED") {
      const daysUntil = entry.daysUntilExpectedNext ?? 0;
      console.log(
        `${entry.seriesName} (${entry.sourceCode}:${entry.externalId}): last ${entry.lastObservedValue} ` +
          `on ${entry.lastObservedDate}, next expected ~${entry.expectedNextDate} ` +
          `(${daysUntil >= 0 ? "in" : ""} ${Math.abs(daysUntil)} days${daysUntil < 0 ? " overdue" : ""})`,
      );
    } else {
      console.log(`${entry.sourceCode}:${entry.externalId}: ${entry.status}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
