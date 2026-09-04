import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { askMarket } from "@/server/domain/askMarket";

export const dynamic = "force-dynamic";

/**
 * Ask Market — deterministic safe-mode MVP (see src/server/domain/askMarket.ts for the full
 * scoping rationale). A topic search over already-verified data, not free-text natural-language
 * Q&A — that requires a live LLM and remains BLOCKED_HUMAN_GATE.
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ask Market</h1>
        <p className="text-sm text-zinc-500">
          Search a macro variable or company name to see the factual factors on record. This does
          not answer free-form questions and never gives a buy/sell recommendation.
        </p>
      </header>

      <form className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="e.g. inflation, Samsung Electronics"
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-background">
          Search
        </button>
      </form>

      {result && (
        <div className="flex flex-col gap-6">
          {result.status === "PERSONALIZED_ADVICE_REDIRECTED" && (
            <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {result.redirectMessage}
            </div>
          )}

          {result.status === "NOT_FOUND" && (
            <p className="text-sm text-zinc-500">
              No tracked data matches &quot;{result.query}&quot;. Nothing is fabricated here — try a
              different macro series or company name.
            </p>
          )}

          {result.seriesFactors.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Macro / market factors</h2>
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
