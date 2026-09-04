import {
  CAPABILITY_AXES,
  PROVIDER_CAPABILITIES,
  type CapabilityAxis,
  type ProviderCapabilityProfile,
} from "../fabric/providerCapability";
import type { ActionKind } from "../governance/policy";
import { detectWeaknesses } from "./detect";
import { BACKFILLED_LEDGER, type LedgerEntry, type WeaknessCategory } from "./ledger";

/**
 * Evolution Engine — PROPOSALS (docs/EVOLUTION_ENGINE.md).
 *
 * The Engine detects weaknesses; this turns one class of them into something a human can act on
 * without having to re-derive the reasoning. It proposes and nothing else: no code is written, no
 * migration is run, and every proposal names the governed actions it would require, so the
 * decision to act stays where it belongs.
 *
 * The whole design rests on one separation. A proposal carries OBSERVED evidence and INFERRED
 * reasoning as different fields, and a test requires at least one observation per proposal. The
 * failure mode being designed out is specific and documented: `docs/LOCAL_AI_CALIBRATION.md`
 * records four fluent, confident, entirely fabricated defect reports, and IR-020 records a strong
 * model quoting a reproduction it had never run. Both were indistinguishable in form from real
 * findings. Structure is the only thing that separates them, so the structure is enforced.
 *
 * These proposals are also GENERATED from the capability matrix rather than written by hand. A
 * hand-written proposal can claim whatever its author believes; a generated one can only say what
 * the matrix says.
 *
 * SHADOW ONLY. Nothing in v1 imports this.
 */

/** Whether a statement was seen or concluded. Never both, and never left to the reader. */
export type EvidenceStanding = "OBSERVED" | "INFERRED";

export interface ProposalEvidence {
  standing: EvidenceStanding;
  statement: string;
  /** Where to go to check it: a capability cell, a ledger id, a shadow run. */
  source: string;
}

export interface Proposal {
  id: string;
  /** What was seen, with no interpretation attached. */
  observation: string;
  /** At least one OBSERVED item, by construction and by test. */
  evidence: ProposalEvidence[];
  /** The recurring cause this belongs to, or null when it does not belong to a known cluster. */
  systemicWeakness: WeaknessCategory | null;
  /** The reasoning. Always inferred — labelled so it is never mistaken for the observation. */
  hypothesis: string;
  /**
   * What this predicts will break NEXT, and what would show the prediction wrong.
   *
   * `falsifiedBy` is the load-bearing half and the one easiest to omit. A prediction with no
   * stated way to be wrong is a slogan, and this repository keeps a document about confident
   * output that could not be told apart from verified output.
   */
  prediction?: string;
  falsifiedBy?: string;
  proposedChange: string;
  expectedBenefit: string;
  /** Required, and never "none". A change with no downside has not been thought about. */
  expectedRisk: string;
  requiredVerify: string[];
  /** Which governed actions carrying this out would involve, so the gate is visible up front. */
  requiredGovernance: ActionKind[];
  /** The gate that blocks it now, where one does. */
  blockedBy?: string;
}

const axesWhere = (
  profile: ProviderCapabilityProfile,
  predicate: (axis: CapabilityAxis) => boolean,
): CapabilityAxis[] => CAPABILITY_AXES.filter(predicate);

/**
 * One proposal per provider whose capabilities have never been seen in a real response.
 *
 * This is the largest single body of unknowns in the system and it is invisible in the code: an
 * adapter compiles, its types look authoritative, and nothing marks the difference between a shape
 * confirmed against SEC's real responses and one transcribed from a documentation page. The matrix
 * makes the difference explicit; this turns it into a work item with a named gate.
 */
