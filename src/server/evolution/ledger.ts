/**
 * Evolution Engine — ledger data (docs/EVOLUTION_LEDGERS.md).
 *
 * The Engine's memory. Without recorded history there is nothing to cluster, and the loop
 * degenerates into a model inventing plausible-sounding improvements — the failure mode
 * `docs/LOCAL_AI_CALIBRATION.md` documents in detail.
 *
 * These entries are BACKFILLED FROM THIS PROJECT'S REAL HISTORY, drawn from `docs/DECISIONS.md`,
 * `docs/INTERIM_REVIEW_FINDINGS.md` and `docs/REVIEW_DEBT.md`. Nothing here is invented; a
 * fabricated incident would corrupt exactly the signal the Engine exists to read.
 *
 * The `lesson` field is the point of the whole structure. A ledger of fixes is a changelog and git
 * already provides one. A ledger of LESSONS is the only thing that can predict the next defect.
 */

export type LedgerKind =
  | "INCIDENT"
  | "FALSE_GREEN"
  | "REVIEW_FINDING"
  | "REGRESSION"
  | "PROVIDER_DRIFT"
  | "PREDICTION_ERROR"
  | "USER_CORRECTION"
  | "SECURITY_FINDING"
  | "PERFORMANCE"
  | "COST";

export type WeaknessCategory =
  | "FIXTURE_REALISM"
  | "IDENTITY_MODELLING"
  | "SILENT_DEGRADATION"
  | "PROVIDER_ASSUMPTION"
  | "CONCURRENCY"
  | "PROVENANCE"
  | "GUARDRAIL_COVERAGE"
  | "ENVIRONMENT_DRIFT"
  /**
   * Freshness inferred from WHEN something was observed rather than from WHAT was observed.
   *
   * Distinct from IDENTITY_MODELLING, which is about keys lacking the precision asked of them.
   * This cause is about a clock standing in for provenance: the observation is recent, therefore
   * the thing observed is current. Both instances below were invisible to every test, because the
   * value under test was correct — it was the VERSION that was wrong.
   */
  | "SEMANTIC_RECENCY"
  /**
   * A confident claim treated as a verified one because nothing in its form distinguished them.
   *
   * Named separately from PROVENANCE because the fabricated evidence here came from a REVIEWER
   * rather than a data provider, which is the harder case: the whole purpose of a reviewer is to
   * be believed.
   */
  | "EVIDENCE_FABRICATION";

export interface LedgerEntry {
  id: string;
  ledger: LedgerKind;
  subsystem: string;
  severity: "P0" | "P1" | "P2" | "P3";
  summary: string;
  /**
   * The systemic lesson, NOT the fix. "Fixed the diff" is worthless here; "fixtures could not
   * express two durations" is the entry. This is the field the detector reads.
   */
  lesson: string;
  /**
   * The recurring cause this instance belongs to. Assigned when the entry is written, by the
   * person who understood the defect — NOT inferred later by string-matching a summary, which
   * would make the clustering a property of prose style rather than of the defects.
   */
  category: WeaknessCategory;
}

/**
 * Real history. Each entry traces to a documented defect in this repository.
 *
 * Kept deliberately as data rather than prose so the detector can be tested against it, and so
 * adding an entry is a small, reviewable diff at the moment a defect is understood.
 */
