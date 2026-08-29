import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Grammar must not change because inventory changes.
 *
 * IR-107. The parser never reads the repository, so its output is stable by construction and a
 * harness comparing only parse strings will report a clean tree over a live defect -- the original
 * `scripts/reproduce-framing-position.ts` did exactly that, printing "0/5 inventory-dependent"
 * while this was happening at 57d242c against real PostgreSQL:
 *
 *     Explain how process A affects B.
 *       only `A -> B` stored          -> published A            (`process` read as framing)
 *       only `Process A -> B` stored  -> published `Process A`  (`process` read as identity)
 *
 * Same sentence, same parsed role, two different subjects, chosen by what happened to be stored.
 *
 * The property asserted here is therefore NOT "the parse string is stable" -- that is necessary and
 * nowhere near sufficient. It is that a PUBLISHED IDENTITY MUST ACCOUNT FOR ITS WHOLE GRAMMATICAL
 * ROLE. If a state publishes an identity that leaves part of the role unexplained, something other
 * than grammar decided where the role ended, and inventory is the only other thing in the loop.
 *
 * Three inventory states, both production doors. ESC-015 §15 requires the deterministic path and
 * the canonical candidate envelope both be proven, not one helper.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const A = "TESTFRAME Alpha";
const PA = "Process TESTFRAME Alpha";
const B = "TESTFRAME Beta";

describeIfDb("framing is a position, not a bag", () => {
  let prisma: typeof PrismaClientInstance;

  const seeded = { fromVariable: { in: [A, PA] } };

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    await prisma.causalEdge.deleteMany({ where: seeded });
  });

  afterEach(async () => {
    await prisma.causalEdge.deleteMany({ where: seeded });
  });

  afterAll(async () => {
    await prisma.causalEdge.deleteMany({ where: seeded });
    await prisma.$disconnect();
  });

  const seed = async (from: string) => {
    await prisma.causalEdge.create({
      data: {
        fromVariable: from,
        toVariable: B,
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "Seeded for framing-positionality tests.",
        evidence: "Fixture only; asserts role authority, not economics.",
        lag: "1 quarter",
        counterexamples: "Fixture edge; holds only inside this test file.",
      },
    });
  };

  /** The cause-side identity the deterministic door published, or null. */
  const deterministicCause = async (query: string) => {
    const { askMarket } = await import("@/server/domain/askMarket");
    const r = await askMarket(query);
    return r.causalFactors.length > 0 ? r.causalFactors[0].fromVariable : null;
  };

  /** The cause-side identity the canonical candidate door published, or null. */
  const canonicalCause = async (query: string) => {
    const { authorizeInference } = await import("@/server/domain/inferenceAuthorization");
    const { asPlannerRequest } = await import("@/server/domain/requestAuthority");
    const { deriveCanonicalCandidateEnvelope } = await import("@/server/domain/candidateEnvelope");
    const authorization = authorizeInference(query);
    if (!authorization.eligible || authorization.provenance !== "CANONICAL") return null;
    const plannerRequest = asPlannerRequest(authorization.request);
    if (plannerRequest === null) return null;
    const envelope = await deriveCanonicalCandidateEnvelope(query, plannerRequest);
    if (envelope.causalEdgeIds.length === 0) return null;
    const rows = await prisma.causalEdge.findMany({
      where: { id: { in: [...envelope.causalEdgeIds] } },
    });
    return rows[0]?.fromVariable ?? null;
  };

  const parseOf = async (query: string) => {
    const { relationSyntax } = await import("@/server/domain/subjectAuthority");
    const syntax = relationSyntax(query);
    if (syntax.status !== "ONE") return `status=${syntax.status}`;
    const c = syntax.clause;
    return `${c.construction}|${c.requestHeader}|${c.cause}|${c.effect}|${c.polarity}`;
  };

  const QUERY = `Explain how process ${A} affects ${B}.`;

  it("assigns the same cause role whatever the repository holds", async () => {
    // Necessary but not sufficient, and asserted anyway because the sufficient property below is
    // meaningless if this one fails: a role that moved could explain a selection that moved.
    const before = await parseOf(QUERY);
    await seed(A);
    expect(await parseOf(QUERY)).toBe(before);
    await seed(PA);
    expect(await parseOf(QUERY)).toBe(before);
    expect(before).toContain("| process ");
  });

  it("refuses when the only stored identity does not cover the role", async () => {
    // S1. `A` occurs inside ` process A ` and does not account for `process`, so it may not publish.
    // Before the repair this served A, because `process` sat in `FRAMING_TOKENS` and the cover was
    // willing to discard any all-framing prefix.
    await seed(A);
    expect(await deterministicCause(QUERY)).toBeNull();
    expect(await canonicalCause(QUERY)).toBeNull();
  });

  it("publishes the identity that does cover the role", async () => {
    // S2. NON-VACUITY for the test above: the refusal must be about cover, not about the path being
    // broken. Same sentence, different repository, and now there is an exact identity for it.
    await seed(PA);
    expect(await deterministicCause(QUERY)).toBe(PA);
    expect(await canonicalCause(QUERY)).toBe(PA);
  });

  it("takes the maximal exact identity when both are stored", async () => {
    // S3. Not a choice between two readings -- `A` still fails to cover the role, so there is only
    // one candidate that ever qualified.
    await seed(A);
    await seed(PA);
    expect(await deterministicCause(QUERY)).toBe(PA);
    expect(await canonicalCause(QUERY)).toBe(PA);
  });

  it("keeps the plain relation working in every state", async () => {
    // The capability that must not be traded away. `Explain how A affects B.` has no kind noun, so
    // the header is consumed and the role is exactly the identity.
    const plain = `Explain how ${A} affects ${B}.`;
    await seed(A);
    expect(await deterministicCause(plain)).toBe(A);
    await seed(PA);
    // With both stored, `Process A` does not cover ` A `, so the plain question keeps its answer.
    expect(await deterministicCause(plain)).toBe(A);
  });

  it("keeps the construction the framing allowlist existed for", async () => {
    // `What process connects A to B?` -- here `process` really is framing, consumed structurally by
    // the construction's own prefix marker rather than by any word list. If the repair broke this it
    // would have traded one wrong answer for another.
    await seed(A);
    expect(await deterministicCause(`What process connects ${A} to ${B}?`)).toBe(A);
  });

  it.each([
    ["a modal", `Explain how ${A} may affect ${B}.`],
    ["a denial", `Explain how ${A} does not affect ${B}.`],
    ["a condition", `Explain how ${A} affects ${B} only if something else.`],
  ])("still refuses %s", async (_label, query) => {
    // Consuming the header must not cost the evidence that something qualifies the relation. The
    // residue stays in the role and cover still refuses.
    await seed(A);
    expect(await deterministicCause(query), query).toBeNull();
  });
});