function verificationDebtProposal(profile: ProviderCapabilityProfile): Proposal | null {
  const unverified = axesWhere(profile, (axis) => profile.axes[axis].state === "NOT_VERIFIED");
  if (unverified.length === 0) return null;

  const gates = [
    ...new Set(unverified.map((axis) => profile.axes[axis].blockedBy).filter(Boolean)),
  ] as string[];

  return {
    id: `CAP-DEBT-${profile.sourceCode}`,
    observation:
      `${unverified.length} of ${CAPABILITY_AXES.length} capability axes for ` +
      `${profile.sourceCode} rest on documentation or adapter declaration, and none on an ` +
      "observed response.",
    evidence: [
      {
        standing: "OBSERVED",
        statement: profile.standing,
        source: `providerCapability.ts — ${profile.sourceCode}.standing`,
      },
      {
        standing: "OBSERVED",
        statement: `Axes never confirmed live: ${unverified.join(", ")}.`,
        source: "providerCapability.ts — capability states",
      },
      {
        standing: "OBSERVED",
        statement:
          "SEC EDGAR's documented shape differed from its real responses in four ways when the " +
          "two were first compared: fy/fp nullability, the 1000-row filings cap, the files[] " +
          "overflow, and revenue moving across three us-gaap tags.",
        source: "docs/PROJECT_STATE.md; ledger PD-01, PD-03, PD-04",
      },
      {
        standing: "INFERRED",
        statement:
          "These adapters were written the same way EDGAR's was — from documentation — so the " +
          "prior for drift on first real contact is high rather than speculative.",
        source: "inference from the observations above",
      },
    ],
    systemicWeakness: "PROVIDER_ASSUMPTION",
    hypothesis:
      `${profile.sourceCode} will diverge from its documented shape on first real contact, in ` +
      "nullability, pagination or field semantics, exactly as EDGAR did.",
    proposedChange:
      `Run the existing live-verification harness against ${profile.sourceCode} the moment a ` +
      "legitimate key exists, and promote capability cells from NOT_VERIFIED only on the strength " +
      "of the response — never on the strength of the harness having run.",
    expectedBenefit:
      "Converts the largest block of unknowns in the system into either confirmed capabilities or " +
      "named defects, and unblocks any Verify dimension currently reporting VERIFICATION_DEBT for " +
      "this provider.",
    expectedRisk:
      "A live run will very likely surface defects in an adapter currently believed working, " +
      "which turns a quiet unknown into visible work. That is the point, and it is still a cost.",
    requiredVerify: [
      "response shape against the declared TypeScript types",
      "nullability of every field the adapter treats as required",
      "pagination and total-count behaviour at a boundary, not just a happy path",
      "a real ingest followed by a re-ingest, proving idempotency",
    ],
    requiredGovernance: ["CALL_FREE_PROVIDER", "FIX_REPRODUCED_DEFECT"],
    blockedBy: gates.join(", ") || undefined,
  };
}

/**
 * One proposal per provider with a confirmed structural ceiling.
 *
 * The opposite situation, and the one more likely to be mishandled. A limitation that will never
 * lift should stop generating work — but only after it is written down as a ceiling rather than
 * left looking like an unfinished task, or every future reader re-opens the same investigation.
 */
function structuralLimitationProposal(profile: ProviderCapabilityProfile): Proposal | null {
  const unsupported = axesWhere(profile, (axis) => profile.axes[axis].state === "NOT_SUPPORTED");
  if (unsupported.length === 0) return null;

  return {
    id: `CAP-CEILING-${profile.sourceCode}`,
    observation:
      `${profile.sourceCode} was observed not to supply: ${unsupported.join(", ")}. Each was ` +
      "established from a real response, not from an absence in the documentation.",
    evidence: unsupported.map((axis) => ({
      standing: "OBSERVED" as const,
      statement: `${axis}: ${profile.axes[axis].basis}`,
      source: `providerCapability.ts — ${profile.sourceCode}.${axis}`,
    })),
    systemicWeakness: null,
    hypothesis:
      "These gaps will not close through any work on our side, so any layer treating them as " +
      "missing data will keep reporting a defect that has no fix.",
    proposedChange:
      "Keep the ceiling declared in the matrix and have downstream layers classify these absences " +
      "as STRUCTURAL_LIMITATION rather than as gaps — which Verify now does — so the product " +
      "discloses the limit to the reader instead of quietly implying completeness.",
    expectedBenefit:
      "Stops recurring investigation of a question already settled, and makes the limit visible " +
      "to a user rather than only to whoever last read the adapter.",
    expectedRisk:
      "A ceiling recorded once can become a ceiling assumed forever. A provider may add a field, " +
      "and nothing here would notice; the matrix needs re-checking when a provider versions its " +
      "API, not only when our code changes.",
    requiredVerify: [
      "the classification appears in a real shadow run rather than only in a unit test",
    ],
    requiredGovernance: ["EDIT_DOCS"],
  };
}

/**
 * Proposals derived from the capability matrix.
 *
 * Deterministic and total: same matrix, same proposals. Nothing here consults a model, and nothing
 * here can assert anything the matrix does not already say.
 */
export function capabilityGapProposals(
  profiles: ProviderCapabilityProfile[] = PROVIDER_CAPABILITIES,
): Proposal[] {
  return profiles
    .flatMap((profile) => [
      verificationDebtProposal(profile),
      structuralLimitationProposal(profile),
    ])
    .filter((proposal): proposal is Proposal => proposal !== null);
}

