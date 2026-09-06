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
  | "schema_version_metadata"
  /** Whether the provider marks a value provisional, so a preliminary figure is not read as final. */
  | "preliminary_final_identity";

interface CapabilityEvidenceBase {
  /** The mechanism, in the provider's own vocabulary. Null where there is none to name. */
  field: string | null;
  /** How we know. Required — a state with no basis is an opinion with a type annotation. */
  basis: string;
  provenance: CapabilityProvenance;
}

/**
 * Evidence about one axis, with the gate bound to the state that needs one.
 *
 * `blockedBy` used to be optional on every state, which made "every NOT_VERIFIED cell names the
 * gate that would clear it" a CONVENTION held up by the `unverified()` helper rather than a
 * property of the type. An audit found the convention intact — 42 of 42 cells named a gate, and no
 * resolved cell carried a stray one — and an invariant that currently holds is exactly the one
 * worth making unbreakable, because the next cell written by hand is the one that breaks it.
 *
 * Both directions are enforced, and the second is not decoration. A gate on a SUPPORTED cell would
 * say a live response is still waiting on a credential, which is the same false "we do not know
 * yet" that `NOT_VERIFIED` exists to distinguish from a real limitation.
 */
export type CapabilityEvidence =
  | (CapabilityEvidenceBase & {
      state: "NOT_VERIFIED";
      /** The gate that would clear it. Required: debt nobody can act on is indistinguishable from a limitation. */
      blockedBy: string;
    })
  | (CapabilityEvidenceBase & {
      state: Exclude<CapabilityState, "NOT_VERIFIED">;
      /** Nothing is blocked, so naming a blocker would be a claim with no referent. */
      blockedBy?: never;
    });

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
    preliminary_final_identity: {
      state: "NOT_SUPPORTED",
      field: null,
      basis:
        "A filed figure is filed. SEC has no provisional/final distinction on a fact — a later " +
        "restatement arrives as a new fact from a new filing, which amendment_identity covers.",
      provenance: "LIVE_RESPONSE",
    },
  },
};

/**
 * FRED — live-verified 2026-09-06 under HG-002.
 *
 * `scripts/verify-fred-live.ts`: 46 of 46 contract checks against the real endpoint, then a
 * real ingest of CPIAUCSL through the production path (954 rows, 1 missing marker, providerCount
 * 955, one request, not truncated), a re-ingest (0 inserted, 0 revised, 954 unchanged) and a
 * provenance read-back (raw stored verbatim, retrievedAt set, releaseDate null on every row,
 * isPreliminary false). Zero schema drift against `fred/types.ts` — the first provider whose
 * documented shape survived first contact, which is worth saying because EDGAR's did not.
 *
 * Two findings the documentation would not have given:
 *
 *   - the DEFAULT response is one vintage stamped with the query date. Every one of 954 rows
 *     carried `realtime_start = 2026-09-06`, including 1947-01-01. It is not a release date.
 *   - the REALTIME RANGE is a genuine revision history. CPIAUCSL from 2023-01-01 across
 *     1776-07-04..9999-12-31 returned 114 rows over 43 dates; 35 dates carry several vintages,
 *     ordered and non-overlapping, the latest open-ended at 9999-12-31, and the first vintage of
 *     2023-01-01 is stamped 2023-02-14 — the month after the period, which is when the BLS
 *     published it. Four vintages of that one month: 300.536 -> 300.356 -> 300.456 -> 300.420.
 *
 * So several axes are CONDITIONAL rather than SUPPORTED: the evidence exists and the endpoint
 * returns it, but only when the realtime range is requested, and the ingest path does not request
 * it (M08 keeps `releaseDate` null for that reason). That is the honest shape of the capability —
 * present on the wire, absent from what is stored.
 */
