/**
 * Reality Fabric — PROVIDER CAPABILITY MATRIX (shadow contract).
 *
 * What each external source can actually tell us, axis by axis, and how we know.
 *
 * This exists because "the provider supports X" is the single most expensive unexamined claim in
 * the system. Every one of this project's provider defects was a capability believed rather than
 * observed: `fy` was non-nullable because the documentation said so and arrives null; the filing
 * history was complete because the endpoint returned 200, and it was 1000 of 2240; revenue kept
 * one tag across time because that is how a taxonomy is supposed to work, and it moved across
 * three. In every case the documentation was not lying — it was answering a different question
 * than the one being asked of it.
 *
 * So the state and the EVIDENCE FOR IT travel together, and one rule is enforced by test:
 *
 *   **`SUPPORTED` and `NOT_SUPPORTED` both require `LIVE_RESPONSE`.**
 *
 * The second half of that is the part that is easy to get wrong. Absence of a field from the
 * documentation is not proof the provider withholds it, any more than its presence is proof the
 * provider supplies it. Asserting NOT_SUPPORTED from a document is the same error as asserting
 * SUPPORTED from one, and it is worse in effect: it closes an inquiry rather than opening it.
 *
 * SHADOW ONLY. Nothing in v1 imports this, and it performs no reads or writes.
 */

/**
 * What a provider can tell us about one axis.
 *
 * Five states rather than a boolean, because "no" has three distinct meanings here and acting on
 * them differs: one is a fact about the provider, one is a gap in our work, and one is an
 * admission that we do not know which.
 */
export type CapabilityState =
  /** A real response carried it. */
  | "SUPPORTED"
  /** A real response established that the provider does not carry it. Nothing to fetch. */
  | "NOT_SUPPORTED"
  /** Documented or declared, never seen in a real response. Verification debt, not a limitation. */
  | "NOT_VERIFIED"
  /** A real response carried it for some records and not others, on stated conditions. */
  | "CONDITIONAL"
  /** We cannot currently determine the availability at all. */
  | "UNKNOWN";

/**
 * Where a claim about a capability came from.
 *
 * Ordered by weight, and only the first carries any. `PROVIDER_DOCUMENTATION` is what said `fy`
 * was a number; `ADAPTER_DECLARATION` is what our own TypeScript asserts, which is a restatement
 * of the documentation with extra confidence and no extra evidence.
 */
export type CapabilityProvenance =
  "LIVE_RESPONSE" | "PROVIDER_DOCUMENTATION" | "ADAPTER_DECLARATION" | "ABSENT";

/** The semantic evidence a source may or may not be able to supply. */
export type CapabilityAxis =
  /** The date or period the value DESCRIBES. */
  | "observation_time"
  /** Where a value covers a span, when the span opens. */
  | "period_start"
  /** Where a value covers a span, when it closes; for an instant, the instant. */
  | "period_end"
  /** When the provider published this value. */
  | "source_release_time"
  /** The provider's own identifier for THIS VERSION of a value. */
  | "provider_revision_identity"
  /** When this version became the provider's current answer. */
  | "provider_vintage_time"
  /** Whether a record is an amendment or restatement of an earlier one. */
  | "amendment_identity"
  /** A mechanism for reaching records beyond the first response. */
  | "pagination_evidence"
  /** A provider-stated total to check what we hold against. */
  | "total_count_evidence"
  /** The provider stating when the next value is due, rather than us projecting it. */
  | "freshness_semantics"
  /** An explicit link from a value to the value it replaced. */
  | "revision_history"
  /** Enough on each record to trace it back to a specific provider artefact. */
  | "source_provenance"
  /** A version stamp for the schema or taxonomy the response is expressed in. */
  | "schema_version_metadata";

export interface CapabilityEvidence {
  state: CapabilityState;
  /** The mechanism, in the provider's own vocabulary. Null where there is none to name. */
  field: string | null;
  /** How we know. Required — a state with no basis is an opinion with a type annotation. */
  basis: string;
  provenance: CapabilityProvenance;
  /** The gate blocking verification, where one does. */
  blockedBy?: string;
}

export interface ProviderCapabilityProfile {
  sourceCode: string;
  /** One line on what has and has not been proven about this provider overall. */
  standing: string;
  axes: Record<CapabilityAxis, CapabilityEvidence>;
}