/** Observations only. Useful for a reader who wants the facts before anyone's reasoning. */
export function observedEvidence(proposal: Proposal): ProposalEvidence[] {
  return proposal.evidence.filter((e) => e.standing === "OBSERVED");
}
/**
 * What a recurring cause predicts, and what would show the prediction wrong.
 *
 * The detector counts clusters. Counting is not knowledge: "IDENTITY_MODELLING, 9 instances" tells
 * a reader that something recurred and nothing about what to do. `docs/EVOLUTION_ENGINE.md` says
 * the valuable output is the prediction — "the test of whether the lesson is real" — and until now
 * the Engine produced none.
 *
 * This table is hand-authored, once per category, and deliberately so. The same reasoning applies
 * as to `LedgerEntry.category`: the judgement belongs to whoever understood the defects, at the
 * moment of understanding, not to a later pass inferring it from prose. What IS generated is the
 * evidence — which instances, which subsystems, which lessons — so a proposal cannot claim a
 * cluster is bigger or broader than the ledger says.
 *
 * `falsifiedBy` is the field that matters and the one easiest to leave out. A prediction with no
 * stated way to be wrong is a slogan, and this project has an entire document about confident
 * output that could not be distinguished from verified output.
 */
export interface ClusterCountermeasure {
  /** What this cause predicts will break NEXT. Inferred, always. */
  prediction: string;
  /** The observation that would show the prediction wrong. Required — see above. */
  falsifiedBy: string;
  proposedChange: string;
  expectedBenefit: string;
  expectedRisk: string;
  requiredVerify: string[];
  requiredGovernance: ActionKind[];
}

