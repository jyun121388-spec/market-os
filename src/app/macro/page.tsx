import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeRegimeSnapshot } from "@/server/domain/macroRegime";
import { computeCalendar, type CalendarEntry } from "@/server/domain/economicCalendar";
import { evaluateStaleness, type StalenessStatus } from "@/server/domain/staleness";
import {
  computeHistoricalAnalog,
  type HistoricalAnalogResult,
} from "@/server/domain/historicalAnalog";

export const dynamic = "force-dynamic";

/**
 * Macro, regime, calendar and — for the first time — the historical analog.
 *
 * Composition only. Every number here comes from `computeRegimeSnapshot`, `computeCalendar`,
 * `evaluateStaleness` or `computeHistoricalAnalog`, unchanged. Nothing on this page forecasts,
 * scores or ranks anything, and there is no new engine behind it.
 *
 * THE ANALOG IS THE CAREFUL PART, and it is the reason this route waited for
 * `[CHATGPT_VERIFIED][MARKET-ANALOG-ZERO-SPREAD-20260908] APPROVED`. Until IR-134 landed,
 * `computeHistoricalAnalog` would return a perfect 1.0 similarity for a zero-variance history —
 * a confident number for a comparison that has no defined scale — and no user-facing surface was
 * allowed to expose it. It now fails closed on that, and on a single comparator, and on a window
 * spanning a date the repository refused to answer about. This page renders `INSUFFICIENT_DATA`
 * as exactly that: not "no risk", not "stable", not a smaller number.
 */