const live = (
  state: Extract<CapabilityState, "SUPPORTED" | "NOT_SUPPORTED" | "CONDITIONAL">,
  field: string | null,
  basis: string,
): CapabilityEvidence => ({ state, field, basis, provenance: "LIVE_RESPONSE" });

const unverified = (
  field: string | null,
  basis: string,
  blockedBy: string,
  provenance: CapabilityProvenance = "ADAPTER_DECLARATION",
): CapabilityEvidence => ({ state: "NOT_VERIFIED", field, basis, provenance, blockedBy });

/**
 * SEC EDGAR — the only provider whose real responses have been observed.
 *
 * The counts below come from the populated database (2240 filings, 1431 facts) and the 67-check
 * live contract run, not from the SEC documentation, which differed from reality in four separate
 * ways when they were first compared.
 */
const SEC_EDGAR: ProviderCapabilityProfile = {
  sourceCode: "SEC_EDGAR",
  standing:
    "Live-verified across submissions and companyfacts. Every SUPPORTED and NOT_SUPPORTED state " +
    "below rests on an observed response, and four of them contradict the documented shape.",
  axes: {
    observation_time: live(
      "SUPPORTED",
      "filings.recent.filingDate / facts[].end",
      "Both verified as populated arrays in the live contract run, and 2240 filings and 1431 " +
        "facts ingested with them.",
    ),
    period_start: live(
      "CONDITIONAL",
      "facts[].start",
      "Present for duration concepts, absent for instants: 912 of 1431 stored facts carry a " +
        "period start and 519 do not. Discovered the expensive way — a uniqueness key that " +
        "omitted it silently discarded 168 facts on every ingest.",
    ),
    period_end: live("SUPPORTED", "facts[].end", "Present on all 1431 stored facts."),
    source_release_time: live(
      "SUPPORTED",
      "facts[].filed / filings.recent.filingDate",
      "Verified as a populated string array; every stored fact carries a filed date.",
    ),
    provider_revision_identity: live(
      "SUPPORTED",
      "facts[].accn / filings.recent.accessionNumber",
      "An accession number identifies the filing a figure was read out of, which fixes its " +
        "version without reference to when we fetched it.",
    ),
    provider_vintage_time: {
      state: "NOT_SUPPORTED",
      field: null,
      basis:
        "No response carries a per-figure 'became current at' time. A later filing supersedes an " +
        "earlier one, but that is an inference from filing order, not a published vintage.",
      provenance: "LIVE_RESPONSE",
    },
    amendment_identity: live(
      "SUPPORTED",
      "form suffix /A",
      "86 of Apple's stored filings carry /A, and 17 stored facts come from form 10-K/A. The " +
        "suffix is the only amendment signal, and it is a string convention rather than a flag.",
    ),
    pagination_evidence: live(
      "SUPPORTED",
      "filings.files[]",
      "filings.recent is hard-capped at 1000 rows and the remainder spills into files[]. Not " +
        "documented as a cap; found when a company with 2240 filings reported 1000 and success.",
    ),
    total_count_evidence: live(
      "CONDITIONAL",
      "filings.files[].filingCount",
      "Filings can be counted: each overflow file states its filingCount, which is what makes " +
        "truncation detectable. Facts cannot — companyfacts publishes no total, so completeness " +
        "for financial facts is permanently unconfirmable rather than merely unconfirmed.",
    ),
    freshness_semantics: {
      state: "NOT_SUPPORTED",
      field: null,
      basis:
        "SEC states no schedule for when a company's next filing is due. Cadence is projected " +
        "from observed filing history by economicCalendar.ts, which is our inference, not theirs.",
      provenance: "LIVE_RESPONSE",
    },
    revision_history: live(
      "CONDITIONAL",
      "multiple facts per (concept, period)",
      "A restatement appears as an additional fact from a later filing. There is no explicit " +
        "'this replaces that' link, so the relationship must be reconstructed from filedDate and " +
        "the amendment suffix — which is exactly the reconstruction that produced a page showing " +
        "an original figure under a banner asserting it was the amendment.",
    ),
    source_provenance: live(
      "SUPPORTED",
      "accn + form + filed on every fact",
      "Every figure traces to a specific filing without any joining on our side.",
    ),
    schema_version_metadata: {
      state: "NOT_SUPPORTED",
      field: null,
      basis:
        "No taxonomy version appears in the response. The ASC 606 transition had to be found by " +
        "noticing that revenue moved across three us-gaap tags, which is detection by symptom.",
      provenance: "LIVE_RESPONSE",
    },
  },
};

