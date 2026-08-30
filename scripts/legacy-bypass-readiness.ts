/**
 * What does `LEGACY_BYPASS` actually carry, and is any of it a safety divergence?
 *
 * IR-107. `InferenceAuthorization` admits two provenances: `CANONICAL`, where the operation parser
 * recognised the whole request and its parse travels, and `LEGACY_BYPASS`, where the legacy frame
 * classifier admitted a request the canonical parser refuses. The bypass is labelled rather than
 * hidden precisely so its closure can be a deletion instead of another migration.
 *
 * ## The previous version of this script produced an invalid number, and it was believed
 *
 * It reported `0 safety exposures / 13 legitimate recognition gaps`, and that figure was carried
 * into three escalation packets as fact. Independent review found it unsound and reproducing the
 * complaint found it worse than reported:
 *
 *   DENOMINATOR. It regex-scraped the corpus source instead of importing it. The character class
 *   `[^"'`\n]` excludes any query containing an apostrophe, so `What will Apple's revenue be next
 *   quarter?` and 46 others were silently dropped — 47 typed cases absent, while the scrape's own
 *   count of 493 was padded by strings that are not corpus queries at all. The bias was systematic,
 *   not random: it removed possessives and contractions, which is most of natural English.
 *
 *   CLASSIFICATION. It never read `expected`, `operation`, `language` or `id` — grep found zero
 *   references. Every bypass whose canonical status was UNSUPPORTED became `LOSS`, i.e. "legitimate
 *   recognition gap". But UNSUPPORTED does not mean the corpus wanted the request answered. A
 *   NEGATIVE CONTROL that the parser refuses and the bypass admits looks identical in that bucket,
 *   and that is a safety exposure being counted as throughput.
 *
 * So the corpus is now imported, the denominator is asserted, and every bypass is classified by
 * what the corpus SAYS the request is, not by what the parser happened to return.
 *
 * ## A class must be measured at the door, not inferred from provenance
 *
 * The first corrected draft of this script still assigned `FALSE_ELIGIBILITY_EXPOSURE` from corpus
 * `expected` plus provenance. Reproducing those rows refuted it. `How does the unemployment rate
 * work with inflation?` is admitted by the frame classifier, but the legacy envelope then refuses
 * it -- "the question names both variables but no construction in it establishes which acts on
 * which" -- and no planner call happens. Eligibility being wrong is real, and it is not the same
 * thing as a refused request reaching a model.
 *
 * So the safety class is now taken from a real `answerWithInference` run with a counting sink, and
 * a bypass the door refuses downstream is reported as `REFUSED_DOWNSTREAM`: an eligibility
 * divergence worth closing, but not an exposure.
 *
 * A measurement over an EMPTY repository cannot tell refusal from an empty shelf, so the script
 * says so rather than printing a reassuring zero. The reproduction that established the above used
 * a seeded fixture whose control query resolved AUTHORIZED with a real stored edge, which is what
 * makes its zeros mean something.
 *
 * ## Planner calls are not the success metric
 *
 * A request whose expected operation is deterministic — DEFINITION, CURRENT_OBSERVATION,
 * OBSERVED_CHANGE — should end with the canonical parser recognising it and `plannerPermitted`
 * false, i.e. ZERO model calls. Preserving a legacy planner call for such a request is not
 * capability, it is the deterministic path being bypassed. `DETERMINISTIC_VIA_PLANNER` names that
 * separately so it can never be counted as recognition throughput again.
 *
 *   npx tsx scripts/legacy-bypass-readiness.ts [--rows]
 */

import {
  REQUEST_DEVELOPMENT_CORPUS,
  type DevelopmentCase,
} from "../tests/fixtures/requestDevelopmentCorpus";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { nameOccursIn } from "@/server/domain/subjectAuthority";
import {
  resolveRequestAuthority,
  asPlannerRequest,
  OPERATION_CONTRACTS,
} from "@/server/domain/requestAuthority";