const COUNTERMEASURES: Record<WeaknessCategory, ClusterCountermeasure> = {
  IDENTITY_MODELLING: {
    prediction:
      "The next one will be a key that is unique within some scope and used across it — a name " +
      "where an identifier belongs, a display form joined against a storage form, or a timestamp " +
      "asked to order rows it cannot separate.",
    falsifiedBy:
      "An audit of every join and every ORDER BY in the domain layer finding no key used outside " +
      "the scope it is unique in.",
    proposedChange:
      "Enumerate every composite key, join and ordering in src/server/domain, and for each state " +
      "the scope it is unique within. Where the scope is narrower than the use, that is the next " +
      "instance before it happens.",
    expectedBenefit:
      "The cluster's nine instances were each found after the fact, several by looking at output " +
      "that was already wrong. An enumeration finds them without needing the wrong output first.",
    expectedRisk:
      "An enumeration produces a long list of technically-narrow scopes that are fine in practice, " +
      "and triaging it costs more than the two or three real findings it contains.",
    requiredVerify: ["each identified scope mismatch reproduced before any change"],
    requiredGovernance: ["ADD_TEST", "FIX_REPRODUCED_DEFECT"],
  },
  FIXTURE_REALISM: {
    prediction:
      "The next one will be a test family whose fixtures contain exactly one of something the real " +
      "world has many of — one source, one period length per filing, one row below the provider's " +
      "cap, one revision per date.",
    falsifiedBy:
      "A cardinality review of the fixtures finding that every dimension a defect has ever used " +
      "already has a multi-valued case.",
    proposedChange:
      "For each fixture directory, list the dimensions along which the real data varies and mark " +
      "which are represented by exactly one value. Those are the defects that cannot currently be " +
      "written as a failing test.",
    expectedBenefit:
      "Every instance in this cluster was invisible to a green suite. The gap is in the data, so " +
      "looking at the data finds it and looking at the assertions does not.",
    expectedRisk:
      "Enriching fixtures makes tests slower and harder to read, and a fixture that varies along " +
      "every dimension at once tests nothing clearly.",
    requiredVerify: [
      "the enriched fixture makes a previously-passing test fail before it is fixed",
    ],
    requiredGovernance: ["ADD_TEST"],
  },
  SILENT_DEGRADATION: {
    prediction:
      "The next one will be a path whose failure mode is returning LESS rather than throwing: a " +
      "cap, a filter, a catch that logs, or a skipped suite that reads as green.",
    falsifiedBy:
      "Every partial-result path in the adapters and domain layer already carrying a count of what " +
      "it dropped, and a caller that reads it.",
    proposedChange:
      "Make every path that can return a subset report the size of the subset AND the size it " +
      "expected, so 'fewer rows' is a value rather than an absence.",
    expectedBenefit:
      "The 1000-of-2240 filings case and the 168 discarded facts both reported success. A count " +
      "that disagrees with itself is visible without anyone knowing to look for it.",
    expectedRisk:
      "Threading expected-versus-actual counts through every layer is invasive, and a count nobody " +
      "reads is the same silence with more code.",
    requiredVerify: ["a deliberately truncated ingest surfaces a non-zero shortfall end to end"],
    requiredGovernance: ["ADD_TEST", "REFACTOR"],
  },
  PROVIDER_ASSUMPTION: {
    prediction:
      "The next one will be an adapter written from documentation meeting its real endpoint for " +
      "the first time — FRED, ECOS and OpenDART are all in that state right now.",
    falsifiedBy:
      "A live verification run against one of the three finding zero divergences from the declared " +
      "TypeScript types.",
    proposedChange:
      "Treat the provider capability matrix as the work list it is: no cell moves to SUPPORTED " +
      "without a live response, and every NOT_VERIFIED cell names the gate that would clear it.",
    expectedBenefit:
      "SEC diverged from its documentation in four separate ways on first contact. Three adapters " +
      "carry the same unexamined risk and the matrix now says exactly where.",
    expectedRisk: "Blocked on credentials that are not available, so the debt keeps accruing.",
    requiredVerify: [
      "live response shape, nullability, pagination, then a real ingest and re-ingest",
    ],
    requiredGovernance: ["CALL_FREE_PROVIDER"],
  },
  CONCURRENCY: {
    prediction:
      "The next one will be a read-then-write sequence treated as atomic, or a retry loop standing " +
      "in for a constraint that was never added.",
    falsifiedBy:
      "Every multi-statement write in the domain layer being inside a transaction or protected by " +
      "a database constraint, with no retry loop compensating for a missing one.",
    proposedChange:
      "List every place that reads a row, decides something, and writes based on the decision. " +
      "Each one is either transactional, constraint-protected, or an instance waiting to happen.",
    expectedBenefit:
      "All four instances surfaced as a raw P2002 reaching a caller, which is the symptom rather " +
      "than the cause and only appears under contention that a test has to construct deliberately.",
    expectedRisk:
      "Wrapping more work in transactions lengthens lock windows, which trades a rare correctness " +
      "failure for a common latency one.",
    requiredVerify: ["a concurrent-writer test that fails before the change and passes after"],
    requiredGovernance: ["ADD_TEST", "FIX_REPRODUCED_DEFECT"],
  },
  PROVENANCE: {
    prediction:
      "The next one will be a figure that reaches a page without the source that produced it, " +
      "because the domain layer had it and the rendering dropped it.",
    falsifiedBy:
      "Every rendered figure in the app tracing to a stored Source, checked at the page level " +
      "rather than the domain level.",
    proposedChange:
      "Assert provenance where the reader sees it. The domain layer already attaches sourceCode; " +
      "the failures were all in the rendering, and domain-level tests cannot see them.",
    expectedBenefit:
      "The Macro Regime axes rendered bare numbers with no provider and no date while every other " +
      "section named both, and the domain layer had attached the provenance all along.",
    expectedRisk:
      "Page-level assertions are brittle against markup changes and can produce a maintenance cost " +
      "out of proportion to the risk.",
    requiredVerify: ["an assertion against rendered HTML, not against a domain return value"],
    requiredGovernance: ["ADD_TEST"],
  },
  GUARDRAIL_COVERAGE: {
    prediction:
      "The next one will be a rule expressed in one language, one word order, or one code path, " +
      "with an equivalent form left uncovered.",
    falsifiedBy:
      "An enumeration of the guardrail concepts finding an English and a Korean form, and a " +
      "request-side and an output-side form, for every one.",
    proposedChange:
      "Enumerate the CONCEPTS a guardrail covers rather than the patterns it contains, and check " +
      "each concept for the forms it can take. The last ten Ask Market bypasses were found that " +
      "way, by listing English-only concepts, not by probing.",
    expectedBenefit:
      "Enumeration finds holes probing does not, because probing only tests what the prober " +
      "thought of.",
    expectedRisk:
      "Broadening a guardrail costs false positives, and this one already pins eighteen legitimate " +
      "questions as must-not-flag precisely because over-blocking is a real harm.",
    requiredVerify: ["the must-not-flag corpus still passes after any pattern is added"],
    requiredGovernance: ["ADD_TEST", "FIX_REPRODUCED_DEFECT"],
  },
  ENVIRONMENT_DRIFT: {
    prediction:
      "The next one will be a safety check comparing surface text rather than what the text " +
      "resolves to — a host string, a path, a URL — or a suite that skips and reads as passing.",
    falsifiedBy:
      "Every environment guard resolving its inputs before comparing them, and every skip being " +
      "distinguishable from a pass in the output a human reads.",
    proposedChange:
      "For each guard, ask what two different strings could denote the same thing. localhost and " +
      "127.0.0.1 were the first pair; they will not be the last.",
    expectedBenefit:
      "This cluster protects the real database, and its failure mode is destroying data the " +
      "project cannot re-fetch without provider keys it does not have.",
    expectedRisk:
      "Resolution can be slow or can itself fail, and a guard that errors is a guard that blocks work.",
    requiredVerify: ["the guard refuses a same-target pair written two different ways"],
    requiredGovernance: ["ADD_TEST"],
  },
  SEMANTIC_RECENCY: {
    prediction:
      "The next one will be a place where WHEN we observed something stands in for WHICH version " +
      "we observed — an ordering on retrievedAt, a cache, a build, or a running process assumed " +
      "to match the tree.",
    falsifiedBy:
      "Every ordering decision in the system resting on provider-stated version evidence or on a " +
      "structural relationship, and none on our own clock.",
    proposedChange:
      "Capture provider vintage where the provider offers it, and where it does not, make the " +
      "absence explicit rather than substituting arrival time. The contract exists; nothing " +
      "populates it.",
    expectedBenefit:
      "Both instances were invisible to every test because the VALUE was correct and only the " +
      "version was wrong, which no assertion about a value can catch.",
    expectedRisk:
      "Refusing to order what cannot be ordered means showing more UNRESOLVED states to users, " +
      "which is honest and is also worse-looking than a confident wrong answer.",
    requiredVerify: ["a live provider response confirming what its version fields actually mean"],
    requiredGovernance: ["CALL_FREE_PROVIDER", "ADD_TEST"],
  },
  EVIDENCE_FABRICATION: {
    prediction:
      "The next one will be a confident, well-formed claim from a reviewer or a model that nobody " +
      "re-ran, accepted because nothing in its FORM distinguished it from a verified one.",
    falsifiedBy:
      "Every finding acted on in the last three rounds having a reproduction recorded before the " +
      "change, not after.",
    proposedChange:
      "Keep the reproduction step mandatory regardless of the reviewer's track record. Terra was " +
      "right five times out of five in one round; that is a reason to keep reading it, not a " +
      "reason to stop checking it.",
    expectedBenefit:
      "The step has already rejected one fabricated reproduction from a strong model and four " +
      "fabricated findings from weak ones, at the cost of running some code.",
    expectedRisk:
      "It is slow, and the temptation to skip it grows exactly as a reviewer's accuracy record " +
      "improves — which is when skipping it costs most.",
    requiredVerify: ["the finding reproduced against running code before any edit"],
    requiredGovernance: ["FIX_REPRODUCED_DEFECT"],
  },
};