/**
 * FRED, ECOS and OpenDART — no success response has ever been observed.
 *
 * The keyless verification run on 2026-08-17 reached all three real endpoints and confirmed URL
 * construction, parameter names and the error envelopes the clients branch on. That is real
 * evidence about a narrow thing and none of it is evidence about the success shape, which is
 * precisely where EDGAR's drift was hiding. So every axis below is NOT_VERIFIED — including the
 * ones where the provider plainly has no such concept, because asserting NOT_SUPPORTED from a
 * document is the same error in the opposite direction.
 */
const FRED: ProviderCapabilityProfile = {
  sourceCode: "FRED",
  standing:
    "No success response ever observed (HG-002). The error path and URL construction were " +
    "live-verified; the data shape is adapter declaration only.",
  axes: {
    observation_time: unverified(
      "observations[].date",
      "Declared in fred/types.ts as the period the value describes, explicitly not the release " +
        "time. Whether a real response honours that distinction is unconfirmed.",
      "HG-002",
    ),
    period_start: unverified(
      null,
      "A FRED observation is expected to be an instant with no span, so there may be nothing to " +
        "support. Recorded as unverified rather than unsupported: we have not seen a response.",
      "HG-002",
    ),
    period_end: unverified(
      "observations[].date",
      "The same field as observation_time if the observation is an instant.",
      "HG-002",
    ),
    source_release_time: unverified(
      "observations[].realtime_start",
      "Declared in fred/types.ts as 'first date this vintage was known to FRED'. Whether that is " +
        "a release time or a vintage time is exactly what a live response would settle.",
      "HG-002",
    ),
    provider_revision_identity: unverified(
      "realtime_start/realtime_end pair",
      "The pair may function as a version identifier. Unconfirmed, and no adapter reads it.",
      "HG-002",
    ),
    provider_vintage_time: unverified(
      "observations[].realtime_start",
      "The single most valuable unverified field in the system: it is exactly the evidence the " +
        "provider-vintage contract needs, it is already declared, and no adapter reads it. " +
        "Marking it SUPPORTED on the strength of the documentation is the specific mistake this " +
        "matrix exists to prevent.",
      "HG-002",
    ),
    amendment_identity: unverified(
      null,
      "No amendment concept identified in the documented shape.",
      "HG-002",
      "PROVIDER_DOCUMENTATION",
    ),
    pagination_evidence: unverified(
      "limit / offset",
      "Declared optional in fred/types.ts because their presence in a real response is " +
        "unconfirmed. The client sends explicit limit/offset and pages until it holds `count` " +
        "rows, so a documented-but-absent field cannot silently truncate.",
      "HG-002",
    ),
    total_count_evidence: unverified(
      "count",
      "Declared as total matching observations. If real, FRED would be the only provider that " +
        "makes completeness provable rather than merely undetected.",
      "HG-002",
    ),
    freshness_semantics: unverified(
      null,
      "FRED publishes release calendars through a separate endpoint this adapter does not call.",
      "HG-002",
      "PROVIDER_DOCUMENTATION",
    ),
    revision_history: unverified(
      "realtime_start/realtime_end",
      "The realtime pair is the documented mechanism for retrieving prior vintages, which would " +
        "make FRED the one provider with genuine revision history.",
      "HG-002",
    ),
    source_provenance: unverified(
      "series_id + date",
      "Sufficient to identify which series a value belongs to; not sufficient to identify which " +
        "version of it.",
      "HG-002",
    ),
    schema_version_metadata: unverified(
      null,
      "No version stamp identified in the documented shape.",
      "HG-002",
      "PROVIDER_DOCUMENTATION",
    ),
  },
};