const FRED: ProviderCapabilityProfile = {
  sourceCode: "FRED",
  standing:
    "Live-verified 2026-09-06 (HG-002): 46/46 contract checks, real ingest and re-ingest of " +
    "CPIAUCSL idempotent, provenance read back. Zero drift against fred/types.ts. Revision " +
    "history is real but only through the realtime range, which the ingest does not request.",
  axes: {
    observation_time: live(
      "SUPPORTED",
      "observations[].date",
      "The period the value describes: YYYY-MM-DD on every row, strictly ascending and unique " +
        "within a query, 1947-01-01 onward for CPIAUCSL. Independent of the vintage stamp.",
    ),
    period_start: live(
      "NOT_SUPPORTED",
      null,
      "No span field on the wire. A FRED observation is an instant: one `date` per row, and " +
        "the 46-check run saw no start/end pair on any of 16,873 DGS10 rows.",
    ),
    period_end: live(
      "SUPPORTED",
      "observations[].date",
      "The instant itself. Same field as observation_time, measured on every row.",
    ),
    source_release_time: live(
      "CONDITIONAL",
      "observations[].realtime_start (first vintage, realtime range only)",
      "Under default parameters realtime_start is the QUERY date on every row and is not a " +
        "release time. Under the realtime range the first vintage's realtime_start is the " +
        "publication date (2023-01-01 CPI first known 2023-02-14). The ingest uses the default " +
        "and stores releaseDate null (M08), so the evidence is on the wire, not in the store.",
    ),
    provider_revision_identity: live(
      "CONDITIONAL",
      "realtime_start / realtime_end pair",
      "A version identifier when the realtime range is requested: vintages of one date are " +
        "ordered, non-overlapping and the latest is open-ended at 9999-12-31 (114 rows, 43 " +
        "dates, 35 revised). Under the default query the pair is identical on every row and " +
        "identifies only the query.",
    ),
    provider_vintage_time: live(
      "CONDITIONAL",
      "observations[].realtime_start",
      "Present on every row and real: each vintage carries the date it became current. The " +
        "default response collapses to a single vintage stamped with the query date, so the " +
        "field is only informative when the range is requested. Re-measured 2026-09-06 after " +
        "IR-130: still CONDITIONAL, because the condition is the provider's and has not changed " +
        "— but an adapter reads it now. `ingestFredSeries({ allVintages: true })` requests the " +
        "range and stores each vintage's realtime_start as Observation.releaseDate; 71 CPIAUCSL " +
        "rows carry one. Stored, not yet ordered on (MARKET-REVISION-CHAIN-ORDERING-20260906).",
    ),
    amendment_identity: live(
      "NOT_SUPPORTED",
      null,
      "No amendment or restatement flag on the wire; a revision is a further vintage of the " +
        "same date with a different value, distinguishable only by realtime_start.",
    ),
    pagination_evidence: live(
      "SUPPORTED",
      "limit / offset",
      "Both present and numeric on every response; the requested limit is honoured; 16,873 " +
        "DGS10 rows came over 4 requests with no duplicate dates across page boundaries.",
    ),
    total_count_evidence: live(
      "SUPPORTED",
      "count",
      "The query total, not the page size: fetched exactly `count` rows for DGS10, and for " +
        "CPIAUCSL count 955 = 954 stored + 1 missing marker. Completeness is provable here.",
    ),
    freshness_semantics: live(
      "NOT_SUPPORTED",
      null,
      "The observations endpoint states nothing about when the next value is due. FRED " +
        "publishes release calendars through a separate releases endpoint this adapter does " +
        "not call; that would be a new capability, not a hidden one.",
    ),
    revision_history: live(
      "CONDITIONAL",
      "realtime_start / realtime_end (realtime range)",
      "Genuine and observed: 2023-01-01 CPI carries four vintages 300.536 -> 300.356 -> " +
        "300.456 -> 300.420, each superseding the last. Reachable only by requesting the " +
        "realtime range, which the ingest path does not; stored data holds the latest vintage.",
    ),
    source_provenance: live(
      "CONDITIONAL",
      "series_id + date (+ realtime_start for the version)",
      "series_id and date identify the value; the vintage is identified only when the range is " +
        "requested. Every stored row keeps the raw wire record verbatim, so the default stamp " +
        "is preserved even where it carries no per-row information.",
    ),
    schema_version_metadata: live(
      "NOT_SUPPORTED",
      null,
      'No version stamp on the wire. `units` is present but is the transformation code ("lin" ' +
        "= levels), not a schema version and not a measurement unit — the adapter's declared " +
        "unit comes from TRACKED_FRED_SERIES.",
    ),
    preliminary_final_identity: live(
      "NOT_SUPPORTED",
      null,
      "No provisional flag on the wire. A preliminary figure is simply an earlier vintage; " +
        "Observation.isPreliminary stays false on all 954 ingested rows (IR-041 unchanged).",
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
    preliminary_final_identity: unverified(
      null,
      "ECOS publishes provisional statistics (잠정치) that are later confirmed, and no field carrying that distinction has been identified. Observation.isPreliminary is unpopulated (IR-041).",
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
    preliminary_final_identity: unverified(
      null,
      "A disclosure is filed rather than provisional; the 정정 remark marks a correction, which is amendment_identity. No provisional flag identified.",
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
      // Deliberately does NOT claim the condition was checked, because this function is not given
      // enough to check it (`gpt-5.6-terra`). Saying "expected absence" outright would classify a
      // genuinely malformed record as normal; saying the condition went unevaluated leaves the
      // reader able to look.
      return {
        kind: "CONDITIONAL_ABSENCE",
        rationale:
          `${sourceCode} supplies ${axis} only under stated conditions, and whether this record ` +
          `meets them was not evaluated here: ${capability.basis}`,
      };
    case "UNKNOWN":
      return {
        kind: "CAPABILITY_UNKNOWN",
        rationale: `Whether ${sourceCode} supplies ${axis} has not been determined: ${capability.basis}`,
      };
  }
}