export default async function MacroPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { series } = await searchParams;
  const [regime, calendar] = await Promise.all([computeRegimeSnapshot(), computeCalendar()]);

  // The detail mechanism is a query parameter, which is the smallest thing that works: no new
  // route, no client state, and the selected indicator is in the URL so it can be shared.
  const selected = series ? calendar.find((c) => c.seriesId === series) : undefined;
  const analog = selected ? await computeHistoricalAnalog(selected.seriesId) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Macro and regime</h1>
        <p className="text-sm text-zinc-500">
          Indicators this installation has actually stored, the direction of their most recent
          change, and when each is next expected based on its own past cadence. Nothing here is a
          forecast of what any number will be.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Regime</h2>
        <p className="text-sm text-zinc-500">
          Eight axes. An axis with no stored series reads INSUFFICIENT_DATA rather than neutral —
          absence of data is not a finding of balance.
        </p>
        <ul className="flex flex-col gap-2">
          {regime.axes.map((axis) => (
            <li
              key={axis.axis}
              className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{axis.axis}</span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">{axis.status}</span>
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {axis.readings.map((r) => (
                  <li
                    key={`${r.sourceCode}-${r.externalId}`}
                    className="text-zinc-600 dark:text-zinc-400"
                  >
                    {r.seriesName ?? r.externalId}{" "}
                    <span className="text-zinc-500">
                      ({r.sourceCode} · {r.externalId})
                    </span>{" "}
                    —{" "}
                    {r.status === "COMPUTED" ? (
                      <>
                        {r.value?.toLocaleString("en-US")} on {r.asOfDate}, {r.direction}
                        {r.change
                          ? ` ${r.change.absoluteChange >= 0 ? "+" : ""}${r.change.absoluteChange}`
                          : ""}
                      </>
                    ) : (
                      <span className="font-medium">{r.status}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Indicators and expected releases</h2>
        <p className="text-sm text-zinc-500">
          The expected date is a projection from this series&apos; own median interval, not a
          release calendar published by anybody. Select an indicator to see its historical analog.
        </p>
        {calendar.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No indicator series are stored yet. Data arrives once a provider is configured and has
            been fetched.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {calendar.map((entry) => (
              <IndicatorRow
                key={entry.seriesId}
                entry={entry}
                selected={entry.seriesId === selected?.seriesId}
              />
            ))}
          </ul>
        )}
      </section>

      {selected && analog ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Historical analog — {selected.seriesName}</h2>
          <AnalogPanel analog={analog} />
        </section>
      ) : null}
    </div>
  );
}

function freshnessOf(entry: CalendarEntry): { status: StalenessStatus; days: number | null } {
  if (
    entry.status !== "PROJECTED" ||
    entry.lastObservedDate === undefined ||
    entry.medianIntervalDays === undefined
  ) {
    // UNKNOWN, not FRESH. A series whose cadence cannot be established says nothing about whether
    // its latest value is current, and defaulting to fresh would be an answer nobody computed.
    return { status: "UNKNOWN", days: null };
  }
  const result = evaluateStaleness({
    lastObservedDate: entry.lastObservedDate,
    medianIntervalDays: entry.medianIntervalDays,
  });
  return { status: result.status, days: result.daysSinceLastObservation };
}

function IndicatorRow({ entry, selected }: { entry: CalendarEntry; selected: boolean }) {
  const freshness = freshnessOf(entry);
  const tone =
    freshness.status === "FRESH"
      ? "text-zinc-600 dark:text-zinc-400"
      : freshness.status === "STALE"
        ? "text-amber-800 dark:text-amber-300"
        : "text-zinc-500";
  return (
    <li
      className={`rounded border p-3 text-sm ${
        selected ? "border-zinc-400 dark:border-zinc-600" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href={`/macro?series=${encodeURIComponent(entry.seriesId)}`}
          className="font-medium underline"
        >
          {entry.seriesName}
        </Link>
        <span className={`text-xs uppercase tracking-wide ${tone}`}>{freshness.status}</span>
      </div>
      <div className="text-zinc-600 dark:text-zinc-400">
        {entry.sourceCode} · {entry.externalId}
        {entry.lastObservedDate
          ? ` · last ${entry.lastObservedValue?.toLocaleString("en-US")} on ${entry.lastObservedDate}`
          : ""}
        {freshness.days !== null ? ` (${freshness.days}d ago)` : ""}
      </div>
      {entry.status === "PROJECTED" ? (
        <div className="text-xs text-zinc-500">
          Median interval {entry.medianIntervalDays}d · next expected around{" "}
          {entry.expectedNextDate}
          {entry.daysUntilExpectedNext !== undefined ? ` (${entry.daysUntilExpectedNext}d)` : ""} —
          a cadence projection, not a confirmed release date.
        </div>
      ) : (
        <div className="text-xs text-zinc-500">
          <span className="font-medium">INSUFFICIENT_DATA</span> — fewer than two observation dates
          are stored, so no cadence can be established and no next date is projected.
        </div>
      )}
    </li>
  );
}

/**
 * The analog, rendered under the contract IR-134 established.
 *
 * `INSUFFICIENT_DATA` is shown as a refusal with its own sentence, never as an empty section, a
 * zero, a dash, or a reassuring word. The engine has three separate ways to reach it — a window
 * spanning a date the repository refused to answer about, fewer than two comparators, and a
 * zero-variance distribution — and each of those is a case where a number would have been
 * fabricated, which is exactly what a reader must not be left to assume did not happen.
 */
function AnalogPanel({ analog }: { analog: HistoricalAnalogResult }) {
  if (analog.status === "INSUFFICIENT_DATA") {
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="font-medium">INSUFFICIENT_DATA</span> — Market OS cannot establish a
          usable historical analog for this indicator from what it has stored. That is a statement
          about the evidence, not a finding that conditions are calm, normal or unprecedented.
        </p>
        <p className="text-xs text-zinc-500">{analog.limitations}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">
            Current trailing change over {analog.windowSize} period
            {analog.windowSize === 1 ? "" : "s"}: {analog.currentTrailingChange}
          </span>
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            {analog.status} · sample size {analog.sampleSize}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {analog.matches.map((m) => (
          <li
            key={m.asOfDate}
            className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          >
            <div className="font-medium">
              {m.asOfDate} — trailing change {m.historicalTrailingChange}, similarity{" "}
              {m.similarityScore}
            </div>
            <div className="text-zinc-600 dark:text-zinc-400">
              What happened after: {describeAhead("1 period", m.subsequentChange1)} ·{" "}
              {describeAhead("3 periods", m.subsequentChange3)} ·{" "}
              {describeAhead("6 periods", m.subsequentChange6)}
            </div>
          </li>
        ))}
      </ul>

      {/* Required and non-optional on the result type, and rendered every time for that reason. */}
      <p className="rounded border border-zinc-200 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        {analog.limitations}
      </p>
    </div>
  );
}

/**
 * `null` means the repository could not establish that lookahead — the history does not reach that
 * far, or the span crosses a date whose current value could not be proven. It is rendered as
 * "not established" rather than omitted, because a silently missing period reads as zero.
 */
function describeAhead(label: string, value: number | null): string {
  return value === null ? `${label}: not established` : `${label}: ${value}`;
}
