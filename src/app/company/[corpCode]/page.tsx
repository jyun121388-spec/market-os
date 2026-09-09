import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeCompanyXray, listCompanySources } from "@/server/domain/companyXray";
import {
  computeValuationScenarios,
  type MultipleInput,
  type ValuationScenario,
} from "@/server/domain/valuationScenario";
import { computeProfitability, type ProfitabilityRatio } from "@/server/domain/profitability";
import { filingSourceUrl } from "@/lib/filingSourceUrl";

export const dynamic = "force-dynamic";

/**
 * Company X-Ray (docs/ROADMAP.md M15, M16). Shows what a company reported and how it changed.
 *
 * No score, no rating, no valuation verdict, no price target, no suggested action
 * (docs/LEGAL_GUARDRAILS.md). Every figure here is a stored fact or a deterministic difference
 * between two stored facts, and each is labelled with the period it covers and the filing it
 * came from so the reader can check it.
 */
export default async function CompanyXrayPage({
  params,
  searchParams,
}: {
  params: Promise<{ corpCode: string }>;
  searchParams: Promise<{
    source?: string;
    peLow?: string;
    peBase?: string;
    peHigh?: string;
    psLow?: string;
    psBase?: string;
    psHigh?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { corpCode } = await params;
  const query = await searchParams;
  const { source } = query;

  // A corp code is unique only within the provider that issued it. This page used to take one and
  // show whichever provider's filing happened to be most recent, so a second company sharing the
  // code was unreachable and the choice was unstable between requests (IR-032). The provider now
  // travels in `?source=`, and where it is absent and the code is ambiguous the page ASKS rather
  // than picking — showing a wrong company under a right-looking header is the failure mode that
  // IR-001 and IR-002 were about.
  const sources = await listCompanySources(corpCode);
  if (sources.length === 0) {
    notFound();
  }
  if (!source && sources.length > 1) {
    return <SourceChoice corpCode={corpCode} sources={sources} />;
  }

  const xray = await computeCompanyXray(corpCode, source ?? sources[0]);
  if (!xray) {
    notFound();
  }

  const { company, latestFigures, changes, recentFilings, completeness } = xray;
  // Three tones, not two. UNCONFIRMED means the ingest reported no shortfall but the provider
  // stated no total to check against — worth reading, but not the same as a KNOWN shortfall or a
  // failed run, and dressing them alike would train a reader to ignore both.
  const completenessTone =
    completeness.status === "COMPLETE"
      ? "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
      : completeness.status === "UNCONFIRMED"
        ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200"
        : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
  const comparable = changes.filter((c) => c.status === "COMPUTED");
  const notComparable = changes.filter((c) => c.status !== "COMPUTED");

  // Multiples travel in the query string. They are the user's own assumption, they are not stored
  // anywhere, and there is nothing authoritative to prefill them with — the decision is explicit
  // that V1 defaults must be blank rather than a number the product invented.
  const valuation = computeValuationScenarios({
    figures: latestFigures,
    sourceCode: company.sourceCode,
    completeness,
    peMultiples: readMultiples(query.peLow, query.peBase, query.peHigh),
    psMultiples: readMultiples(query.psLow, query.psBase, query.psHigh),
  });

  const profitability = computeProfitability(latestFigures);

  // Every risk shown below is one an existing engine already PROVED. Nothing here reads prose,
  // infers a business risk, or ranks anything — the decision is explicit that no qualitative
  // risk family may be invented during productization, and the section says so in as many words
  // rather than leaving a reader to assume the list is exhaustive.
  const evidenceWarnings: { label: string; detail: string }[] = [];
  if (completeness.status !== "COMPLETE") {
    evidenceWarnings.push({
      label: `Data completeness: ${completeness.status}`,
      detail: completeness.detail,
    });
  }
  for (const c of changes) {
    if (c.currentIsRestatement || c.previousIsRestatement) {
      evidenceWarnings.push({
        label: `Restated figure: ${c.concept}`,
        detail:
          c.currentIsRestatement && c.previousIsRestatement
            ? "Both compared figures were superseded by a later filing."
            : c.currentIsRestatement
              ? "The current figure supersedes one already reported for the same period."
              : "The prior figure was superseded by a later filing.",
      });
    }
    if (c.periodLengthMismatch) {
      evidenceWarnings.push({
        label: `Unequal period lengths: ${c.concept}`,
        detail: `${c.previousPeriodDays} days compared against ${c.currentPeriodDays} days — the same month bucket, not the same duration.`,
      });
    }
  }
  for (const c of changes) {
    if (c.status !== "COMPUTED") {
      evidenceWarnings.push({
        label: `No comparable prior period: ${c.concept}`,
        detail: "Nothing on record covers a matching earlier period, so no change can be shown.",
      });
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{company.corpName}</h1>
          <p className="text-sm text-zinc-500">
            {company.sourceCode} · {company.corpCode}
            {company.stockCode ? ` · ${company.stockCode}` : ""} · {company.filingCount} filings
            {company.earliestFilingDate && company.latestFilingDate
              ? ` (${company.earliestFilingDate} → ${company.latestFilingDate})`
              : ""}
          </p>
        </div>
        <Link href="/company" className="shrink-0 text-sm font-medium underline">
          All companies
        </Link>
      </header>

      {/*
        This sentence changed when the scenario valuation landed, and it had to. It used to say
        "does not score, rate or value companies", and leaving that above a section that multiplies
        a reported figure by a multiple would have made the page's own disclaimer false — the
        quietest way to break a legal guardrail is to keep the old wording after the behaviour
        moves. What is still true, and is what the guardrail actually requires, is that nothing
        here scores, ranks, recommends or decides a multiple on the reader's behalf.
      */}
      <p className="rounded border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        These are figures the company reported, arithmetic differences between them, and scenario
        arithmetic under multiples you supply yourself. Market OS does not score or rank companies,
        does not choose a multiple for you, and nothing here is a recommendation.
      </p>

      {/*
        Completeness belongs next to the numbers, not only on the admin dashboard. A page built
        from a knowably partial ingest must say so — otherwise a subset of a filing history reads
        exactly like the whole of one.
      */}
      <p className={`rounded border p-3 text-sm ${completenessTone}`}>
        <span className="font-medium">Data completeness: {completeness.status}</span> —{" "}
        {completeness.detail}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Latest reported figures</h2>
        {latestFigures.length === 0 ? (
          <p className="text-sm text-zinc-500">No financial facts stored for this company.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="py-2 pr-4">Concept</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">Period covered</th>
                  <th className="py-2">Filing</th>
                </tr>
              </thead>
              <tbody>
                {latestFigures.map((f) => (
                  <tr
                    key={`${f.concept}-${f.unit}-${f.periodMonths ?? "instant"}`}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="py-2 pr-4">{f.concept}</td>
                    <td className="py-2 pr-4">
                      {f.value.toLocaleString("en-US")} {f.unit}
                    </td>
                    {/*
                      The period is not decoration. One filing reports the same concept over
                      several spans ending on the same date, so without this two rows would look
                      like contradictory values for the same quarter.
                    */}
                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                      {f.periodStart ? (
                        <>
                          {f.periodStart} → {f.periodEnd}
                          <span className="text-zinc-500"> ({f.periodMonths}mo)</span>
                        </>
                      ) : (
                        <>as of {f.periodEnd}</>
                      )}
                    </td>
                    <td className="py-2 text-zinc-500">
                      {f.form} · {f.accessionNumber}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/*
        Scenario valuation (`[CHATGPT_DECISION][MARKET-V1-VALUATION-SURFACE-20260908]`). The three
        blocks below are deliberately visually distinct, because `docs/LEGAL_GUARDRAILS.md`
        requires user-facing output touching valuation to distinguish FACT from CALCULATION from
        INFERENCE, and a table that renders a reported figure and a number the reader typed in the
        same style has already lost that distinction.
      */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Scenario valuation</h2>
          <p className="text-sm text-zinc-500">
            Arithmetic over one reported figure and a multiple you choose. Market OS does not supply
            the multiple, does not know whether yours is reasonable, and takes no view on what this
            company is worth. Total implied equity value only — this product publishes nothing about
            a share.
          </p>
        </div>

        <form
          method="get"
          className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          {source ? <input type="hidden" name="source" value={source} /> : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Your P/E multiples (USER ASSUMPTION)</legend>
            <div className="flex flex-wrap gap-3">
              <MultipleField name="peLow" label="Low" value={query.peLow} />
              <MultipleField name="peBase" label="Base" value={query.peBase} />
              <MultipleField name="peHigh" label="High" value={query.peHigh} />
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Your P/S multiples (USER ASSUMPTION)</legend>
            <div className="flex flex-wrap gap-3">
              <MultipleField name="psLow" label="Low" value={query.psLow} />
              <MultipleField name="psBase" label="Base" value={query.psBase} />
              <MultipleField name="psHigh" label="High" value={query.psHigh} />
            </div>
          </fieldset>
          <button
            type="submit"
            className="self-start rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
          >
            Calculate scenarios
          </button>
        </form>

        <ScenarioPanel title="P/E scenario" scenario={valuation.pe} />
        <ScenarioPanel title="P/S scenario" scenario={valuation.ps} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Growth — change vs. the previous comparable period
        </h2>
        <p className="text-sm text-zinc-500">
          Historical, deterministic, and nothing else: this is the arithmetic difference between two
          figures the company filed. There is no forecast here and no projection. Only periods of
          the same length are compared — a quarter is never measured against a year-to-date figure —
          which is why some concepts below have no change to show.
        </p>
        {comparable.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing has two comparable periods on record yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {comparable.map((c) => (
              <li
                key={`${c.concept}-${c.unit}`}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="font-medium">{c.concept}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {c.currentValue?.toLocaleString("en-US")} vs{" "}
                  {c.previousValue?.toLocaleString("en-US")} {c.unit} ·{" "}
                  {(c.absoluteChange ?? 0) >= 0 ? "+" : ""}
                  {c.absoluteChange?.toLocaleString("en-US")}
                  {c.percentChange !== null && c.percentChange !== undefined
                    ? ` (${c.percentChange >= 0 ? "+" : ""}${c.percentChange}%)`
                    : " (percent change undefined — previous value was zero)"}
                </div>
                <div className="text-xs text-zinc-500">
                  {c.previousPeriodEnd} → {c.currentPeriodEnd}
                  {c.periodMonths !== null && c.periodMonths !== undefined
                    ? `, ${c.periodMonths}-month periods`
                    : ", point-in-time balances"}
                </div>
                {/*
                  Equal month buckets are not equal durations. Apple's fiscal Q1 is periodically
                  14 weeks rather than 13, so a 97-day quarter gets compared against a 90-day one
                  and the extra week lands in the percentage with nothing to indicate it. The
                  comparison is still the right one to show — those are consecutive reported
                  quarters — but the reader has to be told the periods were not the same length.
                */}
                {/*
                  A restated figure is the company's own correction and is the right number to
                  show — but showing it identically to a first-time report withholds something a
                  reader would want to know. Same disclosure principle as the period-length note
                  below: present the figure, and say what it is.
                */}
                {(c.currentIsRestatement || c.previousIsRestatement) && (
                  <div className="mt-1 rounded bg-sky-50 px-2 py-1 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                    {c.currentIsRestatement && c.previousIsRestatement
                      ? "Both figures were restated by a later filing."
                      : c.currentIsRestatement
                        ? `The ${c.currentPeriodEnd} figure was restated by a later filing; the amended value is shown.`
                        : `The ${c.previousPeriodEnd} figure was restated by a later filing; the amended value is shown.`}
                    {c.currentAccession ? ` Accession ${c.currentAccession}.` : ""}
                  </div>
                )}
                {c.periodLengthMismatch && (
                  <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    These periods are not the same length: {c.previousPeriodDays} days vs{" "}
                    {c.currentPeriodDays} days. Part of this change is the extra{" "}
                    {Math.abs((c.currentPeriodDays ?? 0) - (c.previousPeriodDays ?? 0))} days, not
                    underlying performance.
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {notComparable.length > 0 && (
          <p className="text-xs text-zinc-500">
            <span className="font-medium">UNVERIFIABLE</span> — no comparable prior period is on
            record for: {notComparable.map((c) => c.concept).join(", ")}. Growth for these is not
            zero and not small; it is unknown, and this product does not estimate it.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Profitability</h2>
        <p className="text-sm text-zinc-500">
          Two ratios, each computed only where both sides are figures the company filed for the same
          period in the same unit. No adjustment, no normalisation, no peer comparison.
        </p>
        <ul className="flex flex-col gap-2">
          {profitability.map((r) => (
            <RatioRow key={r.name} ratio={r} />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Risks and evidence warnings</h2>
        {/*
          The honest shape of this section is the point. Everything listed is something an
          existing engine established mechanically; the notice below says plainly that the
          business risks a reader might expect are NOT among them, because inventing a
          qualitative risk family during productization is exactly what the governing decision
          forbids — and a section headed "Risks" that quietly listed only data-quality notes
          would read as a claim that there are no others.
        */}
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="font-medium">QUALITATIVE RISK FACTORS NOT EXTRACTED IN V1.</span> Market
          OS does not read the narrative sections of filings, so it cannot list this company&apos;s
          business, market, legal or operational risks. What follows is only what the stored data
          itself proves. Read the filings below for the rest.
        </p>
        {evidenceWarnings.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No data-quality warning is outstanding for this company. That is a statement about the
            stored data, not about the company.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {evidenceWarnings.map((w, i) => (
              <li
                key={`${w.label}-${i}`}
                className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <div className="font-medium">{w.label}</div>
                <div className="text-zinc-600 dark:text-zinc-400">{w.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Recent filings</h2>
          {/*
            The evidence page is reachable from the company flow, not only by URL. It shows every
            stored filing rather than ten, and names the two filings behind each comparison above.
          */}
          <Link
            href={`/company/${corpCode}/filings?source=${encodeURIComponent(company.sourceCode)}`}
            className="text-sm font-medium underline"
          >
            All filings and comparison evidence
          </Link>
        </div>
        {recentFilings.length === 0 ? (
          <p className="text-sm text-zinc-500">No filings stored.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentFilings.map((f) => (
              <li
                key={f.receiptNo}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="font-medium">{f.reportName}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {f.receiptDate} · {f.receiptNo}
                </div>
                <FilingSourceLink
                  sourceCode={company.sourceCode}
                  corpCode={company.corpCode}
                  receiptNo={f.receiptNo}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Two providers report this corp code, and only the reader knows which company they meant.
 *
 * Deliberately a question rather than a default. Picking one and rendering it under a header that
 * names a single provider is exactly the shape of IR-001 and IR-002 — a merged or misattributed
 * entity presented as a single sourced record — and it reads as correct from every angle except
 * the one that matters.
 */
function SourceChoice({ corpCode, sources }: { corpCode: string; sources: string[] }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Which provider?</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {sources.length} providers report a company under the code <code>{corpCode}</code>. A corp
        code identifies a company only within the provider that issued it, so these are not
        necessarily the same company.
      </p>
      <ul className="flex flex-col gap-2">
        {sources.map((sourceCode) => (
          <li key={sourceCode} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <Link
              href={`/company/${corpCode}?source=${encodeURIComponent(sourceCode)}`}
              className="font-medium underline"
            >
              {sourceCode}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A multiple from the query string.
 *
 * Absent means absent: all three blank is an untouched form, not a refusal, and the scenario
 * reports `AWAITING_ASSUMPTIONS` rather than pretending the company has no usable figure. But once
 * ANY of the three is typed the whole set is parsed, so `abc` becomes NaN and is refused as a
 * malformed assumption rather than silently ignored — a field the reader filled in must never be
 * dropped on the floor.
 */
function readMultiples(
  low: string | undefined,
  base: string | undefined,
  high: string | undefined,
): MultipleInput | undefined {
  const raw = [low, base, high].map((v) => (v ?? "").trim());
  if (raw.every((v) => v.length === 0)) return undefined;
  const [l, b, h] = raw.map((v) => (v.length === 0 ? Number.NaN : Number(v)));
  return { low: l, base: b, high: h };
}

function MultipleField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string | undefined;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        name={name}
        defaultValue={value ?? ""}
        placeholder="—"
        aria-label={`${label} multiple`}
        className="w-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
      />
    </label>
  );
}

/** Plain English for each machine reason, so a refusal explains itself instead of shrugging. */
const UNVERIFIABLE_TEXT: Record<string, string> = {
  NO_FACT_FOR_CONCEPT: "No figure of the required concept is stored for this company.",
  NO_ANNUAL_PERIOD:
    "No twelve-month period is stored. A multiple is defined against a year, and multiplying a quarter by one would be wrong by roughly four — so this refuses rather than substituting a shorter period.",
  VALUE_NOT_POSITIVE:
    "The reported figure is zero or negative, so this method does not apply. That is a fact about the filing, not a judgement about the company.",
  VALUE_NOT_FINITE: "The stored figure is not a finite number.",
  UNIT_NOT_A_CURRENCY_AMOUNT:
    "The stored figure is not a plain currency amount, so multiplying it by a multiple would not produce an equity value.",
  PROVENANCE_INCOMPLETE:
    "The figure is missing the filing identity that makes it checkable, and Market OS does not compute on numbers it cannot point back to a source for.",
  COMPLETENESS_UNSAFE:
    "The stored history for this company is known to be incomplete or its last ingest failed, so the latest figure on file may not be the latest one filed.",
  FACT_IDENTITY_AMBIGUOUS:
    "Two stored figures cover the same period and disagree, and choosing between them would be a guess about which basis you meant.",
};

const REFUSED_TEXT: Record<string, string> = {
  MULTIPLE_NOT_FINITE: "Enter three numbers. One of the multiples is blank or not a number.",
  MULTIPLE_NEGATIVE: "A multiple cannot be negative.",
  RANGE_NOT_ASCENDING: "The range must ascend: low ≤ base ≤ high.",
};

/**
 * One scenario, with FACT, USER ASSUMPTION and CALCULATION kept visibly apart.
 *
 * Every branch renders the sourced figure when there is one, including when the assumptions were
 * refused — a typo in a multiple says nothing about the data, and blanking the fact would make the
 * two failures look the same to a reader.
 */
function ScenarioPanel({ title, scenario }: { title: string; scenario: ValuationScenario }) {
  const { fact, assumptions, impliedEquityValue } = scenario;
  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          Method: {scenario.method} · {scenario.status}
        </span>
      </div>

      {fact ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            Fact — reported by the company
          </div>
          <div className="mt-1 font-medium">
            {fact.concept}: {fact.value.toLocaleString("en-US")} {fact.unit}
          </div>
          <div className="text-zinc-600 dark:text-zinc-400">
            {fact.periodStart} → {fact.periodEnd} ({fact.periodMonths}mo
            {fact.fiscalPeriod ? `, ${fact.fiscalPeriod}` : ""}
            {fact.fiscalYear ? ` ${fact.fiscalYear}` : ""})
          </div>
          <div className="text-xs text-zinc-500">
            {fact.sourceCode} · {fact.form} · {fact.accessionNumber} · completeness{" "}
            {fact.completeness.status}
          </div>
        </div>
      ) : null}

      {assumptions ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            User assumption — supplied by you, not sourced
          </div>
          <div className="mt-1">
            low {assumptions.low} · base {assumptions.base} · high {assumptions.high}
          </div>
        </div>
      ) : null}

      {impliedEquityValue ? (
        <div className="rounded border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Calculation — implied total equity value
          </div>
          <div className="mt-1 font-medium">
            {impliedEquityValue.low.toLocaleString("en-US")} ·{" "}
            {impliedEquityValue.base.toLocaleString("en-US")} ·{" "}
            {impliedEquityValue.high.toLocaleString("en-US")} {impliedEquityValue.unit}
          </div>
          <div className="text-xs text-zinc-500">{impliedEquityValue.formula}</div>
        </div>
      ) : null}

      {scenario.status === "AWAITING_ASSUMPTIONS" ? (
        <p className="text-sm text-zinc-500">
          Enter low, base and high multiples above to see a range. Nothing is filled in for you —
          Market OS has no authoritative multiple to offer.
        </p>
      ) : null}

      {scenario.status === "UNVERIFIABLE" ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="font-medium">UNVERIFIABLE ({scenario.unverifiableBecause})</span> —{" "}
          {UNVERIFIABLE_TEXT[scenario.unverifiableBecause ?? ""] ??
            "This scenario cannot be established from what is stored."}
        </p>
      ) : null}

      {scenario.status === "ASSUMPTIONS_REFUSED" ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="font-medium">Assumptions refused</span> —{" "}
          {REFUSED_TEXT[scenario.assumptionsRefusedBecause ?? ""] ?? "Check the multiples above."}
        </p>
      ) : null}

      <p className="text-xs text-zinc-500">{scenario.limitations}</p>
    </div>
  );
}

/** Plain English per refusal, so a missing ratio explains itself rather than leaving a blank. */
const RATIO_UNVERIFIABLE_TEXT: Record<string, string> = {
  NUMERATOR_MISSING: "The income figure this ratio needs is not stored for this company.",
  DENOMINATOR_MISSING: "No revenue figure is stored for this company.",
  NO_SHARED_PERIOD:
    "No period has both figures in the same unit. A quarter's profit over a year's revenue would look entirely reasonable and mean nothing, so this refuses instead.",
  DENOMINATOR_NOT_POSITIVE: "Reported revenue is zero or negative, so the ratio is undefined.",
  PROVENANCE_INCOMPLETE: "One side is missing the filing identity that makes it checkable.",
  DENOMINATOR_AMBIGUOUS:
    "Two revenue tags cover the same period and disagree, and choosing between them would be a guess about which basis you meant.",
};

const RATIO_LABEL: Record<string, string> = {
  NET_MARGIN: "Net margin",
  OPERATING_MARGIN: "Operating margin",
};

function RatioRow({ ratio }: { ratio: ProfitabilityRatio }) {
  return (
    <li className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{RATIO_LABEL[ratio.name] ?? ratio.name}</span>
        <span className="text-xs uppercase tracking-wide text-zinc-500">{ratio.status}</span>
      </div>
      {ratio.status === "COMPUTED" && ratio.numerator && ratio.denominator ? (
        <>
          <div className="mt-1 text-lg font-medium">{ratio.percent}%</div>
          <div className="text-zinc-600 dark:text-zinc-400">
            {ratio.numerator.concept} {ratio.numerator.value.toLocaleString("en-US")} ÷{" "}
            {ratio.denominator.concept} {ratio.denominator.value.toLocaleString("en-US")}{" "}
            {ratio.denominator.unit}
          </div>
          <div className="text-xs text-zinc-500">
            {ratio.numerator.periodStart} → {ratio.numerator.periodEnd} (
            {ratio.numerator.periodMonths}mo) · {ratio.numerator.form}{" "}
            {ratio.numerator.accessionNumber}
            {ratio.denominator.accessionNumber !== ratio.numerator.accessionNumber
              ? ` · ${ratio.denominator.form} ${ratio.denominator.accessionNumber}`
              : ""}
          </div>
        </>
      ) : (
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          <span className="font-medium">UNVERIFIABLE ({ratio.unverifiableBecause})</span> —{" "}
          {RATIO_UNVERIFIABLE_TEXT[ratio.unverifiableBecause ?? ""] ??
            "This ratio cannot be established from what is stored."}
        </p>
      )}
      <p className="mt-1 text-xs text-zinc-500">{ratio.limitations}</p>
    </li>
  );
}

function FilingSourceLink({
  sourceCode,
  corpCode,
  receiptNo,
}: {
  sourceCode: string;
  corpCode: string;
  receiptNo: string;
}) {
  const href = filingSourceUrl(sourceCode, corpCode, receiptNo);
  if (!href) {
    return (
      <div className="text-xs text-zinc-500">
        No canonical source URL is known for {sourceCode}, or this identifier does not match its
        expected shape. The identifier above is the filing.
      </div>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs underline text-zinc-600 dark:text-zinc-400"
    >
      Open the original filing at {sourceCode}
    </a>
  );
}
