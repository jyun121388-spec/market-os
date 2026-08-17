import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeCompanyXray } from "@/server/domain/companyXray";

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
}: {
  params: Promise<{ corpCode: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { corpCode } = await params;
  const xray = await computeCompanyXray(corpCode);
  if (!xray) {
    notFound();
  }

  const { company, latestFigures, changes, recentFilings, completeness } = xray;
  const completenessTone =
    completeness.status === "COMPLETE"
      ? "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
  const comparable = changes.filter((c) => c.status === "COMPUTED");
  const notComparable = changes.filter((c) => c.status !== "COMPUTED");

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
        <div className="flex shrink-0 gap-3 text-sm font-medium">
          <Link href="/watchlist" className="underline">
            Watchlist
          </Link>
          <Link href="/company" className="underline">
            All companies
          </Link>
        </div>
      </header>

      <p className="rounded border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        These are figures the company reported, and arithmetic differences between them. Market OS
        does not score, rate or value companies, and nothing here is a recommendation.
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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Change vs. the previous comparable period</h2>
        <p className="text-sm text-zinc-500">
          Only periods of the same length are compared. A quarter is never measured against a
          year-to-date figure, which is why some concepts below have no change to show.
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
              </li>
            ))}
          </ul>
        )}
        {notComparable.length > 0 && (
          <p className="text-xs text-zinc-500">
            No comparable prior period on record for:{" "}
            {notComparable.map((c) => c.concept).join(", ")}.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent filings</h2>
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
