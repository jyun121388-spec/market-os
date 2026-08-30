/**
 * Every corpus row's canonical operation and planner-call count, as a diffable snapshot.
 *
 * MARKET-DEFINITION-GRAMMAR-001. A recognition change has to be judged on the WHOLE corpus, not on
 * the family it targets: the way a grammar repair goes wrong is by quietly pulling unrelated rows
 * into the operation it just learned. A headline percentage cannot show that and a count of the
 * intended nine cannot either, so this writes one line per row and the two snapshots are diffed.
 *
 * Deliberately separate from `legacy-bypass-readiness.ts`, whose semantics are independently
 * reviewed and must not be altered while a grammar change is in flight. This reads the same typed
 * corpus and asserts the same denominator, and it decides nothing about safety classes.
 *
 *   DATABASE_URL=... npx tsx scripts/corpus-transition-matrix.ts > before.tsv
 *   ... change the grammar ...
 *   DATABASE_URL=... npx tsx scripts/corpus-transition-matrix.ts > after.tsv
 *   npx tsx scripts/corpus-transition-matrix.ts --diff before.tsv after.tsv
 */

import { readFileSync } from "node:fs";
import { REQUEST_DEVELOPMENT_CORPUS } from "../tests/fixtures/requestDevelopmentCorpus";
import { resolveRequestAuthority, asPlannerRequest } from "@/server/domain/requestAuthority";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { answerWithInference, type InferenceSink } from "@/server/domain/askMarketInference";

const CANONICAL_DENOMINATOR = 500;

/**
 * One real trip through the production door, counting model calls.
 *
 * The count is read from OUTSIDE the try, so a call followed by a failure is still a call. That
 * accounting error was found in the readiness script by review and is not going to be reintroduced
 * here by a second implementation of the same idea.
 */
async function plannerCalls(query: string): Promise<{ calls: number; threw: string | null }> {
  let calls = 0;
  const sink: InferenceSink = {
    generatePlan: async () => {
      calls += 1;
      return { segments: [] };
    },
  };
  try {
    await answerWithInference(query, sink);
    return { calls, threw: null };
  } catch (error) {
    return { calls, threw: (error as Error).message.slice(0, 60) };
  }
}

async function snapshot() {
  if (REQUEST_DEVELOPMENT_CORPUS.length !== CANONICAL_DENOMINATOR) {
    console.error(
      `DENOMINATOR MISMATCH: ${REQUEST_DEVELOPMENT_CORPUS.length} != ${CANONICAL_DENOMINATOR}`,
    );
    process.exit(2);
  }
  console.log(
    [
      "id",
      "lang",
      "expected",
      "expectedOp",
      "canonicalStatus",
      "canonicalOp",
      "provenance",
      "plannerPermitted",
      "plannerCalls",
    ].join("\t"),
  );
  for (const c of REQUEST_DEVELOPMENT_CORPUS) {
    const canonical = resolveRequestAuthority(c.query);
    const authorization = authorizeInference(c.query);
    const permitted =
      authorization.eligible && authorization.provenance === "CANONICAL"
        ? asPlannerRequest(authorization.request) !== null
        : null;
    const { calls, threw } = await plannerCalls(c.query);
    console.log(
      [
        c.id,
        c.language,
        c.expected,
        c.operation,
        canonical.status,
        canonical.status === "AUTHORIZED" ? canonical.operation : "-",
        authorization.eligible ? authorization.provenance : `blocked/${authorization.blockedBy}`,
        permitted === null ? "-" : String(permitted),
        threw === null ? String(calls) : `${calls}/THREW`,
      ].join("\t"),
    );
  }
}

function diff(beforePath: string, afterPath: string) {
  const read = (p: string) =>
    new Map(
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("id\t"))
        .map((l) => {
          const f = l.split("\t");
          return [f[0], l] as const;
        }),
    );
  const before = read(beforePath);
  const after = read(afterPath);
  const changed: string[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (a !== undefined && a !== b) changed.push(`- ${b}\n+ ${a}`);
  }
  console.log(`rows before ${before.size}, after ${after.size}, CHANGED ${changed.length}`);
  for (const c of changed) console.log(c);
  if (before.size !== after.size) {
    console.log(`DENOMINATOR MOVED — the corpus changed underneath the comparison.`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--diff") diff(args[1], args[2]);
else void snapshot();
