import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * A relation endpoint that names one thing and then says more, against a real repository.
 *
 * These two cases used to be asserted at the parser, refused by a test for a comma anywhere in the
 * raw query. That block's own comment argued the placement was the point -- the parser consults no
 * repository, so a refusal there cannot be confused with a lookup that found nothing, and
 * "an integration test could not tell those apart."
 *
 * That objection was correct when it was written and is answerable now: a role-authority failure
 * returns REQUEST_NOT_SUPPORTED and an empty repository returns NOT_FOUND, so the two ARE
 * distinguishable here, and every assertion below checks the status rather than only the absence of
 * output. The other five shapes in that block -- `and`, `or`, `versus`, `compared with`, and a
 * conjoined cause -- stay at the parser, where closed connective vocabulary still decides them
 * without any lookup.
 *
 * ## Why the comma had to move
 *
 * The comma test read the RAW query, because normalization deletes punctuation before any region
 * exists. So it could not distinguish `Beta, Gamma` from `Alpha, Inc.`, and it refused both --
 * pinned as an open availability defect for as long as nothing else could refuse the first.
 *
 * The repository can answer directly what the comma could only infer from punctuation: does one
 * stored identity explain this whole endpoint role? `beta gamma` names `Beta` and then says more.
 * `alpha inc` is exactly the stored `Alpha, Inc.`. No punctuation rule can see that difference and
 * no vocabulary of corporate suffixes is needed to describe it.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const CAUSE = "TESTREL Alpha";
const COMMA_CAUSE = "TESTREL Alpha, Inc.";
const EFFECT = "TESTREL Beta";

describeIfDb("a relation endpoint must be explained by one stored variable", () => {
  let prisma: typeof PrismaClientInstance;

  // `CausalEdge` carries no source relation, so the seeded rows are identified by their variable
  // names alone -- prefixed so this file's cleanup cannot reach another file's edges.
  const seeded = { fromVariable: { in: [CAUSE, COMMA_CAUSE] } };

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    await prisma.causalEdge.deleteMany({ where: seeded });
    for (const from of [CAUSE, COMMA_CAUSE]) {
      await prisma.causalEdge.create({
        data: {
          fromVariable: from,
          toVariable: EFFECT,
          direction: "POSITIVE",
          confidence: "MEDIUM",
          mechanism: "Seeded for role-cover tests.",
          evidence: "Fixture only; asserts role authority, not economics.",
          lag: "1-2 quarters",
          counterexamples: "Fixture edge; holds only inside this test file.",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.causalEdge.deleteMany({ where: seeded });
    await prisma.$disconnect();
  });

  const ask = async (query: string) => {
    const { askMarket } = await import("@/server/domain/askMarket");
    return askMarket(query);
  };

  it("publishes the relation when both roles are exactly covered", async () => {
    // NON-VACUITY for everything below, and the direct evidence that retiring the raw comma test
    // restored a capability rather than only removing a rule.
    const r = await ask(`Explain how ${CAUSE} affects ${EFFECT}.`);
    expect(r.status, JSON.stringify(r)).toBe("FACTORS_FOUND");
    expect(r.causalFactors.length).toBeGreaterThan(0);
  });

  it("publishes a relation whose endpoint name contains a comma", async () => {
    // WAS PINNED as `it.fails` at the parser: `Alpha, Inc.` is ordinary US style and the raw comma
    // test refused the whole relation before it was even recognised. The name is now served,
    // because the role is exactly the stored identity and nothing else.
    const r = await ask(`Explain how ${COMMA_CAUSE} affects ${EFFECT}.`);
    expect(r.status, JSON.stringify(r)).toBe("FACTORS_FOUND");
    expect(r.causalFactors.map((f) => f.fromVariable)).toContain(COMMA_CAUSE);
  });

  it.each([
    ["the effect", `Explain how ${CAUSE} affects ${EFFECT}, Gamma.`],
    ["the cause", `Explain how ${CAUSE}, Gamma affect ${EFFECT}.`],
  ])("refuses a second object introduced by a comma in %s", async (_label, query) => {
    const r = await ask(query);
    expect(r.causalFactors, query).toHaveLength(0);
    // The distinction the parser could not draw and this layer must: the relation IS stored, so
    // NOT_FOUND would be a false statement about inventory. What failed is the role.
    expect(r.status, query).toBe("REQUEST_NOT_SUPPORTED");
  });

  it("refuses whether or not the second object could ever be known", async () => {
    // The invariant the parser placement was protecting, preserved across the move. A coined second
    // object that no repository could hold must be refused exactly as a plausible one is -- if the
    // refusal consulted inventory about the SECOND object, these two would differ.
    const known = await ask(`Explain how ${CAUSE} affects ${EFFECT}, Gamma.`);
    const coined = await ask(`Explain how ${CAUSE} affects ${EFFECT}, Zorbulate.`);
    expect(known.status).toBe("REQUEST_NOT_SUPPORTED");
    expect(coined.status).toBe(known.status);
    expect(coined.causalFactors).toHaveLength(0);
  });

  it("reports an unknown relation as absent, not as unsupported", async () => {
    // The other side of the status distinction. A well-formed role naming nothing stored is an
    // inventory gap, and calling it REQUEST_NOT_SUPPORTED would blame the request for a hole in the
    // data. Without this, refusing everything would pass every test above.
    const r = await ask("Explain how TESTREL Nowhere affects TESTREL Neither.");
    expect(r.status, JSON.stringify(r)).toBe("NOT_FOUND");
  });
});