export const BACKFILLED_LEDGER: LedgerEntry[] = [
  {
    id: "FG-01",
    ledger: "FALSE_GREEN",
    subsystem: "filingDiff",
    severity: "P1",
    summary: "Reported a +232.9985% Apple revenue increase.",
    lesson:
      "No fixture contained two facts sharing one periodEnd with different durations, so no test " +
      "could exhibit a nine-month-versus-quarter comparison.",
    category: "FIXTURE_REALISM",
  },
  {
    id: "FG-02",
    ledger: "FALSE_GREEN",
    subsystem: "edgar/client",
    severity: "P1",
    summary: "Stored 1000 of Apple's 2240 filings and reported success.",
    lesson:
      "No fixture exceeded the provider's row cap, so the cap could not be reached in a test.",
    category: "FIXTURE_REALISM",
  },
  {
    id: "FG-03",
    ledger: "FALSE_GREEN",
    subsystem: "edgar-xbrl/ingest",
    severity: "P1",
    summary: "168 financial facts silently discarded on every ingest.",
    lesson:
      "No fixture had two facts differing only by periodStart, so a uniqueness key that omitted " +
      "it looked sufficient.",
    category: "FIXTURE_REALISM",
  },
  {
    id: "FG-04",
    ledger: "FALSE_GREEN",
    subsystem: "edgar identity",
    severity: "P1",
    summary: "2240 filings and 933 facts shared zero joinable rows.",
    lesson:
      "Fixtures used one CIK representation throughout, so padded and unpadded forms never met.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "FG-05",
    ledger: "FALSE_GREEN",
    subsystem: "askMarket / companyXray",
    severity: "P2",
    summary: "Financial facts pooled across providers sharing a corp code.",
    lesson: "Every fixture had exactly one source, so cross-provider collision was unreachable.",
    category: "FIXTURE_REALISM",
  },
  {
    id: "FG-06",
    ledger: "FALSE_GREEN",
    subsystem: "askMarket / morningBrief",
    severity: "P2",
    summary: "Figures rendered to users with no source attribution.",
    lesson: "No test asserted that displayed output carries the provider it came from.",
    category: "PROVENANCE",
  },
  {
    id: "RF-01",
    ledger: "REVIEW_FINDING",
    subsystem: "observationIngest",
    severity: "P0",
    summary: "Revision chain ordered by a millisecond-resolution timestamp.",
    lesson:
      "An identity or ordering key was asked to carry more precision than its storage type has.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "RF-02",
    ledger: "REVIEW_FINDING",
    subsystem: "ingestRun",
    severity: "P2",
    summary: "IngestRun.target stored an unpadded CIK while the data it describes is padded.",
    lesson: "A join key was written in display form on one side and storage form on the other.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "RF-03",
    ledger: "REVIEW_FINDING",
    subsystem: "filingDiff",
    severity: "P1",
    summary: "A 13-week and a 14-week quarter both bucket to three months.",
    lesson:
      "A rounding bucket used for comparability was treated as though it preserved the exact " +
      "quantity it had rounded away.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "PD-01",
    ledger: "PROVIDER_DRIFT",
    subsystem: "edgar-xbrl",
    severity: "P1",
    summary: "Real companyfacts rows arrive with fy and fp null against non-nullable columns.",
    lesson: "The provider's documented shape was believed over its observed responses.",
    category: "PROVIDER_ASSUMPTION",
  },
  {
    id: "PD-02",
    ledger: "PROVIDER_DRIFT",
    subsystem: "ecos / dart clients",
    severity: "P1",
    summary: "Both return HTTP 200 for an authentication failure.",
    lesson:
      "response.ok was treated as success without inspecting the body the provider actually sent.",
    category: "PROVIDER_ASSUMPTION",
  },
  {
    id: "PD-03",
    ledger: "PROVIDER_DRIFT",
    subsystem: "edgar/client",
    severity: "P1",
    summary: "filings.recent is capped at 1000 with the remainder in filings.files[].",
    lesson: "A documented response shape omitted the pagination the live endpoint actually uses.",
    category: "PROVIDER_ASSUMPTION",
  },
  {
    id: "PD-04",
    ledger: "PROVIDER_DRIFT",
    subsystem: "edgar-xbrl",
    severity: "P2",
    summary: "Revenue moved across three us-gaap tags at the ASC 606 transition.",
    lesson: "One economic quantity was assumed to keep one identifier across time.",
    category: "PROVIDER_ASSUMPTION",
  },
  {
    id: "SF-01",
    ledger: "SECURITY_FINDING",
    subsystem: "askMarket guardrail",
    severity: "P1",
    summary: "49 phrasings requesting personalized advice passed the guardrail.",
    lesson:
      "A rule was expressed in one language, word order or format and not mirrored in the others.",
    category: "GUARDRAIL_COVERAGE",
  },
  {
    id: "SF-02",
    ledger: "SECURITY_FINDING",
    subsystem: "auth",
    severity: "P1",
    summary: "validateSession returned the whole User row including passwordHash.",
    lesson:
      "A query selected everything by default, so a sensitive column crossed a trust boundary " +
      "nobody had reviewed.",
    category: "PROVENANCE",
  },
  {
    id: "SF-03",
    ledger: "SECURITY_FINDING",
    subsystem: "admin",
    severity: "P2",
    summary: "/admin required only that a user be signed in.",
    lesson: "Authentication was accepted as authorization.",
    category: "GUARDRAIL_COVERAGE",
  },
  {
    id: "SF-04",
    ledger: "SECURITY_FINDING",
    subsystem: "watchlist",
    severity: "P1",
    summary: "The domain module had zero callers, so isolation was never exercised.",
    lesson: "A helper was tested while the request path that would actually use it did not exist.",
    category: "GUARDRAIL_COVERAGE",
  },
  {
    id: "FG-07",
    ledger: "FALSE_GREEN",
    subsystem: "adapters",
    severity: "P1",
    summary: "FRED, ECOS and DART each treated page one as the whole answer.",
    lesson:
      "A partial result was returned as success, with the field stating otherwise received and " +
      "ignored.",
    category: "SILENT_DEGRADATION",
  },
  {
    id: "FG-08",
    ledger: "FALSE_GREEN",
    subsystem: "seriesReadings",
    severity: "P2",
    summary: "unit === 'percent' is case sensitive, so a 'Percent' typo disables basis points.",
    lesson: "A capability degraded to silence instead of failing when its precondition was unmet.",
    category: "SILENT_DEGRADATION",
  },
  {
    id: "FG-09",
    ledger: "FALSE_GREEN",
    subsystem: "companyXray",
    severity: "P2",
    summary: "Reported COMPLETE although the provider had stated no total to compare against.",
    lesson: "An absence of contradicting evidence was reported as positive confirmation.",
    category: "SILENT_DEGRADATION",
  },
  {
    id: "EN-01",
    ledger: "INCIDENT",
    subsystem: "test harness",
    severity: "P2",
    summary: "The H1 migration regression test never ran on Windows.",
    lesson: "A test failed to start in one environment and reported nothing in the other.",
    category: "ENVIRONMENT_DRIFT",
  },
  {
    id: "EN-02",
    ledger: "INCIDENT",
    subsystem: "scripts",
    severity: "P2",
    summary: "run-ingest-jobs spawned `npm`, which is npm.cmd on Windows.",
    lesson:
      "A cross-platform assumption held on the development machine and failed silently elsewhere.",
    category: "ENVIRONMENT_DRIFT",
  },
  {
    id: "CC-01",
    ledger: "REVIEW_FINDING",
    subsystem: "eventIngest",
    severity: "P1",
    summary: "Four concurrent ingests of one URL rejected three with a raw P2002.",
    lesson: "A read-then-write sequence was treated as atomic.",
    category: "CONCURRENCY",
  },
  {
    id: "CC-02",
    ledger: "REVIEW_FINDING",
    subsystem: "eventIngest",
    severity: "P1",
    summary: "Event and its first EventMention were written non-atomically.",
    lesson: "A parent and its required child were written outside one transaction.",
    category: "CONCURRENCY",
  },
  {
    id: "CC-03",
    ledger: "SECURITY_FINDING",
    subsystem: "watchlist",
    severity: "P2",
    summary: "An upsert could surface a raw P2002 under concurrent submission.",
    lesson:
      "A uniqueness violation reached the caller as a database error rather than a handled " +
      "outcome, because the write assumed it was the only one in flight.",
    category: "CONCURRENCY",
  },
  {
    id: "CC-04",
    ledger: "REVIEW_FINDING",
    subsystem: "observationIngest",
    severity: "P1",
    summary: "Attaching a revision retried 20 times then threw a raw P2002.",
    lesson:
      "A retry loop was used to paper over a read-then-write race instead of removing the race.",
    category: "CONCURRENCY",
  },

  // Added after an independent audit of this ledger (`gpt-5.6-luna`) found documented defects
  // that had no entry. A ledger with gaps under-counts exactly the clusters it exists to find,
  // so completeness of the RECORD matters as much as accuracy of each row.
  {
    id: "SF-05",
    ledger: "SECURITY_FINDING",
    subsystem: "auth",
    severity: "P2",
    summary: "Login lockout is keyed on email and checked before the password is verified.",
    lesson:
      "A control aimed at one threat created a second one, because the key it locks on is " +
      "attacker-supplied.",
    category: "GUARDRAIL_COVERAGE",
  },
  {
    id: "SF-06",
    ledger: "SECURITY_FINDING",
    subsystem: "ingestRun / redactSecrets",
    severity: "P1",
    summary: "Provider API keys could reach ingest_runs.error, which /admin renders.",
    lesson:
      "A secret was redacted at the point of display but not at the point of persistence, so it " +
      "was written down before anything tried to hide it.",
    category: "PROVENANCE",
  },
  {
    id: "EN-03",
    ledger: "REVIEW_FINDING",
    subsystem: "testDatabaseGuard",
    severity: "P2",
    summary:
      "localhost and 127.0.0.1 compared as different hosts, defeating the same-target check.",
    lesson:
      "A safety comparison was made on surface text rather than on what the text resolves to.",
    category: "ENVIRONMENT_DRIFT",
  },
  {
    id: "PD-05",
    ledger: "PROVIDER_DRIFT",
    subsystem: "dart / edgar normalize",
    severity: "P2",
    summary: "An impossible date such as 20260230 would silently roll forward to 2 March.",
    lesson:
      "A format check was mistaken for a validity check, so a well-shaped but non-existent value " +
      "was accepted and quietly changed.",
    category: "PROVIDER_ASSUMPTION",
  },

  // The SEMANTIC_RECENCY cluster, added while designing the provider-vintage contract. Both
  // entries predate the contract and neither was recognised as the same cause at the time, which
  // is precisely the kind of connection the detector exists to make.
  {
    id: "SR-01",
    ledger: "REVIEW_FINDING",
    subsystem: "observationIngest",
    severity: "P1",
    summary: "A replayed stale value became the current reading because it arrived last.",
    lesson:
      "Which version of a value is current was decided by ingest order, because the provider " +
      "publishes no vintage and arrival time was the only ordering evidence on hand.",
    category: "SEMANTIC_RECENCY",
  },
  {
    id: "SR-02",
    ledger: "INCIDENT",
    subsystem: "e2e / dev server",
    severity: "P2",
    summary: "An E2E pass was reported from a server process started before the fix under test.",
    lesson:
      "A fresh result was taken as evidence about fresh code, without establishing that the " +
      "process producing it was running that code.",
    category: "SEMANTIC_RECENCY",
  },

  // Added after a bounded ledger-completeness audit (`gpt-5.6-luna`, 2026-08-18) found eight
  // documented defects with no entry — every one of them a defect in VERIFY ITSELF, found while
  // building the layer whose job is finding defects. That is not an embarrassment to bury; it is
  // the most direct evidence the ledger has that a verifier is not exempt from the failure modes
  // it verifies against. Luna checked all 28 existing entries and found zero fabrications.
  {
    id: "VF-01",
    ledger: "FALSE_GREEN",
    subsystem: "verify/evaluate",
    severity: "P0",
    summary: "A CALCULATION carrying no calculation returned VERIFIED.",
    lesson:
      "Every calculation-shaped dimension returned NOT_APPLICABLE for an empty input, nothing " +
      "failed, and the absence of a subject read as a clean subject.",
    category: "FIXTURE_REALISM",
  },
  {
    id: "VF-02",
    ledger: "REVIEW_FINDING",
    subsystem: "verify/types",
    severity: "P0",
    summary: "CalculationInput had no entity identifier at all.",
    lesson:
      "A comparison between two different companies was not merely unchecked but unrepresentable, " +
      "and a field that does not exist cannot be checked by any amount of logic downstream.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "VF-03",
    ledger: "REVIEW_FINDING",
    subsystem: "verify/evaluate",
    severity: "P1",
    summary: "Verdict precedence let a truncation failure speak for an incorrect calculation.",
    lesson:
      "A coverage failure outranked a correctness failure, so a fabricated number was reported " +
      "as a data-coverage task.",
    category: "SILENT_DEGRADATION",
  },
  {
    id: "VF-04",
    ledger: "REVIEW_FINDING",
    subsystem: "verify/evaluate",
    severity: "P1",
    summary: "Two unnamed quantities passed the concept check by skipping it.",
    lesson: "An optional field made its own check optional, so absence of data read as agreement.",
    category: "GUARDRAIL_COVERAGE",
  },
  {
    id: "VF-05",
    ledger: "REVIEW_FINDING",
    subsystem: "verify/evaluate",
    severity: "P1",
    summary: "A purely relative percent epsilon rejected a correct +0.0000049% change.",
    lesson:
      "A tolerance scaled to the magnitude of the value ignored the fixed rounding already " +
      "applied at storage, so it vanished exactly where the value was smallest.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "VF-06",
    ledger: "REVIEW_FINDING",
    subsystem: "verify/evaluate",
    severity: "P1",
    summary:
      "Refusing every concept change made a legitimate ASC 606 reconciliation unrepresentable.",
    lesson:
      "A rule written against one real defect forbade the correct case as well, because the " +
      "difference between them was never given a way to be expressed.",
    category: "GUARDRAIL_COVERAGE",
  },
  {
    id: "VF-07",
    ledger: "FALSE_GREEN",
    subsystem: "filingDiff / companyXray",
    severity: "P1",
    summary: "A same-day amendment displayed the original under a banner asserting it was amended.",
    lesson:
      "Two call sites derived 'which row is current' independently, so two individually correct " +
      "changes combined into a false statement about a financial figure.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "VF-08",
    ledger: "REVIEW_FINDING",
    subsystem: "companyXray",
    severity: "P1",
    summary: "Completeness could flip between COMPLETE and KNOWN_INCOMPLETE across requests.",
    lesson:
      "'Most recent run per target' was resolved with an ordering the database was free to break " +
      "ties in, so the same data answered differently on different reads.",
    category: "IDENTITY_MODELLING",
  },

  // From the independent review of the shadow layers (`gpt-5.6-terra`, 2026-08-18). Both land in
  // clusters that already existed, which is the detector working rather than a new category.
  {
    id: "RF-04",
    ledger: "REVIEW_FINDING",
    subsystem: "verify/fromSeriesChange + fabric/shadowProjection",
    severity: "P1",
    summary:
      "Both call sites promoted a stored releaseDate to KNOWN evidence for providers whose " +
      "release semantics have never been observed.",
    lesson:
      "A rule duplicated across two readers was wrong in both places at once, so correcting " +
      "either copy would have left the defect live in the other.",
    category: "IDENTITY_MODELLING",
  },
  {
    id: "GC-01",
    ledger: "REVIEW_FINDING",
    subsystem: "governance/policy",
    severity: "P1",
    summary:
      "observeExecution refused to record a DENIED action as EXECUTED but accepted a " +
      "conditionally-permitted one with the condition unmentioned.",
    lesson:
      "A guard was written for the obvious violation and stopped one step short of the adjacent " +
      "one, which shares its shape exactly.",
    category: "GUARDRAIL_COVERAGE",
  },

  {
    id: "SD-01",
    ledger: "REVIEW_FINDING",
    subsystem: "fred / ecos / dart clients",
    severity: "P1",
    summary:
      "All three adapters stopped on a short page and reported the partial result as complete.",
    lesson:
      "The reason a loop stopped was used as the answer to whether everything was held, and the " +
      "provider-declared total that contradicted it was received and never consulted.",
    category: "SILENT_DEGRADATION",
  },

  {
    id: "GC-02",
    ledger: "SECURITY_FINDING",
    subsystem: "askMarket guardrail",
    severity: "P1",
    summary:
      "The entire long/short position vocabulary was missing, in both languages, while the same " +
      "intent phrased as buy or sell was caught by four separate patterns.",
    lesson:
      "The guardrail enumerated PHRASINGS of concepts it had thought of, and a concept nobody " +
      "listed was covered by nothing at all.",
    category: "GUARDRAIL_COVERAGE",
  },

  {
    id: "RF-05",
    ledger: "REVIEW_FINDING",
    subsystem: "companyXray / company routes / verify shadowRun",
    severity: "P1",
    summary:
      "A corp code resolved its own provider by taking the most recent filing that carried it, " +
      "so a second company sharing the code was unreachable.",
    lesson:
      "Scoping the QUERIES to one provider fixed the pooling and left the CHOICE of provider " +
      "unexamined, so the same identity defect survived one layer up in the routing.",
    category: "IDENTITY_MODELLING",
  },

  {
    id: "RF-06",
    ledger: "REVIEW_FINDING",
    subsystem: "askMarket",
    severity: "P2",
    summary:
      "Two orderings select a company and its figures on columns that tie, in the one read path " +
      "the periodEnd fix was never applied to.",
    lesson:
      "A defect fixed in two places was left in a third, because the fix was applied where the " +
      "defect had been SEEN rather than everywhere the same pattern was written.",
    category: "IDENTITY_MODELLING",
  },

  {
    id: "GC-03",
    ledger: "SECURITY_FINDING",
    subsystem: "askMarket guardrail",
    severity: "P1",
    summary:
      "Eight whole concepts had nothing covering them: leverage, margin, options, averaging " +
      "down, third-party requests in Korean, hypothetical framing, timing without a verb, and " +
      "portfolio construction.",
    lesson:
      "Probing for PHRASINGS finds phrasings; only probing for CONCEPTS finds a concept nobody " +
      "ever listed, and eighteen direct instructions went through because of it.",
    category: "GUARDRAIL_COVERAGE",
  },

  {
    id: "GC-10",
    ledger: "REVIEW_FINDING",
    subsystem: "verify / advice scanner",
    severity: "P2",
    summary:
      "Every pattern in the output-side advice scanner was second-person, so 'Investors should " +
      "buy long-duration bonds now' verified clean.",
    lesson:
      "The guardrail was written in the grammar of the person writing it, not the grammar of the " +
      "text it screens — financial prose recommends in the third person almost exclusively.",
    category: "GUARDRAIL_COVERAGE",
  },

  {
    id: "GC-11",
    ledger: "REVIEW_FINDING",
    subsystem: "verify / advice scanner",
    severity: "P2",
    summary:
      "The Korean advice patterns flagged the product's own refusal, because 매수 추천 sits " +
      "unchanged inside 매수 추천을 제공하지 않습니다.",
    lesson:
      "Negation-safety was designed in by requiring affirmative English constructions, and that " +
      "design does not survive translation into a predicate-final language.",
    category: "GUARDRAIL_COVERAGE",
  },

  {
    id: "GC-12",
    ledger: "REVIEW_FINDING",
    subsystem: "governance / escalation",
    severity: "P1",
    summary:
      "Posting to the public escalation issue — the only action that sends data off this machine " +
      "— had no ActionKind, consulted no policy and screened no content.",
    lesson:
      "A Record<Kind, Rule> proves the table covers every kind and says nothing about whether the " +
      "kinds cover the system; the uncovered action is invisible rather than missing.",
    category: "GUARDRAIL_COVERAGE",
  },

  {
    id: "CC-05",
    ledger: "REVIEW_FINDING",
    subsystem: "auth",
    severity: "P2",
    summary:
      "Concurrent signup with one email creates exactly one account, and hands the losers a raw " +
      "P2002 instead of the AuthError the sequential path produces.",
    lesson:
      "The constraint was added and the HANDLER was not, so the race was made safe without being " +
      "made presentable — the third time this exact pair has come apart.",
    category: "CONCURRENCY",
  },

  {
    id: "PV-01",
    ledger: "REVIEW_FINDING",
    subsystem: "askMarket / ask page",
    severity: "P2",
    summary:
      "A causal claim is rendered with its confidence and its counterexamples, and without the " +
      "evidence field the schema requires for exactly that purpose.",
    lesson:
      "Two fields were made mandatory for the same reason and only one was carried to the page, " +
      "so the claim shows what limits it and not what supports it.",
    category: "PROVENANCE",
  },

  {
    id: "SD-02",
    ledger: "REVIEW_FINDING",
    subsystem: "edgar/client",
    severity: "P1",
    summary:
      "EDGAR derived truncation from its own page cap, so holding 101 of a declared 501 filings " +
      "was reported as a complete ingest.",
    lesson:
      "IR-030 named three clients and the fix went to those three; the fourth had the identical " +
      "line and was never looked at, because the fix followed the finding rather than the pattern.",
    category: "SILENT_DEGRADATION",
  },

  {
    id: "EN-04",
    ledger: "INCIDENT",
    subsystem: "test harness / watchlist-actions",
    severity: "P2",
    summary:
      "A beforeAll timeout left ids unset, and the afterAll that dereferenced them threw the " +
      "error that got reported, hiding the cause through eight reruns.",
    lesson:
      "A teardown that can itself fail reports ITS error instead of the one that matters, so the " +
      "cheapest diagnostic improvement is making cleanup tolerant of a setup that never ran.",
    category: "ENVIRONMENT_DRIFT",
  },

  {
    id: "MC-03",
    ledger: "PREDICTION_ERROR",
    subsystem: "analysis tooling",
    severity: "P2",
    summary:
      "An enumeration script written through a shell heredoc had every word-boundary regex " +
      "collapsed to a backspace character, and reported a confident list of fields that were not " +
      "missing at all.",
    lesson:
      "A script's output is a claim, not evidence. This one was caught only because it " +
      "contradicted something already known, not because it looked wrong.",
    category: "EVIDENCE_FABRICATION",
  },

  // The EVIDENCE_FABRICATION cluster. Both are review-process failures rather than product
  // defects, and they belong here for the same reason the others do: they recur.
  {
    id: "MC-01",
    ledger: "PREDICTION_ERROR",
    subsystem: "review / gpt-5.6-sol",
    severity: "P2",
    summary:
      "A reviewer reported a P1 as reproduced against the real database, quoting an output it " +
      "had never produced.",
    lesson:
      "A claim of reproduction was formatted identically to a real one, so only re-running the " +
      "code separated them. Reviewer confidence carries no evidential weight of its own.",
    category: "EVIDENCE_FABRICATION",
  },
  {
    id: "MC-02",
    ledger: "PREDICTION_ERROR",
    subsystem: "review / local models",
    severity: "P2",
    summary:
      "Four local-model findings, none valid; one stated the same behaviour as both expected " +
      "and observed.",
    lesson:
      "Fluent defect reports were produced with no reference to the code shown, and the blind " +
      "calibration harness rather than the reports themselves is what revealed it.",
    category: "EVIDENCE_FABRICATION",
  },
];
