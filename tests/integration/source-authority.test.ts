import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import type { InferenceSink } from "@/server/domain/askMarketInference";

/**
 * A record from provider Y may not answer a request attributed to provider X.
 *
 * IR-107 B2-C. `CanonicalPlannerRequest` has always carried `sourceRegion`, and
 * `deriveCanonicalCandidateEnvelope` never read it: the ATTRIBUTED_REPORTED_OBSERVATION branch
 * resolved by SUBJECT identity alone, and the legacy envelope delegated to subject authority the
 * same way. Attribution was not a candidate-authority dimension at all. Reproduced against real
 * PostgreSQL before any code changed, with only Yankeefeed publishing the subject:
 *
 *     What did Xraywire analysts publish about <subject>?
 *       canonical  AUTHORIZED, carrying Yankeefeed's series
 *       legacy     AUTHORIZED, carrying Yankeefeed's series
 *       planner    called, 1 generatePlan
 *
 * The figure was real, the subject was right, the attribution was false — and the number being real
 * is what would have made it credible.
 *
 * ## The distinction the repair turns on
 *
 * "Explicitly attributed to X" is not the same as "somebody else reported it". Every frame-eligible
 * attributed shape in this repository's corpus reads `What did analysts publish about X?`, where
 * `analysts` is the vocabulary that PROVES the third-party frame rather than a party. Requiring THAT
 * to resolve to a stored provider does not secure the operation, it deletes it — measured, at 54
 * failing tests. So a role naming no party proceeds unconstrained, and a role naming a party this
 * repository cannot identify refuses.
 *
 * Both halves are asserted below. Neither is safe alone: the first without the second publishes
 * anyone's row for a named provider, and the second without the first removes the operation.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const X_CODE = "TESTSRCAUTH_X";
const Y_CODE = "TESTSRCAUTH_Y";
const D_CODE = "TESTSRCAUTH_DUP";
const X_NAME = "Xraywire analysts";
const Y_NAME = "Yankeefeed analysts";
/** Deliberately identical to X_NAME: `Source.name` is free text and is not unique. */
const DUP_NAME = X_NAME;
const SUBJECT = "TESTSRCAUTH Widget Price Index";
const X_ONLY_SUBJECT = "TESTSRCAUTH Exclusive Series";

const day = 24 * 60 * 60 * 1000;
const CODES = [X_CODE, Y_CODE, D_CODE];

