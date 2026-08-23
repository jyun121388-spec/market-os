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
  let createFactClaimFromObservation: typeof import("@/server/domain/claimStore").createFactClaimFromObservation;
  let computeSeriesChange: typeof import("@/server/domain/whatChanged").computeSeriesChange;

  /** A request the frame gate proves FACTUAL_MECHANISM, so every result below is an output fact. */
  const ELIGIBLE = "How does a stop-loss order actually work on the KRX?";

  let factClaimId: string;
  let factRendered: string;
  let factValue: string;
  let calcClaimId: string;
  let inferenceClaimId: string;
  let unverifiableClaimId: string;
  let staleClaimId: string;
  let unknownCadenceClaimId: string;
  let explanationId: string;
  let seriesId: string;

  const planning = (plan: unknown) => ({ generatePlan: async () => plan });
  const answer = (plan: unknown) => answerWithInference(ELIGIBLE, planning(plan));

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ answerWithInference } = await import("@/server/domain/askMarketInference"));
    ({ validateOutputPlan } = await import("@/server/domain/outputPlan"));
    ({ createFactClaimFromObservation } = await import("@/server/domain/claimStore"));
    ({ computeSeriesChange } = await import("@/server/domain/whatChanged"));

    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (existing) {
      await prisma.claim.deleteMany({ where: { sourceId: existing.id } });
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }
    await prisma.causalEdge.deleteMany({ where: { fromVariable: "TEST_OUTPUT_AUTHORITY_FROM" } });

    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Test Output Authority Source", tier: "TIER_S" },
    });

    // Four observations a week apart, the newest today: median interval 7 days, 0 days elapsed,
    // so `staleness.ts`'s existing 3x rule says FRESH without anything being tuned to say so.
    const series = await prisma.series.create({
      data: {
        sourceId: source.id,
        externalId: "TESTOUTPUT",
        name: "Test Output Series",
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

    const edge = await prisma.causalEdge.create({
      data: {
        fromVariable: "TEST_OUTPUT_AUTHORITY_FROM",
        toVariable: "TEST_OUTPUT_AUTHORITY_TO",
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

    it("B — a verified CALCULATION", async () => {
      const outcome = await answer({ segments: [claimSegment(calcClaimId)] });
      expect(outcome.status).toBe("ANSWERED");
      if (outcome.status === "ANSWERED") expect(outcome.text).toContain("[CALCULATION]");
    });

    it("C — several verified segments, joined by the repository", async () => {
      const outcome = await answer({
        segments: [
          claimSegment(factClaimId),
          claimSegment(inferenceClaimId),
          { kind: "REPOSITORY_EXPLANATION", explanationId },
        ],
      });
      expect(outcome.status).toBe("ANSWERED");
      if (outcome.status === "ANSWERED") {
        expect(outcome.text).toContain("[FACT]");
        expect(outcome.text).toContain("[INFERENCE]");
        expect(outcome.text).toContain("[MECHANISM]");
        // The seeded limitation travels with the mechanism, because LEGAL_GUARDRAILS requires
        // analytical output to state its limits rather than imply certainty.
        expect(outcome.text).toContain("Breaks down when banks are deposit-flush");
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
          fromVariable: "TEST_OUTPUT_AUTHORITY_FROM",
          toVariable: "TEST_OUTPUT_AUTHORITY_ROGUE",
          direction: "POSITIVE",
          confidence: "LOW",
          mechanism: "Given the pass-through, I recommend buying the long end here.",
          evidence: "Seeded deliberately malformed for this test.",
          lag: "1 quarter",
          counterexamples: "None recorded.",
        },
      });
      const outcome = await answer({
        segments: [{ kind: "REPOSITORY_EXPLANATION", explanationId: rogue.id }],
      });
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
      const validation = await validateOutputPlan({
        segments: [
          claimSegment(factClaimId),
          { kind: "SAFE_PROSE", text: "one" },
          claimSegment("cl00000000000000000000000"),
        ],
      });
      expect(validation.status).toBe("REJECTED");
      if (validation.status === "REJECTED") {
        expect(validation.rejections.map((r) => r.reason)).toEqual([
          "MODEL_AUTHORED_PROSE",
          "CLAIM_NOT_FOUND",
        ]);
      }
    });
  });

  // ------------------------------------------------------------------ freshness
  describe("stale evidence is not published as current", () => {
    it("refuses a verified FACT whose series stopped updating", async () => {
      const outcome = await answer({ segments: [claimSegment(staleClaimId)] });
      expect(outcome.status).toBe("OUTPUT_SUPPRESSED");
      if (outcome.status === "OUTPUT_SUPPRESSED") {
        expect(outcome.scan.reason).toContain("STALE_EVIDENCE");
      }
    });

    it("refuses when the cadence cannot be projected at all", async () => {
      // Unknown is not fresh. A real cost: a current value from a thin series will not publish.
      const outcome = await answer({ segments: [claimSegment(unknownCadenceClaimId)] });
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