/** The corpus's own declared size. A different number means the fixture changed under this script. */
const CANONICAL_DENOMINATOR = 500;

/**
 * Operations where a planner call is a defect rather than throughput, DERIVED from the contracts.
 *
 * This was a literal set of three names, and review pointed out that a duplicated list can drift
 * away from the contracts it is supposed to mirror without anything failing. `plannerPermitted` is
 * the property that actually decides it, so it is read rather than restated: an operation the
 * planner may not see should be answered deterministically, and a planner call for one means the
 * wrong door answered.
 */
const DETERMINISTIC_OPERATIONS = new Set(
  Object.entries(OPERATION_CONTRACTS)
    .filter(([, contract]) => !contract.plannerPermitted)
    .map(([operation]) => operation),
);

type BypassClass =
  /** Should have been refused, and a real run DID call the planner. The only safety exposure. */
  | "FALSE_ELIGIBILITY_EXPOSURE"
  /** Should have been refused; a real run with evidence available did not reach the planner. */
  | "REFUSED_DOWNSTREAM"
  /**
   * Nothing was proven. The probe threw before any call could be observed, or no candidate
   * evidence existed for this row so a zero cannot be told apart from an empty shelf.
   *
   * Its own class because review found the previous version folding it into REFUSED_DOWNSTREAM,
   * where a reader of the five headline counts could not tell a measured refusal from a
   * measurement failure.
   */
  | "PROBE_INCONCLUSIVE"
  /** Deterministic operation, and a planner call really happened: the wrong door answered. */
  | "DETERMINISTIC_VIA_PLANNER"
  /** Deterministic operation the canonical parser cannot read, and no planner call either. */
  | "DETERMINISTIC_NOT_RECOGNISED"
  /** Genuinely answerable, non-deterministic, canonical cannot read it. Real recognition debt. */
  | "TRUE_RECOGNITION_GAP";

interface Row {
  id: string;
  language: string;
  query: string;
  expected: string;
  expectedOperation: string;
  canonicalStatus: string;
  canonicalOperation: string;
  eligible: boolean;
  frame: string;
  provenance: string;
  plannerPermitted: boolean | null;
  /** Measured: did a real `answerWithInference` run call the sink? null when not probed. */
  plannerCalled: boolean | null;
  legacyStatus: string | null;
  /**
   * Did the repository hold ANY stored name this request mentions?
   *
   * Asked of the repository directly, not read off this row's envelope. A refusal BY RULE -- an
   * ambiguous cardinality, an unproven direction -- returns empty id arrays by contract, so
   * inferring "no evidence" from an empty envelope marked exactly the safety-relevant rows
   * permanently inconclusive: seeding could never clear them. Checking the shelf separately means a
   * no-call over a populated shelf is a real refusal, and seeding moves a row from unmeasured to
   * measured, which is what a fail-closed default should allow.
   */
  evidenceBacked: boolean;
  klass: BypassClass | null;
}

/**
 * `plannerCalled` is the measured outcome of a real run, or null when no door probe was possible.
 * Passing it in rather than reading it here keeps the pure classification testable on its own.
 */
export function classify(
  expected: string,
  expectedOperation: string,
  canonicalStatus: string,
  plannerCalled: boolean | null,
  evidenceBacked: boolean,
): BypassClass {
  // Nothing is claimed from an unobserved run. `plannerCalled === null` means the probe threw
  // before an answer existed; `!evidenceBacked` means the repository held nothing this row could
  // have been answered from, so a zero says as much about the fixtures as about the code.
  if (plannerCalled === null) return "PROBE_INCONCLUSIVE";

  // Canonical PROHIBITED/AMBIGUOUS joins the corpus's own REFUSED rather than overriding the
  // measurement. Review was right that precedence-by-status contradicted the printed definition:
  // it let a row with no planner call be counted under "can still reach a planner".
  const shouldRefuse =
    expected === "REFUSED" || canonicalStatus === "PROHIBITED" || canonicalStatus === "AMBIGUOUS";

  if (shouldRefuse) {
    if (plannerCalled) return "FALSE_ELIGIBILITY_EXPOSURE";
    // A refusal is only PROVEN when the row had something to be answered from.
    return evidenceBacked ? "REFUSED_DOWNSTREAM" : "PROBE_INCONCLUSIVE";
  }

  if (DETERMINISTIC_OPERATIONS.has(expectedOperation)) {
    return plannerCalled ? "DETERMINISTIC_VIA_PLANNER" : "DETERMINISTIC_NOT_RECOGNISED";
  }
  return "TRUE_RECOGNITION_GAP";
}

