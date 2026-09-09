import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { askMarket } from "@/server/domain/askMarket";

export const dynamic = "force-dynamic";

/**
 * Ask Market — deterministic safe-mode MVP (see src/server/domain/askMarket.ts for the full
 * scoping rationale). A structured lookup over already-verified data, not free-text natural-language
 * Q&A — that requires a live model and remains gated (HG-006).
 *
 * WHAT THIS UNIT CHANGED, and why it was needed. The engine has four statuses and this page
 * rendered two of them. `REQUEST_NOT_SUPPORTED` had no branch at all, so it produced an EMPTY
 * result area — measured on 2026-09-10 against the page's own placeholder text: typing
 * "inflation", the example the input suggested, returned a blank screen. The engine had already
 * computed an explanation and put it in `redirectMessage`; the page threw it away. That is the
 * third "already computed, never rendered" defect found in this product in two days, after the
 * filing accessions and the analog.
 *
 * Nothing about the engine changed here. Every status, message and factor below is read from the
 * result `askMarket` already returns.
 */
export default async function AskMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const result = query ? await askMarket(query) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Ask Market</h1>
        <p className="text-sm text-zinc-500">
          A lookup over data Market OS has already stored and checked. Every figure it shows names
          the provider it came from and the period it covers, and it never gives a buy or sell
          recommendation.
        </p>
      </header>

      {/*
        The capability statement, and it is not marketing copy. A user typing into a box has no way
        to know which shapes of question this product recognises, and the old placeholder actively
        misled: it suggested "inflation", which the request grammar does not recognise as an
        operation at all.
      */}
      <section className="flex flex-col gap-2 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <h2 className="font-medium">What this can answer today</h2>
        <ul className="ml-4 flex list-disc flex-col gap-1 text-zinc-600 dark:text-zinc-400">
          <li>
            The current reading of a macro indicator it tracks —{" "}
            <em>What is the current US headline CPI?</em>
          </li>
          <li>
            How one of those indicators has changed over a period you name —{" "}
            <em>How has the 10-year Treasury yield changed this year?</em>
          </li>
          <li>Figures a company reported in a filing, and the causal relationships on record.</li>
        </ul>
        <p className="text-zinc-600 dark:text-zinc-400">
          A bare topic such as <em>inflation</em> is not a question it can act on. Ask for a
          specific reading or change and it will either answer with sourced figures or say plainly
          why it cannot.
        </p>
        {/*
          HG-006, stated as a capability rather than a fault, and with no instruction a normal user
          cannot follow. `askMarketInference.ts` builds the boundary a future model would sit
          behind; nothing in this repository implements its `InferenceSink`, which is asserted by a
          control rather than promised here — so there is no path from this page to a model, a
          credential or a bill.
        */}
        <p className="rounded border border-zinc-200 bg-zinc-50 p-3 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <span className="font-medium">Written answers are not enabled in this installation.</span>{" "}
          Market OS can show you the stored figures and their sources, but it will not compose them
          into a narrative — no answer-writing model is configured here, and it will not silently
          reach for one. The evidence-based results below remain available.
        </p>
      </section>

      <form className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Ask a question</span>
          <input
            type="text"
            name="q"
            defaultValue={query}
            aria-label="Ask a question"
            placeholder="e.g. What is the current US headline CPI?"
            className="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Search
        </button>
      </form>

      {result && (
        <div className="flex flex-col gap-6">
          {result.status === "PERSONALIZED_ADVICE_REDIRECTED" && (
            <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <div className="font-medium">Redirected for safety</div>
              <p className="mt-1">{result.redirectMessage}</p>
            </div>
          )}

          {/*
            The branch that did not exist. `REQUEST_NOT_SUPPORTED` means the request was understood
            well enough to know this product does not perform it — a different claim from
            `NOT_FOUND`, and IR-107 is the measurement of why the distinction matters. The engine's
            own `detail` is shown rather than a generic sentence, because it names WHICH part could
            not be resolved.
          */}
          {result.status === "REQUEST_NOT_SUPPORTED" && (
            <div className="rounded border border-zinc-300 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <div className="font-medium">Market OS cannot act on that request</div>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                {result.redirectMessage ??
                  "The request does not match an operation this product performs."}
              </p>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                This is not a search that came back empty — it is a request shape Market OS does not
                perform. Try asking for a specific reading or change, as in the examples above.
              </p>
            </div>
          )}

          {result.status === "NOT_FOUND" && (
            <div className="rounded border border-zinc-300 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <div className="font-medium">
                Nothing could be served for &quot;{result.query}&quot;
              </div>
              {/*
                The old wording said "try a different macro series or company name", which sends a
                reader after the wrong thing. `askMarket` DROPS a series whose latest reading is
                stale against its own release cadence — `if (freshness.status !== "FRESH") continue`
                — so a NOT_FOUND can equally mean "held, but too old to serve". Measured on this
                installation: every well-formed indicator question returns NOT_FOUND for exactly
                that reason. Telling the reader to rephrase would be telling them to fix the wrong
                problem.
              */}
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                The request was understood. Either nothing matching it is stored here, or what is
                stored is too old to serve: Market OS withholds a reading that is stale against its
                own release cadence rather than presenting it as current. Nothing is fabricated
                either way.
              </p>
              {/*
                `/status` is deliberately NOT linked here yet: it lands in the next unit, and a
                commit that points at a route the next commit creates is a broken intermediate
                state rather than a head start.
              */}
              <p className="mt-2">
                <Link href="/macro" className="underline">
                  Macro and regime
                </Link>{" "}
                lists every indicator held here with its freshness.
              </p>
            </div>
          )}

          {result.seriesFactors.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Macro / market factors</h2>
              {/*
                Not decoration: the engine withholds stale readings, so their absence is a decision
                it made rather than a gap in the database, and a reader who is not told that will
                read a short list as the whole truth.
              */}
              <p className="text-sm text-zinc-500">
                Every reading below was fresh against its own release cadence when this was
                computed. A stale one is withheld rather than shown as current.
              </p>
              <ul className="flex flex-col gap-2">
                {result.seriesFactors.map((f) => (
                  <li
                    key={f.seriesId}
                    className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{f.seriesName}</span>
                      {/*
                        Two providers can publish a series under near-identical names — Series is
                        unique on (sourceId, externalId), never on name — so both would be listed
                        here with different values. Naming the provider is what keeps them apart,
                        and every FACT shown to a user has to trace to a stored source anyway.
                      */}
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {f.sourceCode}
                      </span>
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      {f.value} {f.unit} as of {f.asOfDate}
                      {/*
                        A change is shown only when a change was asked for. The factor is a
                        discriminated union precisely so this cannot be rendered by accident: a
                        current-level answer has no movement to display, and displaying one made
                        every level request quietly also answer a change request.
                      */}
                      {f.kind === "COMPUTED_CHANGE" ? (
                        <>
                          {" "}
                          ({f.absoluteChange >= 0 ? "+" : ""}
                          {f.absoluteChange}
                          {f.percentChange !== null
                            ? ` / ${f.percentChange >= 0 ? "+" : ""}${f.percentChange}%`
                            : ""}
                          {f.interval ? ` over ${f.interval}` : ""})
                        </>
                      ) : null}
                    </div>
                    {/*
                      The dates the arithmetic actually used. The type's own comment says why they
                      exist — "a period name and the dates it resolved to are two different claims,
                      and only one of them can be checked by the reader" — and the page was showing
                      only the label. A reader could not tell "this year" from the two readings it
                      was really measured between.
                    */}
                    {f.kind === "COMPUTED_CHANGE" ? (
                      <div className="text-xs text-zinc-500">
                        Measured between {f.startDate} and {f.endDate}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.companyFacts.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">
                Company facts{result.matchedTopic ? ` — ${result.matchedTopic}` : ""}
              </h2>
              <ul className="flex flex-col gap-2">
                {result.companyFacts.map((f, i) => (
                  <li
                    key={`${f.concept}-${i}`}
                    className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{f.concept}</span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {f.sourceCode}
                      </span>
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      {f.value} {f.unit} —{" "}
                      {f.fiscalYear !== null
                        ? `${f.fiscalPeriod ?? ""} ${f.fiscalYear}`.trim()
                        : "fiscal period not reported"}{" "}
                      ({f.form})
                    </div>
                    {/*
                      The actual period covered. A filing reports both a year-to-date and a
                      quarterly figure under the SAME fiscal label, so without this the list
                      shows two different revenue numbers both labelled "Q3 2026" with no way
                      to tell them apart.
                    */}
                    <div className="text-xs text-zinc-500">
                      {f.periodStart ? `${f.periodStart} → ${f.periodEnd}` : `as of ${f.periodEnd}`}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.causalFactors.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Related causal relationships</h2>
              <p className="text-sm text-zinc-500">
                Stored, reviewed relationships with their known counterexamples — not a claim that
                one caused the other on any particular day.
              </p>
              <ul className="flex flex-col gap-2">
                {result.causalFactors.map((edge, i) => (
                  <li key={i} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="font-medium">
                      {edge.fromVariable} → {edge.toVariable} ({edge.direction}, {edge.confidence}{" "}
                      confidence)
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      {edge.mechanism} · lag {edge.lag}
                    </div>
                    <div className="text-xs text-zinc-500">Limitations: {edge.counterexamples}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
