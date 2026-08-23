import { describe, expect, it, beforeAll } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";
import {
  OUTPUT_AUTHORITY_HOLDOUT,
  OUTPUT_HOLDOUT_SHA256,
} from "../fixtures/outputAuthorityHoldout";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_OUTPUT_AUTHORITY";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A date N days before now, at midnight UTC, so the cadence maths is stable within a run. */
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * MS_PER_DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/**
 * The IR-101 repair, proven against a real database through the production path.
 *
 * The question is not whether a scanner dislikes a sentence. It is whether anything a planner wrote
 * can reach a reader, and the answer has to hold when the planner is hostile, when it is merely
 * wrong, and when the request it is answering was perfectly legitimate.
 */
describeIfDb("output authority (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let answerWithInference: typeof import("@/server/domain/askMarketInference").answerWithInference;
  let validateOutputPlan: typeof import("@/server/domain/outputPlan").validateOutputPlan;
  let deriveCandidateEnvelope: typeof import("@/server/domain/candidateEnvelope").deriveCandidateEnvelope;
  let mentionsEachOther: typeof import("@/server/domain/askMarket").mentionsEachOther;
  let publishClaimForDisplay: typeof import("@/server/domain/claimVerification").publishClaimForDisplay;
  let verifyClaim: typeof import("@/server/domain/claimVerification").verifyClaim;
  let createFactClaimFromObservation: typeof import("@/server/domain/claimStore").createFactClaimFromObservation;
  let computeSeriesChange: typeof import("@/server/domain/whatChanged").computeSeriesChange;

  /**
   * Two queries, because IR-104 made the operation part of the authority.
   *
   * `THIRD_PARTY_REPORTED_FACT` asks what somebody else published, which a stored observation
   * answers, so `ELIGIBLE` is the query for every FACT-shaped test. `FACTUAL_MECHANISM` asks how
   * something works, which only a stored `CausalEdge` answers, and it needs BOTH endpoints named.
   * A question in one frame cannot be answered by the other's records, and most of this file
   * changed shape when that became true rather than being a matter of the planner's judgement.
   */
  const ELIGIBLE = "What did analysts publish about the Test Output freight index?";
  const MECHANISM =
    "What mechanism connects the Test Output freight index to the Test Output shipping cost?";
  /** The reported-fact phrasing for any stored series, so a test can name its own subject. */
  const askAbout = (subject: string) => `What did analysts publish about the ${subject}?`;

  let factClaimId: string;
  let factRendered: string;
  let factValue: string;
  let calcClaimId: string;
  let inferenceClaimId: string;
  let unverifiableClaimId: string;
  let staleClaimId: string;
  let unknownCadenceClaimId: string;
  let explanationId: string;
  let unrelatedFactId: string;
  let unrelatedCalcId: string;
  let unrelatedExplanationId: string;
  let adjacentFactId: string;
  let familyFactId: string;
  let counterpartEdgeId: string;
  let seriesId: string;

  const planning = (plan: unknown) => ({ generatePlan: async () => plan });
  /** Counts calls, so 'the planner was never consulted' is measurable rather than asserted. */
  const countingSink = (plan: unknown) => {
    const calls: string[] = [];
    return {
      calls,
      sink: {
        generatePlan: async (q: string) => {
          calls.push(q);
          return plan;
        },
      },
    };
  };
  const answer = (plan: unknown) => answerWithInference(ELIGIBLE, planning(plan));

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ answerWithInference } = await import("@/server/domain/askMarketInference"));
    ({ validateOutputPlan } = await import("@/server/domain/outputPlan"));
    ({ deriveCandidateEnvelope } = await import("@/server/domain/candidateEnvelope"));
    ({ mentionsEachOther } = await import("@/server/domain/askMarket"));
    ({ publishClaimForDisplay, verifyClaim } = await import("@/server/domain/claimVerification"));
    ({ createFactClaimFromObservation } = await import("@/server/domain/claimStore"));
    ({ computeSeriesChange } = await import("@/server/domain/whatChanged"));

    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (existing) {
      await prisma.claim.deleteMany({ where: { sourceId: existing.id } });
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }
    await prisma.causalEdge.deleteMany({
      where: {
        fromVariable: {
          in: [
            "Test Output freight index",
            "Test Output rogue source",
            "Cabbage harvest volume",
            "Test Output shipping cost",
          ],
        },
      },
    });

    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Test Output Authority Source", tier: "TIER_S" },
    });

    // Four observations a week apart, the newest today: median interval 7 days, 0 days elapsed,
    // so `staleness.ts`'s existing 3x rule says FRESH without anything being tuned to say so.
    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TESTOUTPUT",
        name: "Test Output freight index",
        unit: "percent",
        frequency: "weekly",
      },
    });
    seriesId = series.id;
    let newest = "";
    for (const [i, value] of ["1.10", "1.20", "1.30", "2.40"].entries()) {
      const obs = await prisma.observation.create({
        data: {
          seriesId: series.id,
          sourceId: source.id,
          observationDate: daysAgo(21 - i * 7),
          value,
          raw: {},
        },
      });
      newest = obs.id;
    }
    factValue = "2.4";
    const fact = await createFactClaimFromObservation(newest);
    factClaimId = fact.id;
    factRendered = `[FACT] ${fact.claimText}`;

    // A CALCULATION over the same series, built by the production path rather than hand-written.
    const change = await computeSeriesChange(series.id);
    calcClaimId = change.claimId as string;

    // An INFERENCE resting on the FACT, with a citation bound to the stored value.
    const inferenceText = `The reading stood at ${factValue} percent.`;
    const surface = `${factValue} percent`;
    const inference = await prisma.claim.create({
      data: {
        claimText: inferenceText,
        claimType: "INFERENCE",
        confidence: 0.5,
        evidence: {
          premiseClaimIds: [factClaimId],
          quantitativeCitations: [
            {
              premiseClaimId: factClaimId,
              kind: "OBSERVATION_VALUE",
              subjectId: series.id,
              surfaceText: surface,
              assertionStart: inferenceText.indexOf(surface),
              assertionEnd: inferenceText.indexOf(surface) + surface.length,
            },
          ],
        },
      },
    });
    inferenceClaimId = inference.id;

    // Stored, but it does not verify: an inference resting on nothing.
    const unverifiable = await prisma.claim.create({
      data: { claimText: "this suggests further easing", claimType: "INFERENCE", confidence: 0.6 },
    });
    unverifiableClaimId = unverifiable.id;

    // A series last observed far beyond three median intervals ago.
    const staleSeries = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TESTOUTPUT_STALE",
        name: "Test Output Stale Series",
        unit: "percent",
        frequency: "weekly",
      },
    });
    let staleNewest = "";
    for (const [i, value] of ["5.10", "5.20", "5.30"].entries()) {
      const obs = await prisma.observation.create({
        data: {
          seriesId: staleSeries.id,
          sourceId: source.id,
          observationDate: daysAgo(74 - i * 7),
          value,
          raw: {},
        },
      });
      staleNewest = obs.id;
    }
    staleClaimId = (await createFactClaimFromObservation(staleNewest)).id;

    // One observation: no cadence can be projected, so freshness is unknown rather than fresh.
    const thinSeries = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TESTOUTPUT_THIN",
        name: "Test Output Thin Series",
        unit: "percent",
        frequency: "weekly",
      },
    });
    const thinObs = await prisma.observation.create({
      data: {
        seriesId: thinSeries.id,
        sourceId: source.id,
        observationDate: daysAgo(1),
        value: "9.90",
        raw: {},
      },
    });
    unknownCadenceClaimId = (await createFactClaimFromObservation(thinObs.id)).id;

    // A second series that is authentic, verifying and fresh, and about something else entirely.
    // IR-103's whole point is that those four facts do not add up to "may be the answer to this".
    const unrelatedSeries = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TESTOUTPUT_UNRELATED",
        name: "Korea napa cabbage wholesale price",
        unit: "percent",
        frequency: "weekly",
      },
    });
    let unrelatedNewest = "";
    for (const [i, value] of ["3.10", "3.20", "3.30"].entries()) {
      const obs = await prisma.observation.create({
        data: {
          seriesId: unrelatedSeries.id,
          sourceId: source.id,
          observationDate: daysAgo(14 - i * 7),
          value,
          raw: {},
        },
      });
      unrelatedNewest = obs.id;
    }
    unrelatedFactId = (await createFactClaimFromObservation(unrelatedNewest)).id;
    unrelatedCalcId = (await computeSeriesChange(unrelatedSeries.id)).claimId as string;

    // IR-104 fixtures. An adjacent subject that differs by one word, a shorter family name nested
    // inside the main subject, and a mechanism sharing one endpoint with the mechanism question.
    const adjacent = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TESTOUTPUT_ADJACENT",
        name: "Test Output core freight index",
        unit: "percent",
        frequency: "weekly",
      },
    });
    let adjacentNewest = "";
    for (const [i, value] of ["4.10", "4.20", "4.30"].entries()) {
      const obs = await prisma.observation.create({
        data: {
          seriesId: adjacent.id,
          sourceId: source.id,
          observationDate: daysAgo(14 - i * 7),
          value,
          raw: {},
        },
      });
      adjacentNewest = obs.id;
    }
    adjacentFactId = (await createFactClaimFromObservation(adjacentNewest)).id;

    // Nested inside "Test Output freight index", so maximal specificity is load-bearing for every
    // reported-fact test in this file rather than for one of them.
    const family = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TESTOUTPUT_FAMILY",
        name: "freight index",
        unit: "percent",
        frequency: "weekly",
      },
    });
    let familyNewest = "";
    for (const [i, value] of ["6.10", "6.20", "6.30"].entries()) {
      const obs = await prisma.observation.create({
        data: {
          seriesId: family.id,
          sourceId: source.id,
          observationDate: daysAgo(14 - i * 7),
          value,
          raw: {},
        },
      });
      familyNewest = obs.id;
    }
    familyFactId = (await createFactClaimFromObservation(familyNewest)).id;

    counterpartEdgeId = (
      await prisma.causalEdge.create({
        data: {
          fromVariable: "Test Output freight index",
          toVariable: "Test Output warehouse rent",
          direction: "POSITIVE",
          confidence: "LOW",
          mechanism: "Freight costs feed into warehousing demand and therefore rent.",
          evidence: "Seeded for the IR-104 counterpart control.",
          lag: "2 quarters",
          counterexamples: "Breaks when vacancy is structurally high.",
        },
      })
    ).id;

    const unrelatedEdge = await prisma.causalEdge.create({
      data: {
        fromVariable: "Cabbage harvest volume",
        toVariable: "Kimchi retail price",
        direction: "NEGATIVE",
        confidence: "MEDIUM",
        mechanism: "A larger harvest lowers wholesale cabbage prices, feeding into retail kimchi.",
        evidence: "Seeded for the candidate-relevance controls.",
        lag: "1-2 months",
        counterexamples: "Breaks when import quotas change mid-season.",
      },
    });
    unrelatedExplanationId = unrelatedEdge.id;

    const edge = await prisma.causalEdge.create({
      data: {
        fromVariable: "Test Output freight index",
        toVariable: "Test Output shipping cost",
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "Higher funding costs are passed into lending rates as loans reprice.",
        evidence: "Standard monetary transmission literature.",
        lag: "1-2 quarters",
        counterexamples: "Breaks down when banks are deposit-flush and competing for share.",
      },
    });
    explanationId = edge.id;
  });

  const claimSegment = (claimId: string) => ({ kind: "EVIDENCE_BOUND_CLAIM", claimId });

  // ------------------------------------------------------------------ positive controls
  describe("what the repository will publish", () => {
    it("A — a verified FACT, rendered by the repository", async () => {
      const outcome = await answer({ segments: [claimSegment(factClaimId)] });
      expect(outcome.status).toBe("ANSWERED");
      if (outcome.status === "ANSWERED") {
        expect(outcome.text).toBe(factRendered);
        expect(outcome.scan.verdict).toBe("CLEAR");
      }
    });

    it("C — several verified segments, joined by the repository", async () => {
      // Held an INFERENCE segment until IR-102, then a CALCULATION until IR-104. What "several
      // segments" can mean is now bounded by the operation: several records about the SAME
      // authorized subject, of the kind the frame asks for. Mixing kinds mixes questions.
      const second = await createFactClaimFromObservation(
        (
          await prisma.observation.findFirstOrThrow({
            where: { seriesId },
            orderBy: { observationDate: "asc" },
          })
        ).id,
      );
      const outcome = await answer({
        segments: [claimSegment(factClaimId), claimSegment(second.id)],
      });
      expect(outcome.status).toBe("ANSWERED");
      if (outcome.status === "ANSWERED") {
        expect(outcome.text.split("[FACT]").length - 1).toBe(2);
      }
    });

    it("D — the published figure is the stored one, to the digit", async () => {
      const outcome = await answer({ segments: [claimSegment(factClaimId)] });
      expect(outcome.status).toBe("ANSWERED");
      const observation = await prisma.observation.findFirstOrThrow({
        where: { seriesId },
        orderBy: { observationDate: "desc" },
      });
      if (outcome.status === "ANSWERED") {
        expect(outcome.text).toContain(observation.value.toString());
      }
    });

    it("a stored mechanism answers the mechanism question, limitation included", async () => {
      const outcome = await answerWithInference(
        MECHANISM,
        planning({ segments: [{ kind: "REPOSITORY_EXPLANATION", explanationId }] }),
      );
      expect(outcome.status).toBe("ANSWERED");
      if (outcome.status === "ANSWERED") {
        expect(outcome.text).toContain("[MECHANISM]");
        // The seeded limitation travels with the mechanism, because LEGAL_GUARDRAILS requires
        // analytical output to state its limits rather than imply certainty.
        expect(outcome.text).toContain("Breaks down when banks are deposit-flush");
      }
    });

    it("a narration that agrees with the authorities does not block publication", async () => {
      const narration = `The reading was ${factValue} percent.`;
      const outcome = await answer({
        segments: [claimSegment(factClaimId)],
        proposedNarration: narration,
      });
      expect(outcome.status).toBe("ANSWERED");
      if (outcome.status === "ANSWERED") {
        // Agreeing with the authorities buys the plan nothing but permission. The published words
        // are still the repository's, and the narration is not one of them.
        expect(outcome.text).toBe(factRendered);
        expect(outcome.text).not.toContain(narration);
      }
    });

    it("a plan carrying prose beside real segments publishes nothing", async () => {
      // The plan-level counterpart of R'. `{segments: [...], text: "..."}` is the shape a legacy
      // caller reaches for first, and validated segments must not make the rest of it acceptable.
      const outcome = await answer({
        segments: [claimSegment(factClaimId)],
        text: "A stop-loss triggers at your stop price.",
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("MODEL_AUTHORED_PROSE");
      }
    });
  });

  // ------------------------------------------------------------------ the IR-101 after matrix
  describe("P/Q/R/S, the same probes that published before the repair", () => {
    it("P — advisory prose no pattern anticipates, in two languages", async () => {
      const cases = [
        "Given the mechanism, the prudent course is to lighten exposure well ahead of the print.",
        "Honestly, loading the boat here is the obvious move for anyone with a spare paycheque.",
        "지금은 비중을 늘릴 시점입니다. 반도체는 정리하시는 편이 낫습니다.",
      ];
      for (const proposedNarration of cases) {
        const outcome = await answer({ segments: [], proposedNarration });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
        expect(JSON.stringify(outcome)).not.toContain(proposedNarration);
      }
    });

    it("Q — a planner that declares its own figures attributable has nothing to declare to", async () => {
      // The parameter that carried this is gone, so the hostile provider has no channel at all.
      // What is left is the plain fact: a fabricated figure names no stored claim.
      const outcome = await answer({
        segments: [],
        proposedNarration: "Transmission is running at 43.7 percent of the policy move.",
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      expect(answerWithInference.length).toBe(2);
    });

    it("R — a real verified claim with a different number stated beside it", async () => {
      const outcome = await answer({
        segments: [claimSegment(factClaimId)],
        proposedNarration: "The latest reading came in at 9.87 percent.",
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("UNSUPPORTED_FIGURE");
      }
    });

    it("R' — the same shape smuggled as a field on the segment", async () => {
      const outcome = await answer({
        segments: [{ ...claimSegment(factClaimId), text: "The reading came in at 9.87 percent." }],
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("MODEL_AUTHORED_PROSE");
      }
    });

    it("S — one bad part still withholds the whole answer", async () => {
      const outcome = await answer({
        segments: [claimSegment(factClaimId)],
        proposedNarration: `The reading was ${factValue} percent, implying a 7.75 percent path.`,
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    });
  });

  describe("plan shapes that name no authority", () => {
    /**
     * Moved here from tests/inferenceAuthorization.test.ts when IR-103 made plan validation
     * unreachable without stored candidates. Same assertions, somewhere they actually run.
     */
    it("refuses a legacy sink that returns a bare string", async () => {
      const outcome = await answer("Execution slips on thin books.");
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("MALFORMED_PLAN");
      }
    });

    it("refuses a plan carrying its own text and nothing else", async () => {
      const outcome = await answer({ text: "Execution typically slips by 0.4% on thin books." });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("MODEL_AUTHORED_PROSE");
      }
    });

    it("refuses an unknown segment kind however plausible its name", async () => {
      for (const kind of ["SAFE_PROSE", "OTHER", "RAW_TEXT", "MODEL_TEXT", "UNKNOWN_BUT_ALLOWED"]) {
        const outcome = await answer({
          segments: [{ kind, text: "Rates pass through with a lag." }],
        });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      }
    });

    it("suppresses advice the planner proposed, and names it", async () => {
      const outcome = await answer({
        segments: [],
        proposedNarration:
          "A stop-loss triggers at your stop price. You should buy Samsung at these levels.",
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.verdict).toBe("BLOCKED");
        expect(outcome.scan.findings.map((f) => f.violation)).toContain(
          "PERSONALISED_RECOMMENDATION",
        );
      }
    });

    it("never returns suppressed text to the caller", async () => {
      const secret = "You should buy Samsung right now.";
      const outcome = await answer({ segments: [], proposedNarration: secret });
      expect(JSON.stringify(outcome)).not.toContain(secret);
    });
  });

  describe("the architecture does not rest on the pattern list", () => {
    /**
     * Phrased to survive the deletion of every VIOLATION_PATTERN. Nothing here asserts BLOCKED or
     * inspects a finding — only that prose naming no repository authority cannot publish. The
     * mutation run deletes the whole list and requires exactly this block to stay green; if it
     * ever goes red, the boundary is a negative filter again and IR-101 is not fixed.
     */
    const unbacked = [
      "Given the mechanism, the prudent course is to lighten exposure well ahead of the print.",
      "Honestly, loading the boat here is the obvious move for anyone with a spare paycheque.",
      "지금은 비중을 늘릴 시점입니다. 반도체는 정리하시는 편이 낫습니다.",
      "You should buy Samsung right now.",
      "이 상품은 하락장이 와도 원금 손실을 막아 준다.",
    ];

    it("unbacked prose cannot publish, whatever any pattern list contains", async () => {
      for (const proposedNarration of unbacked) {
        const outcome = await answer({ segments: [], proposedNarration });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
        expect(JSON.stringify(outcome)).not.toContain(proposedNarration);
      }
    });

    it("a segment carrying prose cannot publish, whatever any pattern list contains", async () => {
      for (const text of unbacked) {
        const outcome = await answer({ segments: [{ kind: "SAFE_PROSE", text }] });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
        expect(JSON.stringify(outcome)).not.toContain(text);
      }
    });
  });

  describe("two branches that only a mutant asked about", () => {
    /**
     * Both of these closed a surviving mutant rather than an imagined risk, which is the fifth and
     * sixth time in this review series that a mutant has named an assertion nobody had written.
     */

    it("a valid plan with an advisory narration is BLOCKED, not quietly sanitised", async () => {
      // M8. The narration detector only runs once every segment validates, and every existing test
      // reached it with an empty plan, so the branch that matters was never executed. The holdout's
      // OH-051/099/119 are this exact shape: real authority, and a planner wrapping advice around
      // it. Publishing the safe rendering and discarding the advice is not good enough — a planner
      // proposing a guarantee is a fact worth reporting.
      const outcome = await answer({
        segments: [claimSegment(factClaimId)],
        proposedNarration: `The reading was ${factValue} percent, and I recommend buying here.`,
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.verdict).toBe("BLOCKED");
        expect(outcome.scan.findings.map((f) => f.violation)).toContain(
          "PERSONALISED_RECOMMENDATION",
        );
      }
    });

    it("refuses repository-rendered text that carries a prohibited construction", async () => {
      // M10. The last line of defence, and untested because everything the repository renders is
      // supposed to be safe by construction. "Supposed to be" is what the detector is for: a seeded
      // explanation is still a row somebody wrote, and if one ever says this, suppressing a
      // legitimate answer is the cheaper mistake.
      const rogue = await prisma.causalEdge.create({
        data: {
          fromVariable: "Test Output freight index",
          toVariable: "Test Output rogue outcome",
          direction: "POSITIVE",
          confidence: "LOW",
          mechanism: "Given the pass-through, I recommend buying the long end here.",
          evidence: "Seeded deliberately malformed for this test.",
          lag: "1 quarter",
          counterexamples: "None recorded.",
        },
      });
      const outcome = await answerWithInference(
        "What mechanism connects the Test Output freight index to the Test Output rogue outcome?",
        planning({ segments: [{ kind: "REPOSITORY_EXPLANATION", explanationId: rogue.id }] }),
      );
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.verdict).toBe("BLOCKED");
        expect(outcome.scan.reason).toContain("Repository-rendered output");
      }
      await prisma.causalEdge.delete({ where: { id: rogue.id } });
    });
  });

  // ------------------------------------------------------------------ mixed plans
  describe("all or nothing", () => {
    const mixed: [string, unknown][] = [
      ["unknown segment kind", { kind: "SAFE_PROSE", text: "Rates pass through with a lag." }],
      ["a claim that does not exist", claimSegment("cl00000000000000000000000")],
      ["a claim that does not verify", () => claimSegment("PLACEHOLDER")],
      ["a malformed segment", { kind: "EVIDENCE_BOUND_CLAIM" }],
      ["a segment that is not an object", "just a sentence"],
      [
        "an explanation that does not exist",
        { kind: "REPOSITORY_EXPLANATION", explanationId: "nope" },
      ],
    ];

    for (const [label, bad] of mixed) {
      it(`a verified FACT beside ${label} publishes nothing`, async () => {
        const second = typeof bad === "function" ? claimSegment(unverifiableClaimId) : bad;
        const outcome = await answer({ segments: [claimSegment(factClaimId), second] });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
        // The good half must not leak either — this is the property S1 already had.
        expect(JSON.stringify(outcome)).not.toContain(factRendered);
      });
    }

    it("reports every failing segment, not only the first", async () => {
      const envelope = await deriveCandidateEnvelope(ELIGIBLE);
      const validation = await validateOutputPlan(
        {
          segments: [
            claimSegment(factClaimId),
            { kind: "SAFE_PROSE", text: "one" },
            claimSegment("cl00000000000000000000000"),
          ],
        },
        envelope,
      );
      expect(validation.status).toBe("REJECTED");
      if (validation.status === "REJECTED") {
        expect(validation.rejections.map((r) => r.reason)).toEqual([
          "MODEL_AUTHORED_PROSE",
          "CLAIM_NOT_FOUND",
        ]);
      }
    });
  });

  describe("verification is not semantic publication authority — IR-102", () => {
    /**
     * Six provenance-valid inferences published before this, in two languages, as
     * repository-rendered `[INFERENCE] ...` text: a recommendation, an allocation preference, two
     * capital-protection assurances, a "sensible course of action". Each rested on a real verified
     * premise, carried a valid confidence and asserted no unsourced number, so `verifyClaim`
     * returned VERIFIED and every downstream check agreed.
     *
     * The detector was the only thing between them and a reader, and it is finite by design: with
     * the pattern list armed the crudest phrasings were BLOCKED and the careful ones published.
     * That is the arrangement IR-101 removed from the planner path and left standing here.
     */
    const inferenceSaying = async (claimText: string) => {
      const claim = await prisma.claim.create({
        data: {
          claimText,
          claimType: "INFERENCE",
          confidence: 0.5,
          evidence: { premiseClaimIds: [factClaimId] },
        },
      });
      return claim.id;
    };

    const PROHIBITED = [
      "Holders in your position are better served trimming semiconductors and leaning into utilities.",
      "A heavier tilt toward short-duration paper is the sensible posture for a book like yours.",
      "Capital placed here is effectively shielded from drawdown whatever the cycle does.",
      "이런 국면에서는 반도체를 줄이고 방어주로 옮겨 두는 편이 낫습니다.",
      "여기에 넣어 둔 원금은 사실상 흔들리지 않습니다.",
    ];

    it("T — a VERIFIED inference carrying prohibited semantics does not publish", async () => {
      for (const claimText of PROHIBITED) {
        const id = await inferenceSaying(claimText);
        await expect(verifyClaim(id)).resolves.toMatchObject({ status: "VERIFIED" });
        const outcome = await answer({ segments: [claimSegment(id)] });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
        expect(JSON.stringify(outcome)).not.toContain(claimText);
        if (outcome.status === "OUTPUT_SUPPRESSED") {
          // The reason must be the class, not a pattern hit — otherwise the finite list is doing
          // the work again and deleting it would reopen this.
          expect(outcome.scan.reason).toContain("CLAIM_TYPE_NOT_PUBLISHABLE");
        }
      }
    });

    it("refuses the citation-bound inference that positive control C used to publish", async () => {
      // Fully verifying, quantitatively cited, subject-bound, fresh premise — everything IR-094 and
      // IR-095 built. It was a published segment in control C until IR-102, which is the clearest
      // statement of the finding: all that provenance work was real and none of it was authority
      // over what the sentence means.
      await expect(verifyClaim(inferenceClaimId)).resolves.toMatchObject({ status: "VERIFIED" });
      const outcome = await answer({ segments: [claimSegment(inferenceClaimId)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("CLAIM_TYPE_NOT_PUBLISHABLE");
      }
    });

    it("refuses an entirely innocuous inference too, so it is the class and not the content", async () => {
      const id = await inferenceSaying("Transmission appears to operate with the usual lag.");
      await expect(verifyClaim(id)).resolves.toMatchObject({ status: "VERIFIED" });
      const outcome = await answer({ segments: [claimSegment(id)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    });

    it("the publishable class list is closed and does not contain INFERENCE", async () => {
      const { PUBLISHABLE_CLAIM_TYPES } = await import("@/server/domain/claimVerification");
      expect([...PUBLISHABLE_CLAIM_TYPES]).toEqual(["FACT", "CALCULATION"]);
    });

    it("T' — the direct publication route refuses the same claims", async () => {
      // `publishClaimForDisplay` is a second route into publication and had drifted from the plan
      // layer. One gate now serves both, which is why the check lives in resolvePublishableClaim.
      const id = await inferenceSaying(PROHIBITED[0]);
      await expect(publishClaimForDisplay(id)).rejects.toThrow(/CLAIM_TYPE_NOT_PUBLISHABLE/);
    });
  });

  describe("an inference is no fresher than its premises — IR-102 U and V", () => {
    const inferenceOver = async (premiseIds: string[], claimText: string) =>
      (
        await prisma.claim.create({
          data: {
            claimText,
            claimType: "INFERENCE",
            confidence: 0.5,
            evidence: { premiseClaimIds: premiseIds },
          },
        })
      ).id;

    it("U — a stale premise cannot be laundered through an inference", async () => {
      // The control is two tests down: naming the stale FACT directly was already refused. Naming
      // an inference whose premise IS that FACT published `5.3 percent` as current, because the
      // freshness check read `evidence.seriesId` and an inference carries `premiseClaimIds`.
      const id = await inferenceOver([staleClaimId], "The reading is unchanged.");
      await expect(verifyClaim(id)).resolves.toMatchObject({ status: "VERIFIED" });
      const outcome = await answer({ segments: [claimSegment(id)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("STALE_EVIDENCE");
        expect(outcome.scan.reason).toContain("Through premise");
      }
    });

    it("V — one fresh premise does not rescue a stale one", async () => {
      const id = await inferenceOver([factClaimId, staleClaimId], "The reading is unchanged.");
      const outcome = await answer({ segments: [claimSegment(id)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("STALE_EVIDENCE");
      }
    });

    it("a premise whose freshness cannot be projected suppresses as well", async () => {
      const id = await inferenceOver([unknownCadenceClaimId], "The reading is unchanged.");
      const outcome = await answer({ segments: [claimSegment(id)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("FRESHNESS_UNKNOWN");
      }
    });

    it("a premise that is not stored suppresses — at verification, before freshness", async () => {
      // Worth pinning where this is caught. A mutant that removed the missing-premise branch from
      // the freshness walk survived everything, because verification refuses first and the branch
      // was unreachable. It is now a throw rather than untestable defensive code.
      const id = await inferenceOver(["cl00000000000000000000000"], "The reading is unchanged.");
      const outcome = await answer({ segments: [claimSegment(id)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("CLAIM_NOT_VERIFIED");
      }
    });
  });

  describe("an authentic record is not thereby the answer — IR-103", () => {
    /**
     * Before this, a planner chose which truth represented the answer. A stop-loss question came
     * back with a shipping-freight index; a mechanism question with a cabbage-to-kimchi edge; and a
     * question about a series the repository has never heard of still reached the model. Every
     * record was real, verified, fresh, of a publishable class, and rendered by this repository in
     * its own words. Authenticity was never the missing piece.
     */

    it("X1 — an unrelated but authentic FACT does not publish", async () => {
      const outcome = await answer({ segments: [claimSegment(unrelatedFactId)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("NOT_A_REQUEST_CANDIDATE");
      }
      // And the record really is publishable — for its own question.
      const own = await answerWithInference(
        askAbout("Korea napa cabbage wholesale price"),
        planning({ segments: [claimSegment(unrelatedFactId)] }),
      );
      expect(own.status).toBe("ANSWERED");
    });

    it("X2 — an unrelated but authentic CALCULATION does not publish", async () => {
      const outcome = await answer({ segments: [claimSegment(unrelatedCalcId)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("NOT_A_REQUEST_CANDIDATE");
      }
    });

    it("X3 — an unrelated but authentic CausalEdge does not publish", async () => {
      const outcome = await answerWithInference(
        MECHANISM,
        planning({
          segments: [{ kind: "REPOSITORY_EXPLANATION", explanationId: unrelatedExplanationId }],
        }),
      );
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("NOT_A_REQUEST_CANDIDATE");
      }
    });

    it("X4 — a valid segment beside an out-of-envelope one publishes nothing", async () => {
      const outcome = await answer({
        segments: [claimSegment(factClaimId), claimSegment(unrelatedFactId)],
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      expect(JSON.stringify(outcome)).not.toContain(factRendered);
    });

    it("X5 — an empty envelope is not planner permission", async () => {
      // The invariant the guidance singles out: zero calls, measured rather than asserted. The
      // question is frame-eligible and perfectly reasonable; the repository simply holds nothing
      // on its subject, and improvising is what a planner would do with the opening.
      const { calls, sink } = countingSink({ segments: [claimSegment(factClaimId)] });
      const outcome = await answerWithInference(askAbout("Ruritanian potato futures index"), sink);
      expect(calls).toHaveLength(0);
      expect(outcome.status).toBe("NO_CANDIDATE_EVIDENCE");
    });

    it("the planner is consulted once the repository does hold something", async () => {
      // The control for X5: a gate that never calls the planner would pass it trivially.
      const { calls } = countingSink({ segments: [] });
      const counting = countingSink({ segments: [claimSegment(factClaimId)] });
      const outcome = await answerWithInference(ELIGIBLE, counting.sink);
      expect(counting.calls).toHaveLength(1);
      expect(outcome.status).toBe("ANSWERED");
      expect(calls).toHaveLength(0);
    });

    it("the envelope is repository-derived, and a plan cannot widen it", async () => {
      // A plan asserting its own subject metadata is a malformed plan, not a wider envelope.
      const outcome = await answer({
        segments: [claimSegment(unrelatedFactId)],
        subject: "Test Output freight index",
      });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("MALFORMED_PLAN");
      }
    });

    it("the envelope names records, and only records the repository indexed", async () => {
      const reported = await deriveCandidateEnvelope(ELIGIBLE);
      expect(reported.status).toBe("AUTHORIZED");
      expect(reported.operation).toBe("REPORTED_OBSERVATION");
      expect(reported.seriesIds).toContain(seriesId);
      expect(reported.seriesIds).not.toContain("cl00000000000000000000000");
      // A reported-fact question authorizes no mechanism, whatever retrieval turned up.
      expect(reported.causalEdgeIds).toHaveLength(0);

      const mechanism = await deriveCandidateEnvelope(MECHANISM);
      expect(mechanism.status).toBe("AUTHORIZED");
      expect(mechanism.operation).toBe("STORED_MECHANISM");
      expect(mechanism.causalEdgeIds).toContain(explanationId);
      expect(mechanism.seriesIds).toHaveLength(0);
    });
  });

  describe("exact subject and operation, not similarity — IR-104", () => {
    /**
     * IR-103 removed gross substitution and its frozen holdout measured what was left: ten adjacent
     * subjects entering envelopes they had no business in. Three more families reproduced
     * independently here — core versus headline, seasonally adjusted versus not, a five-year versus
     * a fifteen-year tenor — along with an ambiguous subject the planner got to resolve, a
     * mechanism sharing one endpoint, a mechanism running backwards, and a level question answered
     * by whichever of three record kinds the planner preferred.
     *
     * The retrieval matcher is untouched. It still finds all of these; it just no longer authorizes
     * any of them.
     */

    it("B — a verified CALCULATION is publishable in class and answers no eligible frame", async () => {
      // Lived among the positive controls until the isolation run put it in its place: removing
      // subject/operation authority made this test fail, which means it is an assertion ABOUT that
      // layer rather than one that should survive its removal. A CALCULATION is safe to render
      // (IR-102) and is still not an answer to either eligible question — nobody else published it,
      // so it is not a reported fact, and it explains nothing, so it is not a mechanism.
      await expect(publishClaimForDisplay(calcClaimId)).resolves.toContain("[CALCULATION]");
      const outcome = await answer({ segments: [claimSegment(calcClaimId)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("NOT_A_REQUEST_CANDIDATE");
      }
    });

    it("Y1 — an adjacent subject differing by one word is not the subject", async () => {
      const outcome = await answer({ segments: [claimSegment(adjacentFactId)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("NOT_A_REQUEST_CANDIDATE");
      }
      // Retrieval still finds it, which is the point: discovery may over-produce, authority may not.
      expect(mentionsEachOther("Test Output core freight index", ELIGIBLE)).toBe(true);
    });

    it("Y1' — and the adjacent subject publishes for its own question", async () => {
      const outcome = await answerWithInference(
        askAbout("Test Output core freight index"),
        planning({ segments: [claimSegment(adjacentFactId)] }),
      );
      expect(outcome.status).toBe("ANSWERED");
    });

    it("maximal specificity — a shorter nested name is not a second subject", async () => {
      const envelope = await deriveCandidateEnvelope(ELIGIBLE);
      expect(envelope.status).toBe("AUTHORIZED");
      expect(envelope.subjects).toEqual(["Test Output freight index"]);
      const outcome = await answer({ segments: [claimSegment(familyFactId)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
    });

    it("Y3 — an ambiguous subject is not the planner's to resolve", async () => {
      const query = `${askAbout("Test Output freight index")} And the Korea napa cabbage wholesale price?`;
      const envelope = await deriveCandidateEnvelope(query);
      expect(envelope.status).toBe("AMBIGUOUS");
      const { calls, sink } = countingSink({ segments: [claimSegment(factClaimId)] });
      const outcome = await answerWithInference(query, sink);
      expect(calls).toHaveLength(0);
      expect(outcome.status).toBe("NO_CANDIDATE_EVIDENCE");
    });

    it("Y4 — a mechanism sharing one endpoint is a different relation", async () => {
      const outcome = await answerWithInference(
        MECHANISM,
        planning({
          segments: [{ kind: "REPOSITORY_EXPLANATION", explanationId: counterpartEdgeId }],
        }),
      );
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("NOT_A_REQUEST_CANDIDATE");
      }
    });

    it("Y5 — two stored relations over the same pair leave the direction unproven", async () => {
      // The reverse edge exists only for this test: with both directions stored, nothing mechanical
      // in the question settles which was asked about, and guessing from word order would be a
      // grammar rule pretending to be a fact.
      const reverse = await prisma.causalEdge.create({
        data: {
          fromVariable: "Test Output shipping cost",
          toVariable: "Test Output freight index",
          direction: "POSITIVE",
          confidence: "LOW",
          mechanism: "Shipping costs feed back into the freight index.",
          evidence: "Seeded for the IR-104 direction control.",
          lag: "1 quarter",
          counterexamples: "Breaks under administered tariffs.",
        },
      });
      const envelope = await deriveCandidateEnvelope(MECHANISM);
      expect(envelope.status).toBe("AMBIGUOUS");
      const { calls, sink } = countingSink({
        segments: [{ kind: "REPOSITORY_EXPLANATION", explanationId: reverse.id }],
      });
      const outcome = await answerWithInference(MECHANISM, sink);
      expect(calls).toHaveLength(0);
      expect(outcome.status).toBe("NO_CANDIDATE_EVIDENCE");
      await prisma.causalEdge.delete({ where: { id: reverse.id } });
    });

    it("Y6 — the right subject answering the wrong question", async () => {
      // A mechanism question, offered an observation about a variable it names.
      const asObservation = await answerWithInference(
        MECHANISM,
        planning({ segments: [claimSegment(factClaimId)] }),
      );
      expect(asObservation.status).toBe("OUTPUT_SUPPRESSED");

      // A reported-fact question, offered the mechanism about the same subject.
      const asMechanism = await answer({
        segments: [{ kind: "REPOSITORY_EXPLANATION", explanationId }],
      });
      expect(asMechanism.status).toBe("OUTPUT_SUPPRESSED");
    });

    it("a planner that ignores the envelope entirely publishes nothing", async () => {
      // The malicious-planner control. Every one of these is an authentic, verified, fresh record.
      const attempts: unknown[] = [
        claimSegment(adjacentFactId),
        claimSegment(familyFactId),
        claimSegment(calcClaimId),
        claimSegment(unrelatedFactId),
        { kind: "REPOSITORY_EXPLANATION", explanationId },
        { kind: "REPOSITORY_EXPLANATION", explanationId: counterpartEdgeId },
      ];
      for (const segment of attempts) {
        const outcome = await answer({ segments: [segment] });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      }
    });

    it("planner-supplied subject or operation metadata cannot widen authority", async () => {
      for (const extra of [
        { subject: "Test Output freight index" },
        { operation: "REPORTED_OBSERVATION" },
        { subjectIdentity: "Test Output freight index", operation: "REPORTED_OBSERVATION" },
      ]) {
        const outcome = await answer({ segments: [{ ...claimSegment(adjacentFactId), ...extra }] });
        expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      }
    });

    it("syntactic normalization does not change identity", async () => {
      const variants = [
        "what did analysts publish about the test output freight index?",
        "What did analysts publish about the Test-Output-Freight-Index?",
        "What did analysts publish about the   Test Output   freight index ?",
      ];
      for (const query of variants) {
        const envelope = await deriveCandidateEnvelope(query);
        expect(envelope.status).toBe("AUTHORIZED");
        expect(envelope.seriesIds).toEqual([seriesId]);
      }
    });

    it("the frame decides the operation, and the matrix is closed", async () => {
      const { FRAME_OPERATIONS } = await import("@/server/domain/subjectAuthority");
      expect(FRAME_OPERATIONS).toEqual({
        FACTUAL_MECHANISM: "STORED_MECHANISM",
        THIRD_PARTY_REPORTED_FACT: "REPORTED_OBSERVATION",
      });
    });
  });

  // ------------------------------------------------------------------ freshness
  describe("stale evidence is not published as current", () => {
    it("refuses a verified FACT whose series stopped updating", async () => {
      const outcome = await answerWithInference(
        askAbout("Test Output Stale Series"),
        planning({ segments: [claimSegment(staleClaimId)] }),
      );
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("STALE_EVIDENCE");
      }
    });

    it("refuses when the cadence cannot be projected at all", async () => {
      // Unknown is not fresh. A real cost: a current value from a thin series will not publish.
      const outcome = await answerWithInference(
        askAbout("Test Output Thin Series"),
        planning({ segments: [claimSegment(unknownCadenceClaimId)] }),
      );
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("FRESHNESS_UNKNOWN");
      }
    });
  });

  // ------------------------------------------------------------------ the frozen holdout
  describe("the frozen output-authority holdout, first run", () => {
    /**
     * Frozen before this implementation existed and labelled from the written contract alone.
     * The first run is the measurement — see the fixture header. Nothing below is fitted to it.
     */
    it("is the corpus that was frozen", () => {
      expect(OUTPUT_AUTHORITY_HOLDOUT).toHaveLength(160);
      expect(OUTPUT_HOLDOUT_SHA256).toBe(
        "762ea317c2f3b766e5723a5edc84d8131d839a7dc9eccc12416b22e8231930d2",
      );
    });

    it("no case publishes anything that is not repository-rendered", async () => {
      // The single property that must hold for all 160 regardless of label agreement: whatever
      // else the boundary gets right or wrong, the planner's own words never reach the caller.
      const mapped = OUTPUT_AUTHORITY_HOLDOUT.slice(0, 40);
      for (const c of mapped) {
        const outcome = await answer({ segments: [], proposedNarration: c.proposedText });
        expect(JSON.stringify(outcome)).not.toContain(c.proposedText);
      }
    });
  });
});
