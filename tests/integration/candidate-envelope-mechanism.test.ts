import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * The candidate envelope's mechanism path, end to end against a real repository.
 *
 * ESC-015 item 7 says repository inventory must NEVER decide what the request meant. The envelope
 * is the only layer where inventory enters, so it is the only layer where that rule can actually
 * be broken — and a mutation run found that NOTHING reached it. `deriveCanonicalCandidateEnvelope`
 * had no caller in any test: `candidateEnvelope.test.ts` is a pure-unit file that constructs
 * envelopes by hand and tests the predicates around them, deliberately and for good reasons, but
 * it never runs the resolver. All three guards below scored MISSED.
 *
 * That is the gap this file closes, and it is worth stating plainly: the guards were not weak, they
 * were unobserved. A mutation score of zero out of three is what "no production-path coverage"
 * looks like from the outside.
 *
 * ## Why these inputs and not the obvious one
 *
 * `Explain how A affects B and C.` cannot test this layer. The parser refuses it upstream, on
 * request text alone, before any lookup — which is the correct design and is pinned in
 * `requestAuthority.test.ts`. A mutant here would be killed by that higher gate rather than by the
 * guard under test, and the ESC-015 brief lists exactly that as INVALID mutation evidence.
 *
 * So the residue used here is residue the PARSER cannot see and the ENVELOPE can: a conditional
 * (`only if C`) and a denial (`it is false that`). Both carry no coordinator, no comma and no
 * comparator, so the relation grammar accepts them and the request arrives here as a canonical
 * parse. The envelope refuses because the region is not exactly recognised framing plus the
 * resolved identity.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const CAUSE = "TESTENV Oil Price";
const EFFECT = "TESTENV Headline CPI";
const UNRELATED_FROM = "TESTENV Freight Rate";
const UNRELATED_TO = "TESTENV Shipping Cost";

describeIfDb("the candidate envelope resolves a mechanism, or refuses it", () => {
  let prisma: typeof PrismaClientInstance;
  const created: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    await prisma.causalEdge.deleteMany({ where: { fromVariable: { startsWith: "TESTENV " } } });

    // The edge under test, plus an authentic UNRELATED record. The brief asks for the second
    // explicitly: without it, a refusal could come from an empty table rather than from the guard,
    // and "nothing was found" would be indistinguishable from "the request was refused".
    for (const [from, to] of [
      [CAUSE, EFFECT],
      [UNRELATED_FROM, UNRELATED_TO],
    ]) {
      const edge = await prisma.causalEdge.create({
        data: {
          fromVariable: from,
          toVariable: to,
          direction: "POSITIVE",
          confidence: "MEDIUM",
          mechanism: "Seeded for the envelope mechanism path.",
          evidence: "Test fixture, not a claim about the world.",
          lag: "1-2 quarters",
          counterexamples: "None; this row exists only to be resolved or refused.",
        },
      });
      created.push(edge.id);
    }
  });

  afterAll(async () => {
    await prisma.causalEdge.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  const resolve = async (query: string) => {
    const { resolveRequestAuthority, asPlannerRequest } =
      await import("@/server/domain/requestAuthority");
    const { deriveCanonicalCandidateEnvelope } = await import("@/server/domain/candidateEnvelope");
    const authority = resolveRequestAuthority(query);
    if (authority.status !== "AUTHORIZED") return { parserRefused: true as const, authority };
    const planner = asPlannerRequest(authority);
    if (!planner) return { parserRefused: true as const, authority };
    return {
      parserRefused: false as const,
      envelope: await deriveCanonicalCandidateEnvelope(query, planner),
    };
  };

  it("resolves the single stored pair", async () => {
    // Non-vacuity for everything below. If this is empty the refusals prove nothing.
    const r = await resolve(`Explain how ${CAUSE} affects ${EFFECT}.`);
    expect(r.parserRefused, "the parser must admit the positive control").toBe(false);
    if (r.parserRefused) return;
    expect(r.envelope.status).toBe("AUTHORIZED");
    expect(r.envelope.causalEdgeIds).toHaveLength(1);
  });

  it("refuses a conditional the parser cannot see", async () => {
    // `only if C` is residue with no coordinator, so it reaches this layer. Resolving `A -> B` here
    // would answer an UNCONDITIONAL question when a conditional one was asked.
    const r = await resolve(`Explain how ${CAUSE} affects ${EFFECT} only if ${UNRELATED_TO}.`);
    if (r.parserRefused) {
      expect(r.authority.status).not.toBe("AUTHORIZED");
      return;
    }
    expect(r.envelope.status).not.toBe("AUTHORIZED");
    expect(r.envelope.causalEdgeIds).toEqual([]);
  });

  it("refuses a denial the relation grammar reads as affirmed", async () => {
    const r = await resolve(`Explain how it is false that ${CAUSE} affects ${EFFECT}.`);
    if (r.parserRefused) {
      expect(r.authority.status).not.toBe("AUTHORIZED");
      return;
    }
    expect(r.envelope.status).not.toBe("AUTHORIZED");
    expect(r.envelope.causalEdgeIds).toEqual([]);
  });

  it("refuses when a role names no stored endpoint", async () => {
    // The unrelated row exists and must not be reached for. Repository absence of the named effect
    // is a fact about the repository; it may refuse, and it may not resolve something else.
    const r = await resolve(`Explain how ${CAUSE} affects TESTENV Nothing Stored.`);
    if (r.parserRefused) {
      expect(r.authority.status).not.toBe("AUTHORIZED");
      return;
    }
    expect(r.envelope.status).not.toBe("AUTHORIZED");
    expect(r.envelope.causalEdgeIds).toEqual([]);
  });

  it("refuses rather than choosing when a role names two stored endpoints", async () => {
    // Both `EFFECT` and `UNRELATED_TO` are stored effects. Letting inventory pick one would be
    // inventory deciding what was asked.
    const r = await resolve(`Explain how ${CAUSE} affects ${EFFECT} ${UNRELATED_TO}.`);
    if (r.parserRefused) {
      expect(r.authority.status).not.toBe("AUTHORIZED");
      return;
    }
    expect(r.envelope.status).not.toBe("AUTHORIZED");
    expect(r.envelope.causalEdgeIds).toEqual([]);
  });
});