/**
 * Run something that may call a sink and may then fail, and report BOTH facts.
 *
 * Extracted and exported because the bug it fixes is invisible from outside: the sink incremented a
 * counter, the pipeline threw afterwards, and the catch returned `null` — discarding the proof that
 * a call had already happened. A refused request that reached the model was recorded as unproven.
 * That is the same "a zero from a crash is not a zero" defect this whole measurement exists to
 * correct, rebuilt one layer down, and only a test that calls-then-throws can see it.
 */
export async function countCallsDespiteFailure(
  run: (sink: () => Promise<void>) => Promise<unknown>,
): Promise<{ called: boolean; threw: string | null }> {
  let called = 0;
  try {
    await run(async () => {
      called += 1;
    });
    return { called: called > 0, threw: null };
  } catch (error) {
    // The count survives the throw. That is the entire point.
    return { called: called > 0, threw: (error as Error).message.slice(0, 80) };
  }
}

export async function measure(corpus: readonly DevelopmentCase[]): Promise<Row[]> {
  const rows: Row[] = [];
  // Loaded once, kept apart by kind: sufficiency differs by operation.
  const shelf = await loadShelf();
  for (const c of corpus) {
    const canonical = resolveRequestAuthority(c.query);
    const authorization = authorizeInference(c.query);
    const base = {
      id: c.id,
      language: c.language,
      query: c.query,
      expected: c.expected,
      expectedOperation: c.operation,
      canonicalStatus: canonical.status,
      canonicalOperation: canonical.status === "AUTHORIZED" ? canonical.operation : "-",
      eligible: authorization.eligible,
      frame: authorization.eligible ? authorization.frame : "-",
      provenance: authorization.eligible ? authorization.provenance : "-",
      plannerPermitted:
        authorization.eligible && authorization.provenance === "CANONICAL"
          ? asPlannerRequest(authorization.request) !== null
          : null,
    };
    const isBypass = base.eligible && base.provenance === "LEGACY_BYPASS";
    if (!isBypass) {
      rows.push({
        ...base,
        plannerCalled: null,
        legacyStatus: null,
        evidenceBacked: false,
        klass: null,
      });
      continue;
    }
    const probed = await probeDoor(c.query, c.operation, shelf);
    rows.push({
      ...base,
      plannerCalled: probed.called,
      legacyStatus: probed.legacyStatus,
      evidenceBacked: probed.evidenceBacked,
      klass: classify(
        c.expected,
        c.operation,
        base.canonicalStatus,
        probed.called,
        probed.evidenceBacked,
      ),
    });
  }
  return rows;
}

/**
 * One real trip through the production door, counting model calls.
 *
 * A thrown sink is reported as thrown rather than as zero calls -- the previous measurement printed
 * `calls=0` from a stub whose method name was wrong, and the zero read as safety.
 */
/**
 * What the repository holds, in ANSWER-BEARING form.
 *
 * Not a list of names. Review found the previous shape letting a `Series` row with no observations
 * count as evidence for a current-observation request, and letting an unrelated provider and an
 * unrelated series together count as evidence for an attributed one — which is precisely the
 * independence-versus-connection confusion B2-C existed to fix, reappearing in the measurement.
 */
