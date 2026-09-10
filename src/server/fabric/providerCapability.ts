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

/**
 * ECOS — Bank of Korea. Live-verified 2026-09-11, when HG-003 closed.
 *
 * Every state below rests on an observed StatisticSearch response for 722Y001 (base rate, monthly
 * cycle), reproducible with `scripts/observe-capability-axes.ts`. The row shape is fixed by the
 * endpoint: fourteen keys appear on every row, six of them empty for this series, and the empty
 * ones are the additional item code and name slots and a weight — none of which carries any of the
 * axes below. So `NOT_SUPPORTED` here means the response HAS NO MECHANISM, enumerated rather than
 * inferred from a document.
 */
const ECOS: ProviderCapabilityProfile = {
  sourceCode: "ECOS",
  standing:
    "Live-verified. The response carries fourteen fields and an envelope of two, and what it does " +
    "NOT carry is the more consequential half: no release time, no revision identity, no vintage, " +
    "no amendment marker and no provisional flag. The IR-021 position — that ingest order is the " +
    "only ordering evidence ECOS gives us — is now an observation rather than a fear.",
  axes: {
    observation_time: live(
      "SUPPORTED",
      "TIME",
      "Populated on 32 of 32 observed rows, as YYYYMM for the monthly cycle. The format is a " +
        "function of the cycle requested, not of the response, which is why the adapter parses " +
        "four shapes against a declared cycle rather than sniffing.",
    ),
    period_start: live(
      "NOT_SUPPORTED",
      null,
      "No field in the observed fourteen opens a span. TIME names a period by convention, and the " +
        "convention is the only thing that says how long it is.",
    ),
    period_end: live(
      "SUPPORTED",
      "TIME",
      "The same field, read as the period it closes. Populated on 32 of 32 rows.",
    ),
    source_release_time: live(
      "NOT_SUPPORTED",
      null,
      "No publication time in the observed response. Previously recorded as undocumented, which " +
        "was a weaker claim: absence from a document is not absence from the wire, and this now " +
        "rests on the wire.",
    ),
    provider_revision_identity: live(
      "NOT_SUPPORTED",
      null,
      "No version identifier of any kind. ECOS does revise figures, so a revision arrives as a " +
        "changed DATA_VALUE for a TIME already held, indistinguishable from the original except " +
        "by when we fetched it. This is exactly the IR-021 position, and it is why " +
        "selectCurrentObservation resolves ECOS chains by CHAIN_STRUCTURE and not by vintage.",
    ),
    provider_vintage_time: live(
      "NOT_SUPPORTED",
      null,
      "No 'became current at' time. Contrast FRED, which supplies one under a realtime range — " +
        "the difference is a property of the providers, not of how hard we looked.",
    ),
    amendment_identity: live(
      "NOT_SUPPORTED",
      null,
      "Nothing marks a row as amending an earlier one.",
    ),
    pagination_evidence: live(
      "SUPPORTED",
      "startIdx / endIdx path segments with list_total_count",
      "The window is addressed by 1-based inclusive path segments and the envelope states the " +
        "total, so a caller can tell a complete answer from a truncated one. Verified against a " +
        "real window: 320 observations fetched with nothing truncated and no duplicate TIME " +
        "across boundaries.",
    ),
    total_count_evidence: live(
      "SUPPORTED",
      "list_total_count",
      "Stated in the envelope and matched the rows returned exactly (32 of 32) on the observed " +
        "window. A provider-stated total is what makes completeness checkable rather than assumed.",
    ),
    freshness_semantics: live(
      "NOT_SUPPORTED",
      null,
      "No next-release field. Freshness for ECOS series is therefore projected from observed " +
        "cadence, which `evaluateStaleness` does and labels as projected.",
    ),
    revision_history: live(
      "NOT_SUPPORTED",
      null,
      "No link from a value to the value it replaced. The chain this repository holds is one it " +
        "constructs at ingest, not one the provider publishes.",
    ),
    source_provenance: live(
      "SUPPORTED",
      "STAT_CODE / STAT_NAME / ITEM_CODE1 / ITEM_NAME1",
      "Every row identifies its statistic and item in both code and name, which is enough to " +
        "reach the provider's own table for it. Populated on 32 of 32 rows.",
    ),
    schema_version_metadata: live(
      "NOT_SUPPORTED",
      null,
      "No version stamp for the response shape. A silent change to the field set would be " +
        "detectable only by the adapter failing.",
    ),
    preliminary_final_identity: live(
      "NOT_SUPPORTED",
      null,
      "No provisional marker in the observed response, and this is the one worth stating " +
        "carefully: ECOS does publish provisional statistics (잠정치) that are later confirmed, " +
        "and the response gives no way to tell one from a final figure. So Observation." +
        "isPreliminary is unpopulated for ECOS (IR-041) because the provider supplies nothing to " +
        "populate it with, not because the ingest neglected to read it.",
    ),
  },
};