describeIfDb("exact source authority", () => {
  let prisma: typeof PrismaClientInstance;

  const wipe = async () => {
    const sources = await prisma.source.findMany({ where: { code: { in: CODES } } });
    for (const source of sources) {
      await prisma.observation.deleteMany({ where: { sourceId: source.id } });
      await prisma.series.deleteMany({ where: { sourceId: source.id } });
    }
    await prisma.source.deleteMany({ where: { code: { in: CODES } } });
  };

  const seed = async (code: string, name: string, subjects: string[]) => {
    const source = await prisma.source.create({ data: { code, name, tier: "TIER_S" } });
    for (const [index, subject] of subjects.entries()) {
      const series = await prisma.series.create({
        data: {
          sourceId: source.id,
          externalId: `${code}_${index}`,
          name: subject,
          unit: "index",
          frequency: "daily",
        },
      });
      for (const ago of [1, 2]) {
        await prisma.observation.create({
          data: {
            seriesId: series.id,
            sourceId: source.id,
            observationDate: new Date(Date.now() - ago * day),
            value: code === X_CODE ? "101.0" : "202.0",
            raw: {},
          },
        });
      }
    }
    return source.id;
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  /** The canonical envelope, plus which provider actually owns each series it offered. */
  const canonical = async (query: string) => {
    const { authorizeInference } = await import("@/server/domain/inferenceAuthorization");
    const { asPlannerRequest } = await import("@/server/domain/requestAuthority");
    const { deriveCanonicalCandidateEnvelope } = await import("@/server/domain/candidateEnvelope");
    const authorization = authorizeInference(query);
    if (!authorization.eligible || authorization.provenance !== "CANONICAL") {
      return { status: "not-canonical", providers: [] as string[] };
    }
    const plannerRequest = asPlannerRequest(authorization.request);
    if (plannerRequest === null) return { status: "not-planner", providers: [] as string[] };
    const envelope = await deriveCanonicalCandidateEnvelope(query, plannerRequest);
    const rows = await prisma.series.findMany({
      where: { id: { in: [...envelope.seriesIds] } },
      include: { source: { select: { code: true } } },
    });
    return { status: envelope.status, providers: rows.map((r) => r.source.code) };
  };

  const legacy = async (query: string) => {
    const { deriveLegacyCandidateEnvelope } = await import("@/server/domain/candidateEnvelope");
    const envelope = await deriveLegacyCandidateEnvelope(query);
    const rows = await prisma.series.findMany({
      where: { id: { in: [...envelope.seriesIds] } },
      include: { source: { select: { code: true } } },
    });
    return { status: envelope.status, providers: rows.map((r) => r.source.code) };
  };

  /** The production planner path, counting model calls rather than assuming there were none. */
  const planner = async (query: string) => {
    const { answerWithInference } = await import("@/server/domain/askMarketInference");
    const calls: string[] = [];
    const sink: InferenceSink = {
      generatePlan: async (q: string) => {
        calls.push(q);
        return { segments: [] };
      },
    };
    const outcome = await answerWithInference(query, sink);
    return { status: outcome.status, calls: calls.length };
  };

  const attributed = (source: string) => `What did ${source} publish about ${SUBJECT}?`;

  describe("only Y publishes the subject, and the request names X", () => {
    beforeAll(async () => {
      await wipe();
      await seed(Y_CODE, Y_NAME, [SUBJECT]);
      await seed(X_CODE, X_NAME, [X_ONLY_SUBJECT]);
    });

    it("offers no candidate on the canonical door", async () => {
      // WRONG-SOURCE SUBSTITUTION, the defect this unit exists for.
      const result = await canonical(attributed(X_NAME));
      expect(result.providers, JSON.stringify(result)).toHaveLength(0);
      expect(result.status).toBe("UNRESOLVED");
    });

    it("offers no candidate on the legacy door", async () => {
      const result = await legacy(attributed(X_NAME));
      expect(result.providers, JSON.stringify(result)).toHaveLength(0);
    });

    it("never calls the planner", async () => {
      // PLANNER SINK ZERO-CALL. Asserted with a counting sink rather than inferred from the final
      // status: an earlier version of this probe used a stub with the wrong method name, the call
      // threw, and the run still reported zero. A zero that comes from a crash is not a zero.
      const result = await planner(attributed(X_NAME));
      expect(result.calls, JSON.stringify(result)).toBe(0);
      expect(result.status).toBe("NO_CANDIDATE_EVIDENCE");
    });

    it("still answers about the provider that was actually named", async () => {
      // POSITIVE NON-VACUITY. Without this the three refusals above are satisfied by a broken path.
      const result = await canonical(attributed(Y_NAME));
      expect(result.status, JSON.stringify(result)).toBe("AUTHORIZED");
      expect(result.providers).toEqual([Y_CODE]);
    });
  });

  describe("both providers publish the same subject", () => {
    beforeAll(async () => {
      await wipe();
      await seed(X_CODE, X_NAME, [SUBJECT]);
      await seed(Y_CODE, Y_NAME, [SUBJECT]);
    });

    it("answers about X for a request naming X", async () => {
      // SAME SUBJECT UNDER TWO PROVIDERS. This is also a capability the repair GAINED: resolving
      // the provider first removes the cross-provider subject collision, which used to come back
      // AMBIGUOUS and answer nobody.
      const result = await canonical(attributed(X_NAME));
      expect(result.status, JSON.stringify(result)).toBe("AUTHORIZED");
      expect(result.providers).toEqual([X_CODE]);
    });

    it("answers about Y for a request naming Y", async () => {
      const result = await canonical(attributed(Y_NAME));
      expect(result.status, JSON.stringify(result)).toBe("AUTHORIZED");
      expect(result.providers).toEqual([Y_CODE]);
    });
  });

  describe("the source role does not name one provider", () => {
    beforeAll(async () => {
      await wipe();
      await seed(X_CODE, X_NAME, [SUBJECT]);
      await seed(D_CODE, DUP_NAME, [SUBJECT]);
    });

    it("refuses when two stored providers answer to the named one", async () => {
      // SOURCE AMBIGUITY. `Source.name` is free text and is not unique. Two providers answering to
      // one name means the request did not say which, and picking either would invent the
      // attribution.
      const result = await canonical(attributed(X_NAME));
      expect(result.providers, JSON.stringify(result)).toHaveLength(0);
      expect(result.status).toBe("AMBIGUOUS");
    });

    it("refuses when the source role says more than the provider's name", async () => {
      // SOURCE RESIDUE, and note what rides in it: a trading directive sitting inside the source
      // role. Reproduced reaching the planner before this unit.
      const result = await canonical(
        `What did ${X_NAME} Purchase Gamma shares publish about ${SUBJECT}?`,
      );
      expect(result.providers, JSON.stringify(result)).toHaveLength(0);
      expect(result.status).toBe("UNRESOLVED");
    });

    it("refuses a named provider this repository does not hold", async () => {
      const result = await canonical(attributed("Nowhere Research analysts"));
      expect(result.providers, JSON.stringify(result)).toHaveLength(0);
      expect(result.status).toBe("UNRESOLVED");
    });
  });

  describe("the source role names no party at all", () => {
    beforeAll(async () => {
      await wipe();
      await seed(X_CODE, X_NAME, [SUBJECT]);
    });

    it("answers a generic third-party question across providers", async () => {
      // THE OTHER HALF. `analysts` is the vocabulary that proves the third-party frame, not a
      // party, so there is no attribution to get wrong and nothing to constrain. Requiring it to
      // resolve to a stored provider removed 54 tests' worth of ordinary behaviour when tried.
      const result = await canonical(`What did analysts publish about ${SUBJECT}?`);
      expect(result.status, JSON.stringify(result)).toBe("AUTHORIZED");
      expect(result.providers).toEqual([X_CODE]);
    });

    it("treats a generic term with a determiner the same way", async () => {
      const result = await canonical(`What did the analysts publish about ${SUBJECT}?`);
      expect(result.status, JSON.stringify(result)).toBe("AUTHORIZED");
    });
  });
});