interface Shelf {
  /** Series carrying at least one observation. A metadata row answers nothing. */
  observedSeries: string[];
  /**
   * Series with at least TWO observations, i.e. enough to establish a cadence.
   *
   * This product decides currentness from the interval between period ends, so a series that has
   * reported once cannot be shown to be current -- unknown is not fresh. Sufficiency for a
   * current-observation request therefore needs two, not one.
   *
   * TWO DISTINCT DATES, not two rows. Observations carry revisions, so two rows can be the same
   * `observationDate`, and `getObservationsOneRowPerDate` resolves exactly that before any cadence
   * is derived. Counting rows would let two revisions of one period masquerade as a cadence --
   * review's counterexample, and the seventh version of the same mistake in this file: a proxy that
   * counts something adjacent to the thing that matters.
   */
  currentableSeries: string[];
  /** Provider-owned series, as pairs, so attribution needs the connection and not two coincidences. */
  attributed: { provider: string; series: string }[];
  edges: { from: string; to: string }[];
}

/**
 * Series with at least two DISTINCT observation dates, i.e. a cadence can be derived.
 *
 * Pure, and exported, so the revision counterexample can be tested without a database: two rows
 * sharing one `observationDate` are two revisions of a single period and establish no interval.
 * `getObservationsOneRowPerDate` collapses them in production before cadence is computed, and this
 * mirrors that rule rather than approximating it with a row count.
 */
export function withDerivableCadence(
  series: readonly { name: string; dates: readonly number[] }[],
): string[] {
  return series.filter((s) => new Set(s.dates).size > 1).map((s) => s.name);
}

async function loadShelf(): Promise<Shelf> {
  const { prisma } = await import("@/server/db/client");
  const [series, edges] = await Promise.all([
    prisma.series.findMany({
      select: {
        name: true,
        source: { select: { name: true } },
        observations: { select: { observationDate: true } },
      },
    }),
    prisma.causalEdge.findMany({ select: { fromVariable: true, toVariable: true } }),
  ]);
  const answerBearing = series.filter((s) => s.observations.length > 0);
  return {
    observedSeries: answerBearing.map((s) => s.name),
    currentableSeries: withDerivableCadence(
      series.map((s) => ({
        name: s.name,
        dates: s.observations.map((o) => o.observationDate.getTime()),
      })),
    ),
    attributed: answerBearing.map((s) => ({ provider: s.source.name, series: s.name })),
    edges: edges.map((e) => ({ from: e.fromVariable, to: e.toVariable })),
  };
}

/**
 * Could this row have been answered at all, given what the repository holds?
 *
 * OPERATION-AWARE, and fail-closed when the answer cannot be established. The previous version
 * asked only whether ANY stored name occurred in the query, and review showed that is far too weak:
 * a mechanism request needs an exact directed edge between the two endpoints it names, and a series
 * that happens to share one of those names says nothing about whether the row was answerable.
 *
 * The proxy mattered because it decides REFUSED_DOWNSTREAM versus PROBE_INCONCLUSIVE — that is, it
 * decides whether a zero counts as a measured refusal or as nothing proven. Too weak, and an
 * evidence-starved no-call is promoted to a clean measurement and the headline goes conclusive.
 *
 * My own demonstration of the previous fix was exactly that failure: four seeded SERIES and no
 * edges, and both mechanism-shaped controls were nonetheless called evidence-backed.
 */