const ECOS: ProviderCapabilityProfile = {
  sourceCode: "ECOS",
  standing:
    "No success response ever observed (HG-003). The RESULT.CODE/MESSAGE error envelope was " +
    "live-verified and the key did not leak into the message, which matters because ECOS carries " +
    "it in the URL path.",
  axes: {
    observation_time: unverified(
      "TIME",
      "Format varies by cycle: 2026 / 2026Q1 / 202601 / 20260101. Parsing four formats from a " +
        "field whose format is inferred from a request parameter is a live-verification priority.",
      "HG-003",
    ),
    period_start: unverified(
      null,
      "TIME denotes a period by convention rather than by an explicit start and end.",
      "HG-003",
    ),
    period_end: unverified("TIME", "The same field, read as the period it names.", "HG-003"),
    source_release_time: unverified(
      null,
      "No publication-time field identified in the documented shape.",
      "HG-003",
      "PROVIDER_DOCUMENTATION",
    ),
    provider_revision_identity: unverified(
      null,
      "No version identifier identified. ECOS revises figures, so their absence would leave " +
        "ingest order as the only ordering evidence — the IR-021 position.",
      "HG-003",
      "PROVIDER_DOCUMENTATION",
    ),
    provider_vintage_time: unverified(
      null,
      "No vintage concept identified in the documented shape.",
      "HG-003",
      "PROVIDER_DOCUMENTATION",
    ),
    amendment_identity: unverified(
      null,
      "No amendment concept identified.",
      "HG-003",
      "PROVIDER_DOCUMENTATION",
    ),
    pagination_evidence: unverified(
      "startIdx / endIdx path segments",
      "Pagination is expressed in the URL path rather than as response fields, so the response " +
        "may not state where the window sits.",
      "HG-003",
    ),
    total_count_evidence: unverified(
      "StatisticSearch.list_total_count",
      "Declared, and if real it makes truncation detectable for Korean macro series.",
      "HG-003",
    ),
    freshness_semantics: unverified(
      null,
      "No release schedule identified in the endpoints this adapter calls.",
      "HG-003",
      "PROVIDER_DOCUMENTATION",
    ),
    revision_history: unverified(
      null,
      "No mechanism identified for retrieving a prior vintage.",
      "HG-003",
      "PROVIDER_DOCUMENTATION",
    ),
    source_provenance: unverified(
      "STAT_CODE + ITEM_CODE1..4",
      "Identifies the series precisely, including the item hierarchy; says nothing about version.",
      "HG-003",
    ),
    schema_version_metadata: unverified(
      null,
      "No version stamp identified.",
      "HG-003",
      "PROVIDER_DOCUMENTATION",
    ),
  },
};

const OPENDART: ProviderCapabilityProfile = {
  sourceCode: "OPENDART",
  standing:
    "No success response ever observed (HG-004). A non-000 status was live-verified and " +
    "isDartError detects it correctly; the success shape is documentation only.",
  axes: {
    observation_time: unverified(
      "rcept_dt",
      "YYYYMMDD receipt date — when DART received the filing, which is a release time rather " +
        "than the period the content describes.",
      "HG-004",
    ),
    period_start: unverified(
      null,
      "The disclosure list carries no reporting period; that lives in the document body this " +
        "adapter does not fetch.",
      "HG-004",
    ),
    period_end: unverified(
      null,
      "As with period_start: the disclosure list names a filing, not a reporting period.",
      "HG-004",
    ),
    source_release_time: unverified(
      "rcept_dt",
      "The strongest release-time candidate of the three unverified providers.",
      "HG-004",
    ),
    provider_revision_identity: unverified(
      "rcept_no",
      "A receipt number identifies a filing, and by extension the version of anything read out " +
        "of it — structurally the same position as an SEC accession.",
      "HG-004",
    ),
    provider_vintage_time: unverified(
      null,
      "As with SEC, a filing-based provider is unlikely to publish a per-figure vintage. " +
        "Unverified rather than unsupported until a real response says so.",
      "HG-004",
      "PROVIDER_DOCUMENTATION",
    ),
    amendment_identity: unverified(
      "rm remark flags, e.g. 정정",
      "Declared as free-text remark flags rather than an enumerable field, which makes any " +
        "amendment test a substring match on Korean prose until a real response is available.",
      "HG-004",
    ),
    pagination_evidence: unverified(
      "page_no / page_count / total_page",
      "Declared as response fields, unlike ECOS.",
      "HG-004",
    ),
    total_count_evidence: unverified(
      "total_count",
      "Declared alongside total_page, which would make DART the one Korean source where " +
        "truncation is detectable from the response itself.",
      "HG-004",
    ),
    freshness_semantics: unverified(
      null,
      "No release schedule identified.",
      "HG-004",
      "PROVIDER_DOCUMENTATION",
    ),
    revision_history: unverified(
      null,
      "A correction filing is a new disclosure; no link to what it corrects was identified.",
      "HG-004",
      "PROVIDER_DOCUMENTATION",
    ),
    source_provenance: unverified(
      "rcept_no + corp_code",
      "corp_code is DART's internal identifier and is NOT a stock ticker, and it identifies a " +
        "company only within DART — the collision IR-001 and IR-002 were about.",
      "HG-004",
    ),
    schema_version_metadata: unverified(
      null,
      "No version stamp identified.",
      "HG-004",
      "PROVIDER_DOCUMENTATION",
    ),
  },
};

