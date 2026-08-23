import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_CODE = "TEST_VERIFY_SOURCE";
const OTHER_SOURCE_CODE = "TEST_VERIFY_OTHER_SOURCE";

describeIfDb("claim verification (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let createFactClaimFromObservation: typeof import("@/server/domain/claimStore").createFactClaimFromObservation;
  let computeSeriesChange: typeof import("@/server/domain/whatChanged").computeSeriesChange;
  let verifyClaim: typeof import("@/server/domain/claimVerification").verifyClaim;
  let buildFactClaimText: typeof import("@/server/domain/claimStore").buildFactClaimText;
  let sourceId: string;
  let otherSourceId: string;
  let observationId: string;
  let seriesId: string;
  let otherSeriesId: string;
  let currentObsId: string;
  let previousObsId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ createFactClaimFromObservation } = await import("@/server/domain/claimStore"));
    ({ computeSeriesChange } = await import("@/server/domain/whatChanged"));
    ({ verifyClaim } = await import("@/server/domain/claimVerification"));
    ({ buildFactClaimText } = await import("@/server/domain/claimStore"));

    for (const code of [TEST_SOURCE_CODE, OTHER_SOURCE_CODE]) {
      const existing = await prisma.source.findUnique({ where: { code } });
      if (existing) {
        await prisma.claim.deleteMany({ where: { sourceId: existing.id } });
        await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
        await prisma.series.deleteMany({ where: { sourceId: existing.id } });
        await prisma.source.delete({ where: { id: existing.id } });
      }
    }

    const source = await prisma.source.create({
      data: { code: TEST_SOURCE_CODE, name: "Test Verify Source", tier: "TIER_S" },
    });
    sourceId = source.id;
    const otherSource = await prisma.source.create({
      data: { code: OTHER_SOURCE_CODE, name: "Test Verify Other Source", tier: "TIER_S" },
    });
    otherSourceId = otherSource.id;

    const series = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TESTVERIFY",
        name: "Test Verify Series",
        unit: "percent",
        frequency: "daily",
      },
    });
    seriesId = series.id;

    const observation = await prisma.observation.create({
      data: {
        seriesId: series.id,
        sourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "3.50",
        raw: {},
      },
    });
    observationId = observation.id;

    // A second series (same source) for the CALCULATION-claim tests, plus a series belonging
    // to OTHER_SOURCE_CODE used for the "different series" tampering test.
    const changeSeries = await prisma.series.create({
      data: {
        sourceId,
        externalId: "TESTVERIFY_CHANGE",
        name: "Test Verify Change Series",
        unit: "percent",
        frequency: "daily",
      },
    });
    const previousObs = await prisma.observation.create({
      data: {
        seriesId: changeSeries.id,
        sourceId,
        observationDate: new Date("2026-08-13T00:00:00.000Z"),
        value: "2.00",
        raw: {},
      },
    });
    const currentObs = await prisma.observation.create({
      data: {
        seriesId: changeSeries.id,
        sourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "2.25",
        raw: {},
      },
    });
    previousObsId = previousObs.id;
    currentObsId = currentObs.id;

    const otherSeries = await prisma.series.create({
      data: {
        sourceId: otherSourceId,
        externalId: "TESTVERIFY_OTHER_SERIES",
        name: "Test Verify Other Series",
        unit: "percent",
        frequency: "daily",
      },
    });
    otherSeriesId = otherSeries.id;
    await prisma.observation.create({
      data: {
        seriesId: otherSeries.id,
        sourceId: otherSourceId,
        observationDate: new Date("2026-08-14T00:00:00.000Z"),
        value: "2.25", // deliberately the same value as currentObs, for the collision test
        raw: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("verifies a claim built by createFactClaimFromObservation", async () => {
    const claim = await createFactClaimFromObservation(observationId);
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("VERIFIED");
  });

  it("flags a claim whose evidence points at a nonexistent observation", async () => {
    const claim = await prisma.claim.create({
      data: {
        claimText: "fabricated value 9.99",
        claimType: "FACT",
        sourceId,
        evidence: { observationId: "does-not-exist" },
      },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("EVIDENCE_NOT_FOUND");
  });

  it("flags a claim with no evidence at all", async () => {
    const claim = await prisma.claim.create({
      data: { claimText: "unverifiable claim", claimType: "FACT", sourceId },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("EVIDENCE_MISSING");
  });

  it("flags a claim whose text doesn't actually contain the evidenced value", async () => {
    const claim = await prisma.claim.create({
      data: {
        claimText: "the value was definitely 999.99",
        claimType: "FACT",
        sourceId,
        evidence: { observationId },
      },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("VALUE_MISMATCH");
  });

  it("flags a claim attributed to the wrong source even if the value text matches", async () => {
    const claim = await prisma.claim.create({
      data: {
        claimText: "value was 3.50",
        claimType: "FACT",
        sourceId: otherSourceId, // wrong source for this observation
        evidence: { observationId },
      },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("VALUE_MISMATCH");
  });

  /**
   * INFERENCE, through the real verifyClaim path against real PostgreSQL.
   *
   * The pure tests in tests/inferenceClaim.test.ts hold the rules. These hold the WIRING: that
   * atoms are derived from the observation rows rather than from prose, that malformed evidence
   * reaches the fail-closed branch, and that a stored NaN confidence is refused. IR-094 reproduced
   * every one of these as an acceptance before the repair.
   */
  /** Builds a citation whose offsets are computed from the claim text itself. */
  const cite = (
    claimText: string,
    surfaceText: string,
    premiseClaimId: string,
    subjectId: string,
    kind = "OBSERVATION_VALUE",
  ) => {
    const start = claimText.indexOf(surfaceText);
    return {
      premiseClaimId,
      kind,
      subjectId,
      surfaceText,
      assertionStart: start,
      assertionEnd: start + surfaceText.length,
    };
  };

  const factPremise = async () => {
    const observation = await prisma.observation.findUniqueOrThrow({
      where: { id: observationId },
      include: { series: true, source: true },
    });
    const premise = await prisma.claim.create({
      data: {
        claimText: buildFactClaimText(observation),
        claimType: "FACT",
        sourceId,
        evidence: { observationId, seriesId },
      },
    });
    return { premise, observation };
  };

  it("refuses an INFERENCE that rests on nothing", async () => {
    // This asserted UNSUPPORTED_CLAIM_TYPE until INFERENCE gained a verifier. An inference with no
    // premises is not unsupported, it is unfounded — and under a "nothing to contradict it" rule
    // a confident sentence with no evidence verifies cleanly.
    const claim = await prisma.claim.create({
      data: { claimText: "this suggests further easing", claimType: "INFERENCE", confidence: 0.6 },
    });
    const result = await verifyClaim(claim.id);
    expect(result.status).toBe("VALUE_MISMATCH");
    expect(result.detail).toContain("NO_PREMISES");
  });

  it("verifies an INFERENCE whose every quantity cites matching structured evidence", async () => {
    const { premise, observation } = await factPremise();
    const value = observation.value.toString();
    const unit = observation.series.unit;
    const claimText = `The reading stood at ${value} ${unit} on that date.`;
    const inference = await prisma.claim.create({
      data: {
        claimText,
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: {
          premiseClaimIds: [premise.id],
          quantitativeCitations: [cite(claimText, `${value} ${unit}`, premise.id, seriesId)],
        },
      },
    });
    const result = await verifyClaim(inference.id);
    expect(result.status, result.detail).toBe("VERIFIED");
  });

  it("refuses an invented figure the prose never cited", async () => {
    const { premise } = await factPremise();
    const inference = await prisma.claim.create({
      data: {
        claimText: "Growth accelerated to 9.87 percent on this reading.",
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: { premiseClaimIds: [premise.id] },
      },
    });
    const result = await verifyClaim(inference.id);
    expect(result.status).toBe("VALUE_MISMATCH");
    expect(result.detail).toContain("UNCITED_QUANTITY");
    expect(result.detail).toContain("9.87");
  });

  it("refuses a citation whose value does not match the observation row", async () => {
    // The atom comes from the observation, not from the premise sentence, so a citation that
    // quotes a different number fails even though the number is present in the prose.
    const { premise, observation } = await factPremise();
    const unit = observation.series.unit;
    const claimText = `The reading stood at 99 ${unit} on that date.`;
    const inference = await prisma.claim.create({
      data: {
        claimText,
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: {
          premiseClaimIds: [premise.id],
          quantitativeCitations: [cite(claimText, `99 ${unit}`, premise.id, seriesId)],
        },
      },
    });
    const result = await verifyClaim(inference.id);
    expect(result.status).toBe("VALUE_MISMATCH");
    expect(result.detail).toContain("CITATION_UNSUPPORTED");
  });

  it("refuses malformed premiseClaimIds instead of dropping the bad members", async () => {
    // IR-094 candidate D. This verified cleanly: the adapter kept the string and discarded 123,
    // null and {} — malformed evidence normalised into valid evidence.
    const { premise } = await factPremise();
    const inference = await prisma.claim.create({
      data: {
        claimText: "Nothing numeric here.",
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: { premiseClaimIds: [premise.id, 123, null, {}] },
      },
    });
    const result = await verifyClaim(inference.id);
    expect(result.status).toBe("VALUE_MISMATCH");
    expect(result.detail).toContain("MALFORMED_EVIDENCE");
  });

  it("refuses a stored citation with no subjectId", async () => {
    // The evidence validator lists the fields a citation must carry. Nothing exercised the
    // subjectId entry, so deleting it from that list changed no test — a surviving mutant found
    // the gap. Subject binding is the IR-095 candidate G repair; it has to be required at the
    // boundary as well as compared in the checker.
    const { premise } = await factPremise();
    const inference = await prisma.claim.create({
      data: {
        claimText: "Nothing numeric here.",
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: {
          premiseClaimIds: [premise.id],
          quantitativeCitations: [
            {
              premiseClaimId: premise.id,
              kind: "OBSERVATION_VALUE",
              surfaceText: "x",
              assertionStart: 0,
              assertionEnd: 1,
            },
          ],
        },
      },
    });
    const result = await verifyClaim(inference.id);
    expect(result.detail).toContain("MALFORMED_EVIDENCE");
    expect(result.detail).toContain("subjectId");
  });

  it("refuses a citation pointing outside premiseClaimIds", async () => {
    const { premise } = await factPremise();
    const inference = await prisma.claim.create({
      data: {
        claimText: "Nothing numeric here.",
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: {
          premiseClaimIds: [premise.id],
          quantitativeCitations: [
            {
              premiseClaimId: "some-other-claim",
              kind: "OBSERVATION_VALUE",
              subjectId: seriesId,
              surfaceText: "x",
              assertionStart: 0,
              assertionEnd: 1,
            },
          ],
        },
      },
    });
    const result = await verifyClaim(inference.id);
    expect(result.detail).toContain("MALFORMED_EVIDENCE");
  });

  it("refuses a stored NaN confidence, which PostgreSQL accepts", async () => {
    // Written with prisma.claim.create rather than createClaim ON PURPOSE. The ledger now refuses
    // NaN at write time (IR-095 candidate J), so this is the historical-or-tampered row: a value
    // already in the database that the current writer would never produce. Defence in depth is the
    // whole reason the verifier keeps its own check.
    // IR-094 candidate E, production-reachable: double precision stores NaN, Prisma round-trips
    // it, and `NaN < 0 || NaN > 1` is false, so the old range check passed it.
    const { premise } = await factPremise();
    const inference = await prisma.claim.create({
      data: {
        claimText: "Nothing numeric here.",
        claimType: "INFERENCE",
        confidence: NaN,
        evidence: { premiseClaimIds: [premise.id] },
      },
    });
    const stored = await prisma.claim.findUniqueOrThrow({ where: { id: inference.id } });
    expect(Number.isNaN(stored.confidence)).toBe(true);
    const result = await verifyClaim(inference.id);
    expect(result.detail).toContain("CONFIDENCE_NOT_A_NUMBER");
  });

  it("refuses an INFERENCE resting on an INFERENCE that would itself verify", async () => {
    // The control the mutation proof asked for. The other nested case uses an inner inference that
    // fails on its own, so deleting the nested-INFERENCE guard changed nothing and the mutant
    // survived: the guard was in the code and not load-bearing.
    //
    // Here the inner claim verifies. Without the guard the outer would accept it as a premise and
    // pass — a chain of inferences standing in for evidence, which is what the guard exists to
    // stop. Third time a surviving mutant has named an assertion nobody wrote.
    const { premise, observation } = await factPremise();
    const value = observation.value.toString();
    const unit = observation.series.unit;
    const inner = await prisma.claim.create({
      data: {
        claimText: `The reading stood at ${value} ${unit}.`,
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: {
          premiseClaimIds: [premise.id],
          quantitativeCitations: [
            cite(
              `The reading stood at ${value} ${unit}.`,
              `${value} ${unit}`,
              premise.id,
              seriesId,
            ),
          ],
        },
      },
    });
    expect((await verifyClaim(inner.id)).status, "the inner claim must verify on its own").toBe(
      "VERIFIED",
    );

    const outer = await prisma.claim.create({
      data: {
        claimText: "Conditions appear unchanged.",
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: { premiseClaimIds: [inner.id] },
      },
    });
    const result = await verifyClaim(outer.id);
    expect(result.status).toBe("VALUE_MISMATCH");
    expect(result.detail).toContain("PREMISE_NOT_VERIFIED");
    expect(result.detail).toContain("UNSUPPORTED_CLAIM_TYPE");
  });

  it("refuses an INFERENCE resting on an INFERENCE", async () => {
    const inner = await prisma.claim.create({
      data: { claimText: "inner", claimType: "INFERENCE", confidence: 0.5 },
    });
    const outer = await prisma.claim.create({
      data: {
        claimText: "outer",
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: { premiseClaimIds: [inner.id] },
      },
    });
    const result = await verifyClaim(outer.id);
    expect(result.detail).toContain("PREMISE_NOT_VERIFIED");
  });

  it("refuses when a premise claim does not exist", async () => {
    const inference = await prisma.claim.create({
      data: {
        claimText: "x",
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: { premiseClaimIds: ["00000000-0000-0000-0000-000000000000"] },
      },
    });
    const result = await verifyClaim(inference.id);
    expect(result.detail).toContain("PREMISE_NOT_VERIFIED");
  });

  describe("H2 adversarial regressions (structural, not substring, verification)", () => {
    it("rejects a substring collision: real value 3.50, claim text mentions 13.50", async () => {
      // Under the old `claimText.includes(String(value))` check, "13.50" contains "3.50" as a
      // substring and would have false-positive VERIFIED. Exact-text reconstruction must not.
      const claim = await prisma.claim.create({
        data: {
          claimText: "Test Verify Series was 13.50 percent on 2026-08-14 (Test Verify Source)",
          claimType: "FACT",
          sourceId,
          evidence: { observationId, seriesId },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects truthful evidence with a claimText that doesn't match it", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "Something completely different was stated here",
          claimType: "FACT",
          sourceId,
          evidence: { observationId, seriesId },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a FACT claim whose evidence.seriesId doesn't match the evidenced observation's series", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "Test Verify Series was 3.50 percent on 2026-08-14 (Test Verify Source)",
          claimType: "FACT",
          sourceId,
          evidence: { observationId, seriesId: otherSeriesId }, // tampered: wrong series
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("verifies a real CALCULATION claim built by computeSeriesChange", async () => {
      // computeSeriesChange reads the two most recent observations for the series, which are
      // exactly previousObsId/currentObsId seeded above.
      const changeSeries = await prisma.series.findFirstOrThrow({
        where: { externalId: "TESTVERIFY_CHANGE" },
      });
      const result = await computeSeriesChange(changeSeries.id);
      expect(result.status).toBe("COMPUTED");
      const verification = await verifyClaim(result.claimId!);
      expect(verification.status).toBe("VERIFIED");
    });

    it("rejects a CALCULATION claim whose sourceId was repointed at a different source", async () => {
      // Found on 2026-08-17. verifyFactClaim has always compared `claim.sourceId` against the
      // evidenced observation; the CALCULATION path did not. That mattered specifically because
      // `buildChangeClaimText` does not mention the source, so a claim attributing a real change
      // to the WRONG provider reconstructed to byte-identical text and verified as VERIFIED.
      // Provenance is the product's central promise, so a verifier that skips the claimed source
      // on half its claim types is not verifying it.
      const otherSource = await prisma.source.upsert({
        where: { code: "TEST_VERIFY_OTHER_SOURCE" },
        update: {},
        create: { code: "TEST_VERIFY_OTHER_SOURCE", name: "Some other provider", tier: "TIER_S" },
      });

      const changeSeries = await prisma.series.findFirstOrThrow({
        where: { externalId: "TESTVERIFY_CHANGE" },
      });
      const genuine = await computeSeriesChange(changeSeries.id);
      expect(genuine.status).toBe("COMPUTED");
      // Sanity: it verifies before tampering, so the assertion below is about the source alone.
      expect((await verifyClaim(genuine.claimId!)).status).toBe("VERIFIED");

      await prisma.claim.update({
        where: { id: genuine.claimId! },
        data: { sourceId: otherSource.id },
      });

      const result = await verifyClaim(genuine.claimId!);
      expect(result.status).toBe("VALUE_MISMATCH");
      expect(result.detail).toMatch(/sourceId/i);

      // Only the claim is cleaned up. The throwaway source is left in place: it is upserted by
      // code, so re-running is idempotent, and deleting it would fail once anything else in the
      // suite has attached a row to it.
      await prisma.claim.deleteMany({ where: { sourceId: otherSource.id } });
    });

    it("rejects a CALCULATION claim referencing observations from different series", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "fabricated cross-series change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId,
            currentObservationId: currentObsId, // belongs to changeSeries, not `series`
            previousObservationId: observationId, // belongs to `series`
            absoluteChange: 0,
            percentChange: 0,
            bpsChange: 0,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with reversed current/previous order", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "reversed order claim",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: previousObsId, // swapped
            previousObservationId: currentObsId, // swapped
            absoluteChange: -0.25,
            percentChange: -11.11,
            bpsChange: -25,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with a tampered absoluteChange", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "tampered absolute change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: currentObsId,
            previousObservationId: previousObsId,
            absoluteChange: 99, // real delta is 0.25
            percentChange: 12.5,
            bpsChange: 25,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with a tampered percentChange", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "tampered percent change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: currentObsId,
            previousObservationId: previousObsId,
            absoluteChange: 0.25, // this part is correct
            percentChange: 999, // real percentChange is 12.5
            bpsChange: 25,
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });

    it("rejects a CALCULATION claim with a tampered bpsChange", async () => {
      const claim = await prisma.claim.create({
        data: {
          claimText: "tampered bps change",
          claimType: "CALCULATION",
          sourceId,
          evidence: {
            seriesId: (await prisma.observation.findUniqueOrThrow({ where: { id: currentObsId } }))
              .seriesId,
            currentObservationId: currentObsId,
            previousObservationId: previousObsId,
            absoluteChange: 0.25,
            percentChange: 12.5,
            bpsChange: 999999, // real bpsChange is 25
          },
        },
      });
      const result = await verifyClaim(claim.id);
      expect(result.status).toBe("VALUE_MISMATCH");
    });
  });
});