export function evidenceSufficient(
  expectedOperation: string,
  query: string,
  shelf: Shelf,
  occurs: (name: string, query: string) => boolean,
): boolean {
  switch (expectedOperation) {
    // A relation needs a stored edge whose BOTH endpoints this request names. One endpoint, or an
    // unrelated edge sharing a name, could never have answered it.
    case "STORED_MECHANISM":
    case "AMBIGUOUS_CARDINALITY":
      return shelf.edges.some((e) => occurs(e.from, query) && occurs(e.to, query));

    // A named series with enough readings to be CURRENT. One observation is not enough: this
    // product derives freshness from the cadence between period ends, and a series that has
    // reported once has no derivable cadence -- "unknown is not fresh" is the rule the company
    // path already states. Counting a single reading would repeat, one layer down, the same
    // too-loose proxy that let a metadata-only series look answerable.
    case "CURRENT_OBSERVATION":
      return shelf.currentableSeries.some((name) => occurs(name, query));

    // The provider must OWN the series. Finding a provider and a series independently proves only
    // that two rows exist -- the same independence-versus-connection error B2-C was about.
    case "ATTRIBUTED_REPORTED_OBSERVATION":
      return shelf.attributed.some((a) => occurs(a.provider, query) && occurs(a.series, query));

    // STRUCTURALLY UNANSWERABLE, and reported as such rather than as a measured refusal.
    //
    // These negative-control labels name what the request LACKS: no interval, no attribution, no
    // definition record class in this repository at all. No repository state can satisfy them, so
    // a no-call is structural. Review pointed out it was inconsistent to declare that a limitation
    // for one under-specified row and quietly require the impossible of these.
    // OBSERVED_CHANGE joins them, and the reason is specific rather than defeatist. A computed
    // change needs usable readings at BOTH boundaries of the requested interval, and the interval
    // is exactly what a refused row does not have -- the parser declined to authorize one, so there
    // is nothing to check coverage against. Review found the previous mapping treating one
    // observation as sufficient, which could promote an unanswerable row to a measured refusal and
    // let the headline go conclusive. Asserting less is the only honest option here.
    case "OBSERVED_CHANGE":
    case "MISSING_INTERVAL":
    case "MISSING_ATTRIBUTION":
    case "DEFINITION":
      return false;

    default:
      // FAIL CLOSED. An operation whose sufficiency this script cannot state is not evidence, and
      // the row stays PROBE_INCONCLUSIVE rather than being promoted on a guess.
      return false;
  }
}

async function probeDoor(
  query: string,
  expectedOperation: string,
  shelf: Shelf,
): Promise<{ called: boolean | null; legacyStatus: string; evidenceBacked: boolean }> {
  const { answerWithInference } = await import("@/server/domain/askMarketInference");
  const { deriveLegacyCandidateEnvelope } = await import("@/server/domain/candidateEnvelope");
  let legacyStatus = "-";
  let evidenceBacked = false;
  const outcome = await countCallsDespiteFailure(async (sink) => {
    const legacy = await deriveLegacyCandidateEnvelope(query);
    legacyStatus = legacy.status;
    // PER ROW, and from the SHELF rather than from this envelope -- see the field's own note.
    evidenceBacked = evidenceSufficient(expectedOperation, query, shelf, nameOccursIn);
    await answerWithInference(query, {
      generatePlan: async () => {
        await sink();
        return { segments: [] };
      },
    });
  });
  return {
    // A throw BEFORE any call is genuinely "no call observed"; a throw after one is still a call.
    called: outcome.threw !== null && !outcome.called ? null : outcome.called,
    legacyStatus: outcome.threw === null ? legacyStatus : `${legacyStatus} THREW ${outcome.threw}`,
    evidenceBacked,
  };
}