/**
 * OpenDART — Financial Supervisory Service. Live-verified 2026-09-11, when HG-004 closed.
 *
 * Observed on `list.json` for Samsung Electronics across 2025: 827 disclosures over 9 pages, 100
 * rows examined for the field inventory. Nine keys per row, one of them populated on only 18 of
 * 100 — which is the single CONDITIONAL cell below, and it is conditional from counting rather
 * than from reading about it.
 */
const OPENDART: ProviderCapabilityProfile = {
  sourceCode: "OPENDART",
  standing:
    "Live-verified. A disclosure list is an event stream, and the response is shaped like one: " +
    "every row is identified, dated and traceable, and nothing describes a span, a vintage or a " +
    "supersession. The correction marker exists and is a string convention on 18 of 100 rows.",
  axes: {
    observation_time: live(
      "SUPPORTED",
      "rcept_dt",
      "Populated on 100 of 100 observed rows as YYYYMMDD. A filing is an event, so the date it " +
        "was received is the date it describes.",
    ),
    period_start: live(
      "NOT_SUPPORTED",
      null,
      "Nothing in the nine observed fields opens a span. The report NAME often implies a period " +
        "— a quarterly report covers a quarter — but that is prose, and reading a period out of " +
        "it would be inference dressed as a field.",
    ),
    period_end: live(
      "SUPPORTED",
      "rcept_dt",
      "The receipt date, read as the instant the event occupies.",
    ),
    source_release_time: live(
      "SUPPORTED",
      "rcept_dt",
      "Receipt IS publication for this provider: the date a filing is accepted is the date it " +
        "becomes public. Unlike ECOS, where observation time and release time are different " +
        "questions with only the first answered.",
    ),
    provider_revision_identity: live(
      "SUPPORTED",
      "rcept_no",
      "A receipt number identifies one filing uniquely and permanently — verified unique across " +
        "all 827 disclosures and across every page boundary. It is also the key the public " +
        "document URL is built from, which is what makes a stored filing checkable by a reader.",
    ),
    provider_vintage_time: live(
      "NOT_SUPPORTED",
      null,
      "No per-record 'became current at' time. A correction supersedes an earlier filing, but " +
        "that is an inference from receipt order rather than a published vintage.",
    ),
    amendment_identity: live(
      "CONDITIONAL",
      "rm",
      "Populated on 18 of 100 observed rows, carrying 공, 공정, 유 and 정 — combined single-" +
        "character flags of which 정 marks a correction. The MECHANISM is observed; the meaning " +
        "of each character is documentation, in the same way SEC's /A suffix is a string " +
        "convention rather than a flag. Absent on the other 82 rows because most filings are not " +
        "corrections, which is why this is conditional rather than a data quality problem.",
    ),
    pagination_evidence: live(
      "SUPPORTED",
      "page_no / total_page",
      "The envelope states both, and pagination was exercised for real: 9 pages fetched, no " +
        "rcept_no repeated across a boundary. A provider that states its page count is one where " +
        "a truncated fetch can be detected rather than assumed away.",
    ),
    total_count_evidence: live(
      "SUPPORTED",
      "total_count",
      "827 stated against 100 rows on the first page, and 827 fetched in total. This is the axis " +
        "SEC_EDGAR can only satisfy conditionally, and OpenDART satisfies outright.",
    ),
    freshness_semantics: live(
      "NOT_SUPPORTED",
      null,
      "No next-filing-due field. Korean disclosure deadlines are statutory and knowable, but the " +
        "provider does not publish them per company on this endpoint.",
    ),
    revision_history: live(
      "NOT_SUPPORTED",
      null,
      "A row can say it IS a correction; nothing says WHAT it corrects. The 정 flag names the " +
        "kind of document, not its antecedent, so linking a correction to the filing it amends " +
        "would require matching on report names — an inference, not a link.",
    ),
    source_provenance: live(
      "SUPPORTED",
      "rcept_no / corp_code",
      "Both populated on 100 of 100 rows, and together they reach the exact document at " +
        "dsaf001/main.do?rcpNo=. corp_code stays source-scoped: DART's 8-digit code is never " +
        "merged with an EDGAR CIK.",
    ),
    schema_version_metadata: live(
      "NOT_SUPPORTED",
      null,
      "No version stamp for the response shape.",
    ),
    preliminary_final_identity: live(
      "NOT_SUPPORTED",
      null,
      "Nothing marks a filing provisional. For a disclosure this is close to meaningless — a " +
        "filing is filed — but the axis is answered from the response rather than from that " +
        "reasoning.",
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
