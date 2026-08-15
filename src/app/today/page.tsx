import { buildMorningBrief } from "@/server/domain/morningBrief";

export const dynamic = "force-dynamic"; // always reflects current data, never statically cached

export default async function TodayPage() {
  const brief = await buildMorningBrief();

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-zinc-500">
          Generated {new Date(brief.generatedAt).toLocaleString()}
        </p>
      </header>

      <Section title="What Changed">
        {brief.whatChanged.length === 0 ? (
          <Empty>No tracked series have enough history yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {brief.whatChanged.map((c) => (
              <li
                key={c.seriesId}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="font-medium">{c.seriesName}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {c.value} {c.unit} as of {c.asOfDate} ({c.absoluteChange >= 0 ? "+" : ""}
                  {c.absoluteChange}
                  {c.percentChange !== null
                    ? ` / ${c.percentChange >= 0 ? "+" : ""}${c.percentChange}%`
                    : ""}
                  )
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Macro Regime">
        <ul className="flex flex-col gap-2">
          {brief.regime.axes.map((axis) => (
            <li key={axis.axis} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="font-medium">{axis.axis}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {axis.status === "DATA_AVAILABLE"
                  ? axis.readings
                      .filter((r) => r.status === "COMPUTED")
                      .map((r) => `${r.seriesName}: ${r.value} (${r.direction})`)
                      .join(" · ")
                  : "Insufficient data"}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Recent Events">
        {brief.recentEvents.length === 0 ? (
          <Empty>No events in the last 72 hours.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {brief.recentEvents.map((e) => (
              <li key={e.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="font-medium">{e.topic}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {e.mentionCount} mention{e.mentionCount === 1 ? "" : "s"} · {e.distinctTierCount}{" "}
                  source tier{e.distinctTierCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent Filings">
        {brief.recentFilings.length === 0 ? (
          <Empty>No filings in the last 72 hours.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {brief.recentFilings.map((f) => (
              <li key={f.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="font-medium">
                  {f.corpName} — {f.reportName}
                </div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {f.receiptDate} · {f.sourceCode}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Calendar">
        {brief.calendar.length === 0 ? (
          <Empty>No projected upcoming releases yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {brief.calendar.map((c) => (
              <li
                key={`${c.sourceCode}:${c.externalId}`}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="font-medium">{c.seriesName}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Next expected ~{c.expectedNextDate}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-500">{children}</p>;
}
