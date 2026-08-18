import { capabilityOf, type CapabilityAxis, type CapabilityState } from "./providerCapability";

/**
 * Reality Fabric — PROVIDER VINTAGE AND SEMANTIC RECENCY (shadow contract).
 *
 * The concept IR-021 forced into existence. `upsertRevisionAwareObservation` decided which of two
 * values was current by asking which arrived last, so a stale CDN replay of a superseded figure
 * rolled a corrected value backward and reached users. The guard that stopped it is a heuristic —
 * "this value already appears earlier in the chain" — and a heuristic is what you write when the
 * evidence you actually need is missing.
 *
 * The evidence actually needed is the provider's own statement of WHEN a value became current.
 * This models that, provider-neutrally, without pretending anyone supplies it yet.
 *
 * **RETRIEVAL ORDER IS NOT SEMANTIC RECENCY.** That sentence is the whole module. `retrievedAt` is
 * always known and never authoritative: it records when we asked, which says nothing about which
 * answer is truer.
 *
 * SHADOW ONLY. Nothing in v1 imports this, and it performs no reads or writes.
 */

/**
 * Why a piece of vintage evidence is or is not available.
 *
 * Four states rather than a nullable field, because they call for different actions and
 * collapsing them is how "we never asked" starts reading like "there is nothing to find".
 */
export type EvidenceAvailability =
  /** The provider stated it and we captured it. */
  | "KNOWN"
  /** The provider publishes it, but this record predates our capturing it — go and fetch it. */
  | "UNKNOWN"
  /** The provider does not publish this concept at all. Nothing to fetch; stop asking. */
  | "NOT_PROVIDED"
  /** We believe the provider publishes it, but have never confirmed against the live API. */
  | "NOT_VERIFIED";

/** A single piece of vintage evidence, carrying why it is absent when it is. */
export interface VintageField<T> {
  availability: EvidenceAvailability;
  /** Present only when `availability` is KNOWN. */
  value?: T;
  /** Where the claim comes from, so it can be re-derived later. */
  basis?: string;
}

export const knownVintage = <T>(value: T, basis: string): VintageField<T> => ({
  availability: "KNOWN",
  value,
  basis,
});

export const absentVintage = <T>(
  availability: Exclude<EvidenceAvailability, "KNOWN">,
  basis: string,
): VintageField<T> => ({ availability, basis });

/**
 * What a provider says about the version of one value.
 *
 * Deliberately provider-neutral. FRED expresses vintage as `realtime_start`/`realtime_end`; SEC
 * expresses it as an accession number plus an amendment suffix; DART has its own. Forcing those
 * into one shape would lose what makes each meaningful, so this records the SEMANTICS each
 * carries and leaves the provider-specific reading to an adapter.
 */
export interface ProviderVintage {
  /** The provider's own identifier for this version of the value, if it issues one. */
  providerRevisionId: VintageField<string>;
  /**
   * When this version became the provider's current answer. The field that settles semantic
   * recency, and the one nothing currently populates.
   */
  providerVintageAt: VintageField<string>;
  /** When the provider published it, which may precede it becoming current. */
  sourceReleasedAt: VintageField<string>;
  /** When the value took effect in the world it describes, where that differs from release. */
  sourceEffectiveAt: VintageField<string>;
  /** When WE fetched it. Always known; never on its own a reason to prefer a value. */
  retrievedAt: string;
}

/**
 * The verdict of comparing two values' vintages.
 *
 * `UNRESOLVED` is the important member and the reason this is not a boolean. It means the
 * provider evidence needed to order these two does not exist in what we hold — a different
 * situation from "they are equally recent", and one that must not silently become "prefer
 * whichever arrived last".
 */
export type RecencyVerdict =
  "CANDIDATE_IS_NEWER" | "CANDIDATE_IS_OLDER" | "SAME_VINTAGE" | "UNRESOLVED";

export interface RecencyDecision {
  verdict: RecencyVerdict;
  /** Which field settled it, or which was missing. Never a bare verdict. */
  rationale: string;
}

const isKnown = <T>(a: VintageField<T>, b: VintageField<T>) =>
  a.availability === "KNOWN" && b.availability === "KNOWN";

/**
 * Precedence for deciding which of two values is semantically newer.
 *
 * Strongest to weakest, and it stops rather than falling through to the clock:
 *
 *  1. `providerVintageAt` — the provider stating when a version became current. Definitive.
 *  2. `sourceReleasedAt` — publication time. Strong, but a provider can publish a correction to
 *     an old period, so it orders VERSIONS rather than periods.
 *  3. **Nothing.** `retrievedAt` is deliberately NOT a rung. Treating it as one is precisely the
 *     assumption that produced IR-021, and adding it here would reintroduce that defect wearing
 *     the clothes of a contract.
 *
 * `providerRevisionId` is also not a rung: ordering by it requires proving the identifiers are
 * ordered, which is true of an SEC accession sequence and false of a UUID. An adapter that can
 * prove it for its own provider should decide that itself rather than have this assume it.
 *
 * Returns UNRESOLVED when no rung applies, so the caller must decide what to do about not
 * knowing — which is the behaviour that was missing.
 */