/**
 * One proposal per detected cluster, turning a count into a prediction.
 *
 * Generated: the observation, the evidence and the instance list come from the ledger, so a
 * proposal cannot overstate how broad or how severe a cluster is. Authored: the prediction and the
 * countermeasure, per category, for the same reason categories are assigned at write time.
 */
export function clusterProposals(entries: LedgerEntry[] = BACKFILLED_LEDGER): Proposal[] {
  return detectWeaknesses(entries).map((weakness) => {
    const countermeasure = COUNTERMEASURES[weakness.category];
    const byId = new Map(entries.map((e) => [e.id, e]));
    return {
      id: `CLUSTER-${weakness.category}`,
      observation:
        `${weakness.instances.length} recorded instances of ${weakness.category} across ` +
        `${weakness.subsystems.length} subsystem(s) (${weakness.subsystems.join(", ")}), worst ` +
        `severity ${weakness.worstSeverity}. Scope: ${weakness.scope}.`,
      evidence: [
        ...weakness.instances.map((id) => ({
          standing: "OBSERVED" as const,
          statement: byId.get(id)?.lesson ?? "(entry not found)",
          source: `evolution/ledger.ts — ${id}`,
        })),
        {
          standing: "INFERRED" as const,
          statement: countermeasure.prediction,
          source: "inference from the instances above",
        },
      ],
      systemicWeakness: weakness.category,
      hypothesis: countermeasure.prediction,
      prediction: countermeasure.prediction,
      falsifiedBy: countermeasure.falsifiedBy,
      proposedChange: countermeasure.proposedChange,
      expectedBenefit: countermeasure.expectedBenefit,
      expectedRisk: countermeasure.expectedRisk,
      requiredVerify: countermeasure.requiredVerify,
      requiredGovernance: countermeasure.requiredGovernance,
    };
  });
}