async function main() {
  const corpus = REQUEST_DEVELOPMENT_CORPUS;
  if (corpus.length !== CANONICAL_DENOMINATOR) {
    // FAIL CLOSED. A readiness number computed over an unknown denominator is the defect this
    // script was rewritten to remove; it must not be silently recomputed over a different one.
    console.error(
      `DENOMINATOR MISMATCH: corpus has ${corpus.length} cases, expected ${CANONICAL_DENOMINATOR}. ` +
        "Refusing to report a readiness metric over an unverified denominator.",
    );
    process.exit(2);
  }

  const rows = await measure(corpus);
  const bypasses = rows.filter((r) => r.klass !== null);
  const canonicalRows = rows.filter((r) => r.eligible && r.provenance === "CANONICAL");
  const eligible = rows.filter((r) => r.eligible);

  console.log(`development corpus: ${corpus.length} cases (denominator asserted)`);
  console.log(`  blocked before a planner : ${rows.length - eligible.length}`);
  console.log(`  eligible                 : ${eligible.length}`);
  console.log(
    `    CANONICAL              : ${canonicalRows.length}` +
      (eligible.length > 0
        ? `  (${((canonicalRows.length / eligible.length) * 100).toFixed(1)}% throughput)`
        : ""),
  );
  console.log(`    LEGACY_BYPASS          : ${bypasses.length}`);

  const order: BypassClass[] = [
    "FALSE_ELIGIBILITY_EXPOSURE",
    "PROBE_INCONCLUSIVE",
    "REFUSED_DOWNSTREAM",
    "DETERMINISTIC_VIA_PLANNER",
    "DETERMINISTIC_NOT_RECOGNISED",
    "TRUE_RECOGNITION_GAP",
  ];
  console.log(`\nbypass classification:`);
  for (const klass of order) {
    const of = bypasses.filter((r) => r.klass === klass);
    console.log(`  ${klass.padEnd(28)} ${of.length}`);
    for (const r of of.slice(0, 6)) {
      console.log(
        `      ${r.id} [${r.language}] expected=${r.expected}/${r.expectedOperation} ` +
          `canonical=${r.canonicalStatus} legacy=${r.legacyStatus} plannerCalled=${r.plannerCalled}`,
      );
      console.log(`         ${JSON.stringify(r.query.slice(0, 88))}`);
    }
    if (of.length > 6) console.log(`      ... and ${of.length - 6} more`);
  }

  // The headline cannot be read as a clean bill while any safety-relevant row is unproven. Review
  // found the previous note both too weak (informational, and lost the moment a number is copied
  // into a packet) and too coarse (one AUTHORIZED row silenced it for all of them).
  const unsafe = bypasses.filter((r) => r.klass === "FALSE_ELIGIBILITY_EXPOSURE");
  const inconclusive = bypasses.filter((r) => r.klass === "PROBE_INCONCLUSIVE");
  // Labelled, never a bare total. Review: "that zero can still be copied as a total, exactly as
  // earlier numbers were" -- which is how the original 0/13 travelled into three packets. While any
  // safety-relevant row is unmeasured the number is a floor, and it has to say so in its own name,
  // because the caveat underneath is the part that gets left behind.
  const label =
    inconclusive.length > 0
      ? "OBSERVED EXPOSURES (LOWER BOUND — rows remain unmeasured)"
      : "SAFETY EXPOSURES (every bypass row measured)";
  console.log(`\n${label}: ${unsafe.length}`);
  console.log(
    `UNMEASURED POPULATION (probe threw, or the shelf held nothing so a zero proves nothing): ` +
      `${inconclusive.length}`,
  );
  console.log(
    `SEMANTIC DEBT (deterministic operation answered through the planner): ` +
      `${bypasses.filter((r) => r.klass === "DETERMINISTIC_VIA_PLANNER").length}`,
  );
  console.log(
    `RECOGNITION DEBT (corpus says answerable, canonical cannot read; repository answerability ` +
      `NOT demonstrated): ` +
      `${bypasses.filter((r) => r.klass === "TRUE_RECOGNITION_GAP").length}`,
  );
  if (inconclusive.length > 0) {
    console.log(
      `
VERDICT: INCONCLUSIVE — ${inconclusive.length} bypass row(s) proved nothing. The safety ` +
        `count above is a lower bound, not a clean bill. Seed fixtures for those rows and re-run.`,
    );
  } else {
    console.log(`
VERDICT: every bypass row was measured against real candidate evidence.`);
  }

  if (process.argv.includes("--rows")) {
    console.log(`\n--- machine-readable rows (JSONL) ---`);
    for (const r of bypasses) console.log(JSON.stringify(r));
  }
}

if (process.argv[1]?.includes("legacy-bypass-readiness")) void main();