export const PROVIDER_CAPABILITIES: ProviderCapabilityProfile[] = [SEC_EDGAR, FRED, ECOS, OPENDART];

export const CAPABILITY_AXES: CapabilityAxis[] = Object.keys(SEC_EDGAR.axes) as CapabilityAxis[];

export function capabilityOf(sourceCode: string, axis: CapabilityAxis): CapabilityEvidence | null {
  return PROVIDER_CAPABILITIES.find((p) => p.sourceCode === sourceCode)?.axes[axis] ?? null;
}

/**
 * Why a piece of evidence is missing from a specific record.
 *
 * The three-way distinction the matrix exists to make possible. All three look identical at the
 * point of use — a field is absent — and they call for entirely different responses: accept it,
 * schedule work, or investigate the record.
 */
export type EvidenceGapKind =
  /** The provider does not supply this. Nothing to fetch; the limitation is permanent. */
  | "STRUCTURAL_LIMITATION"
  /** The provider may supply it and our adapter has never proven it. Work, not a limitation. */
  | "VERIFICATION_DEBT"
  /** The provider supplies it and THIS record does not have it. A data-quality question. */
  | "DATA_QUALITY_ISSUE"
  /** The provider supplies it conditionally, and the conditions are not met here. */
  | "CONDITIONAL_ABSENCE"
  /** We do not know which of the above applies. */
  | "CAPABILITY_UNKNOWN"
  /** Nothing is missing. */
  | "NO_GAP";

export interface EvidenceGap {
  kind: EvidenceGapKind;
  /** Always names the capability state behind the classification, so it can be re-derived. */
  rationale: string;
  /** The gate that would resolve it, where one exists. */
  blockedBy?: string;
}

/**
 * Classifies a missing piece of evidence against what the provider can actually supply.
 *
 * `presentInRecord` is the caller's observation about one record; everything else comes from the
 * matrix. Deliberately takes the observation rather than making it, so this stays pure and so the
 * classification cannot quietly become a second, divergent reader of the data.
 */
export function classifyEvidenceGap(
  sourceCode: string,
  axis: CapabilityAxis,
  presentInRecord: boolean,
): EvidenceGap {
  const capability = capabilityOf(sourceCode, axis);

  if (!capability) {
    return {
      kind: "CAPABILITY_UNKNOWN",
      rationale: `No capability profile recorded for ${sourceCode}, so the absence of ${axis} cannot be explained.`,
    };
  }

  if (presentInRecord) {
    return { kind: "NO_GAP", rationale: `${axis} is present on this record.` };
  }

  switch (capability.state) {
    case "NOT_SUPPORTED":
      return {
        kind: "STRUCTURAL_LIMITATION",
        rationale: `${sourceCode} does not supply ${axis}: ${capability.basis}`,
      };
    case "NOT_VERIFIED":
      return {
        kind: "VERIFICATION_DEBT",
        rationale:
          `${sourceCode} may supply ${axis} (${capability.field ?? "no field identified"}) but no ` +
          `live response has ever confirmed it: ${capability.basis}`,
        blockedBy: capability.blockedBy,
      };
    case "SUPPORTED":
      return {
        kind: "DATA_QUALITY_ISSUE",
        rationale:
          `${sourceCode} does supply ${axis} via ${capability.field ?? "a confirmed mechanism"}, ` +
          "so its absence from this record is a property of the record, not of the provider.",
      };
    case "CONDITIONAL":
      return {
        kind: "CONDITIONAL_ABSENCE",
        rationale: `${sourceCode} supplies ${axis} only under stated conditions: ${capability.basis}`,
      };
    case "UNKNOWN":
      return {
        kind: "CAPABILITY_UNKNOWN",
        rationale: `Whether ${sourceCode} supplies ${axis} has not been determined: ${capability.basis}`,
      };
  }
}