export function compareVintage(
  current: ProviderVintage,
  candidate: ProviderVintage,
): RecencyDecision {
  if (isKnown(current.providerVintageAt, candidate.providerVintageAt)) {
    const c = current.providerVintageAt.value as string;
    const n = candidate.providerVintageAt.value as string;
    if (n === c) {
      return { verdict: "SAME_VINTAGE", rationale: `Both carry providerVintageAt ${n}.` };
    }
    return {
      verdict: n > c ? "CANDIDATE_IS_NEWER" : "CANDIDATE_IS_OLDER",
      rationale: `providerVintageAt ${n} against ${c}.`,
    };
  }

  if (isKnown(current.sourceReleasedAt, candidate.sourceReleasedAt)) {
    const c = current.sourceReleasedAt.value as string;
    const n = candidate.sourceReleasedAt.value as string;
    if (n === c) {
      return {
        verdict: "SAME_VINTAGE",
        rationale: `Both released ${n}; no vintage field separates them.`,
      };
    }
    return {
      verdict: n > c ? "CANDIDATE_IS_NEWER" : "CANDIDATE_IS_OLDER",
      rationale: `sourceReleasedAt ${n} against ${c}.`,
    };
  }

  return {
    verdict: "UNRESOLVED",
    rationale:
      `No provider version evidence orders these two (${missingVintageReason(current, candidate)}). ` +
      "Retrieval order is not semantic recency, so this is undecidable from what is stored.",
  };
}

/** Names why vintage comparison could not proceed, so the gap is actionable rather than opaque. */
function missingVintageReason(a: ProviderVintage, b: ProviderVintage): string {
  const states = new Set([a.providerVintageAt.availability, b.providerVintageAt.availability]);
  if (states.has("NOT_PROVIDED")) return "the provider does not publish a vintage";
  if (states.has("NOT_VERIFIED")) return "the provider vintage semantics are unverified";
  return "vintage was not captured for at least one value";
}

/**
 * Bridge from the capability matrix to vintage availability.
 *
 * Deliberately DERIVED rather than restated. An earlier draft carried its own provider table, and
 * a second table describing the same providers is a second thing to keep true — this repository
 * has shipped a page whose banner and figure disagreed for exactly that reason, and the whole
 * IDENTITY_MODELLING cluster is variations on the same theme. `providerCapability.ts` is the one
 * place a claim about a provider is made.
 */
function availabilityFromCapability(state: CapabilityState): EvidenceAvailability {
  switch (state) {
    case "SUPPORTED":
      return "KNOWN";
    case "NOT_SUPPORTED":
      return "NOT_PROVIDED";
    case "NOT_VERIFIED":
      return "NOT_VERIFIED";
    // A capability that holds only under stated conditions says nothing about THIS record, so the
    // honest availability is unknown rather than either extreme.
    case "CONDITIONAL":
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

/**
 * A vintage record for a value we hold but captured no version evidence for.
 *
 * Reports each field at the availability the PROVIDER's capability implies, downgrading a
 * capability of KNOWN to UNKNOWN: the provider does publish it, we simply did not store it. That
 * distinction is what turns this from a shrug into a work item.
 */
export function vintageUnavailable(sourceCode: string, retrievedAt: string): ProviderVintage {
  const field = (axis: CapabilityAxis): VintageField<string> => {
    const capability = capabilityOf(sourceCode, axis);
    const basis = capability
      ? `${sourceCode}: ${capability.basis}`
      : `${sourceCode}: no capability profile recorded`;
    const availability = capability ? availabilityFromCapability(capability.state) : "UNKNOWN";
    // KNOWN is downgraded to UNKNOWN on purpose. The provider DOES publish this; we simply did
    // not store it, which is a work item rather than a limitation, and collapsing the two is how
    // "nobody has fetched this yet" starts reading like "there is nothing to fetch".
    return absentVintage(availability === "KNOWN" ? "UNKNOWN" : availability, basis);
  };

  return {
    providerRevisionId: field("provider_revision_identity"),
    providerVintageAt: field("provider_vintage_time"),
    sourceReleasedAt: field("source_release_time"),
    // Not an axis in the matrix: no provider examined so far distinguishes when a value took
    // effect in the world from when it was published, so there is nothing yet to model.
    sourceEffectiveAt: absentVintage(
      "NOT_PROVIDED",
      `${sourceCode}: no effective-time concept identified`,
    ),
    retrievedAt,
  };
}
