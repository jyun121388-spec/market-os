import { describe, expect, it, beforeAll } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_CANONICAL_CANDIDATE";

/**
 * Does candidate authority obey the canonical parse, or the words it was parsed from?
 *
 * IR-107 Unit 2 Phase B2. `authorizeInference` resolved the canonical request authority and threw
 * it away; `deriveCandidateEnvelope(query)` then worked out afresh what the request meant, through
 * a legacy frame classifier and a second relation parser. Fourteen sites in all. One sentence, two
 * parsers, and the lower one winning because it is the one holding the records.
 *
 * Every test here is an AUTHORITY-PRECEDENCE probe, and each is built the same way: the raw text
 * says one thing, the supplied canonical request says another, and the envelope must follow the
 * request. That is deliberately not a production scenario — production supplies the parse OF that
 * text. It is the only construction that can tell "consumes the carry" apart from "happens to agree
 * with it", and agreement is what every ordinary test would have measured.
 *
 * They need a real database because the question is which STORED records come back.
 */
describeIfDb("canonical candidate authority (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let deriveCanonicalCandidateEnvelope: typeof import("@/server/domain/candidateEnvelope").deriveCanonicalCandidateEnvelope;
  let deriveLegacyCandidateEnvelope: typeof import("@/server/domain/candidateEnvelope").deriveLegacyCandidateEnvelope;
  let answerWithInference: typeof import("@/server/domain/askMarketInference").answerWithInference;
  let resolveRequestAuthority: typeof import("@/server/domain/requestAuthority").resolveRequestAuthority;
  let asPlannerRequest: typeof import("@/server/domain/requestAuthority").asPlannerRequest;

  // These requests name `PUBLISHER`, which this fixture stores as a `Source`, because IR-107
  // B2-C binds an attributed observation to exactly one stored provider. They used to say
  // `analysts`, and a generic term naming no stored provider now refuses -- the subject-identity
  // semantics these tests are actually about are unchanged by which provider is named.
  const SUBJECT_A = "TEST Canonical Alpha Index";
  const SUBJECT_B = "TEST Canonical Beta Index";
  /** A Korean-named subject, to exercise the WHOLE_REGION identity mode through this path. */
  const SUBJECT_KO = "정책금리";
  /**
   * A stored subject whose name sits in the SOURCE slot of the probe query, not the subject slot.
   *
   * "Consensus" is deliberate: it is one of the closed reporting-source words the legacy frame
   * classifier recognises, so the probe query is frame-eligible and actually reaches candidate
   * derivation. Without that the request is refused before either door and discriminates nothing —
   * which is what the first version of this fixture did.
   */
  const PUBLISHER = "TEST Canonical Consensus";
  const CAUSE_A = "TEST Canonical Cause Alpha";
  const EFFECT_B = "TEST Canonical Effect Beta";
  const CAUSE_C = "TEST Canonical Cause Gamma";
  const EFFECT_D = "TEST Canonical Effect Delta";

  let seriesA = "";
  let seriesB = "";
  let edgeAB = "";

  /**
   * Builds a canonical request by PARSING a sentence that means what the test wants, then attaching
   * it to a different audit query.
   *
   * Not hand-written: a literal object would let the test assert against a parse the parser cannot
   * actually produce, and the whole point is that this is the parser's own output travelling.
   */
  function canonicalFrom(sentence: string) {
    const authority = resolveRequestAuthority(sentence);
    if (authority.status !== "AUTHORIZED") {
      throw new Error(`fixture sentence did not parse: ${sentence} => ${authority.status}`);
    }
    const planner = asPlannerRequest(authority);
    if (planner === null) {
      throw new Error(`fixture sentence is not planner-permitted: ${sentence}`);
    }
    return planner;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ deriveCanonicalCandidateEnvelope, deriveLegacyCandidateEnvelope } =
      await import("@/server/domain/candidateEnvelope"));
    ({ answerWithInference } = await import("@/server/domain/askMarketInference"));
    ({ resolveRequestAuthority, asPlannerRequest } =
      await import("@/server/domain/requestAuthority"));

    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (existing) {
      await prisma.observation.deleteMany({ where: { sourceId: existing.id } });
      await prisma.series.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }
    await prisma.causalEdge.deleteMany({
      where: { fromVariable: { in: [CAUSE_A, CAUSE_C] } },
    });

    const source = await prisma.source.create({
      // Named to carry third-party vocabulary on purpose. IR-107 B2-C binds an attributed request
      // to exactly one stored `Source`, and `authorizeInference` only admits the third-party frame
      // when the request carries that vocabulary -- so a provider a frame-eligible request can name
      // must read like a research house. `TEST Canonical Consensus` is both: the name of this
      // provider AND, separately, a stored series, which is what the routing test below needs.
      data: { code: SOURCE_CODE, name: PUBLISHER, tier: "TIER_S" },
    });
    const made: string[] = [];
    for (const [index, name] of [SUBJECT_A, SUBJECT_B, SUBJECT_KO, PUBLISHER].entries()) {
      const series = await prisma.series.create({
        data: {
          sourceId: source.id,
          externalId: `TEST_CANONICAL_${index}`,
          name,
          unit: "index",
          frequency: "daily",
        },
      });
      made.push(series.id);
    }
    [seriesA, seriesB] = made;

    const ab = await prisma.causalEdge.create({
      data: {
        fromVariable: CAUSE_A,
        toVariable: EFFECT_B,
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "test transmission mechanism",
        evidence: "test fixture",
        lag: "1 quarter",
        counterexamples: "test fixture has no real counterexample",
      },
    });
    edgeAB = ab.id;
    await prisma.causalEdge.create({
      data: {
        fromVariable: CAUSE_C,
        toVariable: EFFECT_D,
        direction: "POSITIVE",
        confidence: "MEDIUM",
        mechanism: "test transmission mechanism",
        evidence: "test fixture",
        lag: "1 quarter",
        counterexamples: "test fixture has no real counterexample",
      },
    });
  });

  it("resolves the subject the canonical request names, not the one the text names", async () => {
    // Both subjects are stored and both are individually resolvable, so a failure here cannot be
    // "the other one was not found". The audit text names B; the carried parse names A.
    {
      const request = canonicalFrom(`What did ${PUBLISHER} publish about ${SUBJECT_A}?`);
      const envelope = await deriveCanonicalCandidateEnvelope(
        `What did ${PUBLISHER} publish about ${SUBJECT_B}?`,
        request,
      );
      expect(envelope.status).toBe("AUTHORIZED");
      expect(envelope.seriesIds).toEqual([seriesA]);
      expect(envelope.seriesIds).not.toContain(seriesB);
      // And the text is still carried, because the planner is given prose to read.
      expect(envelope.query).toContain(SUBJECT_B);
    }
  });

  it("obeys the identity mode the canonical parse declared, not one it re-derives", async () => {
    // B1 established OCCURRENCE and WHOLE_REGION as materially different, against a served wrong
    // answer: `USD-KRW는` normalizes its hyphen to a space, `KRW` occurs as a whole token, and the
    // question about the pair came back answered with one leg. The mode has to survive into
    // candidate resolution or that repair stops at the deterministic path.
    //
    // Proving it needs a synthetic request, and the reason is worth recording rather than working
    // around: NO Korean parse can reach this path today. Korean recognises only DEFINITION and
    // CURRENT_OBSERVATION, both `plannerPermitted: false`, so every WHOLE_REGION parse is refused
    // by `asPlannerRequest` before candidate derivation. The mode is carried, is consumed by
    // `resolveStoredSubject`, and is currently unreachable from any real inference request.
    //
    // So this overrides ONE field of a real parse — the same shape as the mismatch probes above —
    // rather than hand-building an authority the parser cannot produce.
    const base = canonicalFrom(`What did ${PUBLISHER} publish about ${SUBJECT_A}?`);
    expect(base.subjectIdentity).toBe("OCCURRENCE");

    // Under OCCURRENCE a stored name found INSIDE a longer region resolves; under WHOLE_REGION it
    // must not, because a one-morpheme region has no interior.
    const region = ` prefixed ${SUBJECT_A} `;
    const occurrence = await deriveCanonicalCandidateEnvelope("audit text", {
      ...base,
      subjectRegion: region,
      subjectIdentity: "OCCURRENCE",
    });
    expect(occurrence.status).toBe("AUTHORIZED");
    expect(occurrence.seriesIds).toEqual([seriesA]);

    const wholeRegion = await deriveCanonicalCandidateEnvelope("audit text", {
      ...base,
      subjectRegion: region,
      subjectIdentity: "WHOLE_REGION",
    });
    expect(wholeRegion.status).toBe("UNRESOLVED");
    expect(wholeRegion.seriesIds).toHaveLength(0);

    // And the mode is not decorative on the parses that do carry it.
    const korean = resolveRequestAuthority(`${SUBJECT_KO}는 무엇인가요?`);
    expect(korean.status).toBe("AUTHORIZED");
    if (korean.status !== "AUTHORIZED") return;
    expect(korean.subjectIdentity).toBe("WHOLE_REGION");
    // Refused before candidate derivation, which is why the override above was necessary.
    expect(asPlannerRequest(korean)).toBeNull();
  });

  it("resolves the mechanism the canonical regions name, not the one the text names", async () => {
    // Two stored edges over four distinct variables. The audit text describes C -> D; the carried
    // parse describes A -> B. Anything that re-reads the sentence returns the wrong edge, and
    // anything that matches an unordered pair returns both.
    const request = canonicalFrom(`Explain how ${CAUSE_A} affects ${EFFECT_B}.`);
    const envelope = await deriveCanonicalCandidateEnvelope(
      `Explain how ${CAUSE_C} affects ${EFFECT_D}.`,
      request,
    );
    expect(envelope.status).toBe("AUTHORIZED");
    expect(envelope.causalEdgeIds).toEqual([edgeAB]);
    expect(envelope.subjects).toEqual([CAUSE_A, EFFECT_B]);
  });

  it("refuses a mechanism whose cause region carries an unread qualifier", async () => {
    // The regression this branch introduced and existing tests caught within a minute. The
    // canonical parser reads `relationSyntax` polarity, which looks for a negation MARKER, and
    // IR-106 added the well-formedness rule precisely because a denylist of denials cannot be
    // finished. So this parses as AFFIRMED, arrives as a canonical parse, and without the check
    // resolves the stored A -> B edge and answers the opposite of what was asked.
    const denial = resolveRequestAuthority(
      `Explain how it is false that ${CAUSE_A} affects ${EFFECT_B}.`,
    );
    expect(denial.status).toBe("AUTHORIZED");
    if (denial.status !== "AUTHORIZED") return;
    const request = asPlannerRequest(denial);
    expect(request).not.toBeNull();
    if (request === null) return;

    const envelope = await deriveCanonicalCandidateEnvelope(
      `Explain how it is false that ${CAUSE_A} affects ${EFFECT_B}.`,
      request,
    );
    expect(envelope.status).toBe("UNRESOLVED");
    expect(envelope.causalEdgeIds).toHaveLength(0);
  });

  it("still authorizes the affirmative form, so the refusal above is not blanket", async () => {
    const request = canonicalFrom(`Explain how ${CAUSE_A} affects ${EFFECT_B}.`);
    const envelope = await deriveCanonicalCandidateEnvelope(
      `Explain how ${CAUSE_A} affects ${EFFECT_B}.`,
      request,
    );
    expect(envelope.status).toBe("AUTHORIZED");
    expect(envelope.causalEdgeIds).toEqual([edgeAB]);
  });

  it("refuses rather than choosing when the canonical region names no stored subject", async () => {
    const request = canonicalFrom("What did analysts publish about TEST Canonical Nothing At All?");
    const envelope = await deriveCanonicalCandidateEnvelope(
      `What did ${PUBLISHER} publish about ${SUBJECT_A}?`,
      request,
    );
    // UNRESOLVED because the AUTHORIZED region names nothing — not because the audit text was
    // consulted and happened to name something else.
    expect(envelope.status).toBe("UNRESOLVED");
    expect(envelope.seriesIds).toHaveLength(0);
  });

  it("refuses a mechanism whose EFFECT region carries an unread condition", async () => {
    // The cause-side check was in and the effect side was not, which adversarial review found. The
    // parser returns everything after the verb as the effect region, so this carries
    // `effectRegion = "<B> only if something else"`. Finding B inside that and authorizing A -> B
    // answers an UNCONDITIONAL question when a conditional one was asked — the denial's mirror
    // image, on the other side of the verb.
    for (const suffix of ["only if something else", "unless rates fall"]) {
      const query = `Explain how ${CAUSE_A} affects ${EFFECT_B} ${suffix}.`;
      const authority = resolveRequestAuthority(query);
      expect(authority.status, query).toBe("AUTHORIZED");
      if (authority.status !== "AUTHORIZED") continue;
      const request = asPlannerRequest(authority);
      expect(request, query).not.toBeNull();
      if (request === null) continue;
      const envelope = await deriveCanonicalCandidateEnvelope(query, request);
      expect(envelope.status, query).toBe("UNRESOLVED");
      expect(envelope.causalEdgeIds, query).toHaveLength(0);
    }
  });

  it("applies the qualifier rule through the production door, not only the helper", async () => {
    // Finding 11: only ROUTING was proven end to end; every other canonical decision was
    // helper-only, which is the same gap that let the routing mutant survive in the first place.
    // A wrapper that kept routing intact while skipping qualifier validation would have passed.
    const calls: string[] = [];
    const sink = {
      generatePlan: async (q: string) => {
        calls.push(q);
        return { segments: [] };
      },
    };
    const denial = `Explain how it is false that ${CAUSE_A} affects ${EFFECT_B}.`;
    const outcome = await answerWithInference(denial, sink);
    expect(outcome.status).toBe("NO_CANDIDATE_EVIDENCE");
    expect(calls).toHaveLength(0);

    // And the affirmative form of the same relation DOES reach the planner, so the refusal above
    // is the qualifier and not the path being dead.
    const affirmative = `Explain how ${CAUSE_A} affects ${EFFECT_B}.`;
    const ok = await answerWithInference(affirmative, sink);
    expect(calls).toHaveLength(1);
    expect(ok.status).not.toBe("NO_CANDIDATE_EVIDENCE");
  });

  it("applies the EFFECT-side qualifier rule through the production door", async () => {
    // Control D. The cause-side qualifier was already proven end to end; the effect side was the
    // hole adversarial review found, so it needs the same production-path proof rather than a
    // helper assertion. A conditional relation must not reach the planner as an unconditional one.
    const calls: string[] = [];
    const sink = {
      generatePlan: async (q: string) => {
        calls.push(q);
        return { segments: [] };
      },
    };
    for (const suffix of ["only if something else", "unless rates fall"]) {
      const outcome = await answerWithInference(
        `Explain how ${CAUSE_A} affects ${EFFECT_B} ${suffix}.`,
        sink,
      );
      expect(outcome.status, suffix).toBe("NO_CANDIDATE_EVIDENCE");
    }
    expect(calls).toHaveLength(0);
  });

  it("applies canonical direction through the production door", async () => {
    // The reverse relation, end to end: only C -> D and A -> B are stored, so asking about the
    // reverse of a stored edge must find nothing rather than the edge that shares its endpoints.
    const calls: string[] = [];
    const outcome = await answerWithInference(`Explain how ${EFFECT_B} affects ${CAUSE_A}.`, {
      generatePlan: async (q: string) => {
        calls.push(q);
        return { segments: [] };
      },
    });
    expect(outcome.status).toBe("NO_CANDIDATE_EVIDENCE");
    expect(calls).toHaveLength(0);
  });

  it("routes a canonical request through the canonical door, proven end to end", async () => {
    // The mutant this exists for: point the CANONICAL branch of `answerWithInference` back at the
    // legacy door. Every other test in this file calls the canonical helper DIRECTLY, so none of
    // them observes the production wiring at all — the mutant survived them, which is the
    // "tests only exercise the helper" failure named before it happened.
    //
    // Discriminating it needs a query on which the two doors genuinely DISAGREE, and a mismatch
    // cannot be injected here because production parses the very text it is given. This query
    // supplies one: a stored subject named in the SOURCE slot rather than the subject slot. The
    // legacy door searches the whole sentence and resolves nothing; the canonical door reads only
    // the authorized subject region and resolves exactly one subject.
    // `PUBLISHER` names BOTH a stored provider and a stored series here, which is what makes the
    // two doors disagree. IR-107 B2-C added the provider row: before it, this slot named nothing the
    // repository held as a `Source`, and an attributed request naming a party this repository cannot
    // identify now refuses rather than being answered from whatever series matched the subject.
    const query = `What did ${PUBLISHER} publish about ${SUBJECT_A}?`;

    // The legacy door searches the whole sentence, finds BOTH stored names — the one in the source
    // slot and the one in the subject slot — and refuses as ambiguous. The canonical door reads only
    // the authorized subject region and resolves exactly one.
    const legacy = await deriveLegacyCandidateEnvelope(query);
    expect(legacy.status).toBe("AMBIGUOUS");
    expect(legacy.seriesIds).toHaveLength(0);

    const calls: string[] = [];
    const outcome = await answerWithInference(query, {
      generatePlan: async (q: string) => {
        calls.push(q);
        return { segments: [] };
      },
    });

    // Reaching the planner AT ALL is the discriminator: through the legacy door this request has
    // no candidate evidence and the planner is never consulted.
    expect(calls).toHaveLength(1);
    expect(outcome.status).not.toBe("NO_CANDIDATE_EVIDENCE");
    // And the planner still receives the raw prose, which is the one thing the query is for.
    expect(calls[0]).toBe(query);
  });

  it("cannot be handed a deterministic operation at all", () => {
    // `CURRENT_OBSERVATION`, `OBSERVED_CHANGE` and `DEFINITION` are plannerPermitted:false. The
    // constructor refuses them, so the canonical candidate function cannot be called with one —
    // the guarantee is a type, narrowed through an exhaustive switch, rather than a runtime check
    // somebody could forget to write.
    for (const sentence of [
      "What is the current TEST Canonical Alpha Index?",
      "What is the change in TEST Canonical Alpha Index last year?",
      "What is a yield curve inversion?",
    ]) {
      const authority = resolveRequestAuthority(sentence);
      expect(authority.status, sentence).toBe("AUTHORIZED");
      if (authority.status !== "AUTHORIZED") continue;
      expect(authority.contract.plannerPermitted, sentence).toBe(false);
      expect(asPlannerRequest(authority), sentence).toBeNull();
    }
  });
});
