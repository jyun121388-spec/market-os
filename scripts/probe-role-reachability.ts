/**
 * Are the two MISSED role-cover mutants reachable, or equivalent over the real path?
 *
 * The role-cover mutation run caught 3 of 5. The two survivors were `M-ROLE-COVER-TAIL` (drop the
 * requirement that the identity BE the tail, keep the framing requirement) and
 * `M-ROLE-COVER-AMBIGUOUS` (stop refusing when two identities both cover). Before writing a test
 * for either, establish whether a real request can reach them -- ESC-015 §19 forbids manufacturing
 * a case to turn a survivor red, and requires an honest classification instead.
 *
 * ## The mechanism argument this probe is checking
 *
 * Cover demands the identity be the TAIL of the role and everything before it be framing. So if
 * the identity is NOT the tail but the prefix still passes, the identity must lie inside that
 * all-framing prefix -- i.e. the stored name is itself composed entirely of framing tokens. `rate`,
 * `value`, `level`, `figure`, `number`, `reading` and `print` are all in `FRAMING_TOKENS`, so a feed
 * storing a series called `Rate` is the shape to test.
 *
 * For AMBIGUOUS the same argument bites harder: two distinct names can only both be the tail if one
 * is a token-suffix of the other, and then the shorter's tail occurrence sits INSIDE the longer's,
 * where `explicitlyNamed` drops it before cover is ever consulted. The prediction is therefore
 * REACHABLE for the first and UNREACHABLE for the second. A prediction is not a result; run it.
 *
 *   npx tsx scripts/probe-role-reachability.ts
 */

import { prisma } from "@/server/db/client";
import { askMarket } from "@/server/domain/askMarket";
import { exactRoleCover } from "@/server/domain/canonicalRoleCover";
import { requestFramingIsRecognised } from "@/server/domain/requestAuthority";
import { explicitlyNamed } from "@/server/domain/subjectAuthority";

const CODE = "TEST_ROLE_REACHABILITY_PROBE";

async function reseed(names: string[]) {
  const source = await prisma.source.upsert({
    where: { code: CODE },
    update: {},
    create: { code: CODE, name: "Role reachability probe", tier: "TIER_S" },
  });
  await prisma.observation.deleteMany({ where: { sourceId: source.id } });
  await prisma.series.deleteMany({ where: { sourceId: source.id } });
  const day = 24 * 60 * 60 * 1000;
  for (const name of names) {
    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: `${CODE}_${name.replace(/\s+/g, "_")}`,
        name,
        unit: "index",
        frequency: "daily",
      },
    });
    for (const [ago, value] of [
      [1, "102.0"],
      [2, "100.0"],
    ] as const) {
      await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: source.id,
          observationDate: new Date(Date.now() - ago * day),
          value,
          raw: {},
        },
      });
    }
  }
  return source.id;
}

async function ask(query: string) {
  const r = await askMarket(query);
  const served = r.seriesFactors.length + r.causalFactors.length + r.companyFacts.length;
  return `status=${r.status} served=${served}`;
}

/** Cover in isolation, fed the discovery output the production path would give it. */
function coverOf(region: string, storedNames: string[]) {
  const rows = storedNames.map((name) => ({ name }));
  const discovered = explicitlyNamed(rows, (r) => r.name, region);
  const cover = exactRoleCover(
    region,
    "OCCURRENCE",
    rows,
    (r) => r.name,
    requestFramingIsRecognised,
  );
  return `discovery=[${discovered.map((d) => d.name).join("|")}] cover=${cover.status}${
    cover.status === "UNRESOLVED" ? `:${cover.reason}` : ""
  }`;
}

async function main() {
  // --- M-ROLE-COVER-TAIL: a series named entirely from framing vocabulary -------------------
  console.log("=== TAIL: stored name is itself framing vocabulary ===");
  let sourceId = await reseed(["Rate"]);
  for (const q of [
    "What is the current rate value?",
    "What is the current rate level?",
    "What is the current rate?",
  ]) {
    console.log(`  ${JSON.stringify(q)} -> ${await ask(q)}`);
  }
  for (const region of [" rate value ", " the rate value ", " rate "]) {
    console.log(`  region ${JSON.stringify(region)} -> ${coverOf(region, ["Rate"])}`);
  }

  // --- M-ROLE-COVER-AMBIGUOUS: search for ANY pair that both cover ---------------------------
  //
  // Exhaustive over a constructed space rather than over examples I find persuasive: every
  // suffix-nested pair, plus pairs sharing a framing lead, against every region either could plaus-
  // ibly cover. If nothing here is AMBIGUOUS, the branch is unreachable by this route and must be
  // recorded as such rather than tested into a false green.
  console.log("\n=== AMBIGUOUS: search over nested and framing-led name pairs ===");
  const bases = ["Zephyrium", "Rate of Zephyrium", "Zephyrium Rate", "Rate", "Value of Zephyrium"];
  const framing = ["", "the ", "the current ", "how much has "];
  let ambiguous = 0;
  let checked = 0;
  for (const a of bases) {
    for (const b of bases) {
      if (a === b) continue;
      for (const lead of framing) {
        for (const tail of [a, b]) {
          const region = ` ${lead}${tail} `.toLowerCase();
          const rows = [{ name: a }, { name: b }];
          const cover = exactRoleCover(
            region,
            "OCCURRENCE",
            rows,
            (r) => r.name,
            requestFramingIsRecognised,
          );
          checked += 1;
          if (cover.status === "AMBIGUOUS") {
            ambiguous += 1;
            console.log(
              `  AMBIGUOUS region=${JSON.stringify(region)} names=${cover.names.join("|")}`,
            );
          }
        }
      }
    }
  }
  console.log(`  ${checked} pairs x regions checked, ${ambiguous} AMBIGUOUS`);

  // And the same question end-to-end, where `explicitlyNamed` gets its say first.
  console.log("\n=== AMBIGUOUS end-to-end with both stored ===");
  await prisma.observation.deleteMany({ where: { sourceId } });
  await prisma.series.deleteMany({ where: { sourceId } });
  sourceId = await reseed(["Zephyrium", "Rate of Zephyrium"]);
  for (const q of ["What is the current Rate of Zephyrium?", "What is the current Zephyrium?"]) {
    console.log(`  ${JSON.stringify(q)} -> ${await ask(q)}`);
    console.log(
      `      ${coverOf(` ${q.toLowerCase().replace(/^what is the current |\?$/g, "")} `, ["Zephyrium", "Rate of Zephyrium"])}`,
    );
  }

  await prisma.observation.deleteMany({ where: { sourceId } });
  await prisma.series.deleteMany({ where: { sourceId } });
  await prisma.source.delete({ where: { id: sourceId } });
  await prisma.$disconnect();
}

void main();
