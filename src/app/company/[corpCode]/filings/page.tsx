import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import {
  computeCompanyXray,
  listCompanyFilings,
  listCompanySources,
} from "@/server/domain/companyXray";
import { filingSourceUrl } from "@/lib/filingSourceUrl";
import type { FilingDiffResult } from "@/server/domain/filingDiff";

export const dynamic = "force-dynamic";

/**
 * Filings and evidence for one company.
 *
 * The delivery audit's gap here was not a missing engine — `computeFilingDiff` has existed since
 * M16 and its results already reach the company page as the growth section. The gap was that a
 * reader could see a change of +12.4% and had no way to reach the two filings it was computed
 * from, because `currentAccession` and `previousAccession` were on the result and nothing rendered
 * them. A number whose source you cannot open is not evidence, it is an assertion.
 *
 * So this page does two things and builds nothing: it lists the stored filings with their real
 * identifiers and, where the shape can be proven, a link to the provider's own copy; and it
 * re-presents the SAME `changes` the company page shows, this time naming both filings each
 * comparison used.
 */
export default async function CompanyFilingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ corpCode: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { corpCode } = await params;
  const { source } = await searchParams;

  // Same refusal as the company page: a corp code identifies a company only within the provider
  // that issued it, so where it is ambiguous and no source is named this asks rather than picks.
  const sources = await listCompanySources(corpCode);
  if (sources.length === 0) {
    notFound();
  }
  if (!source && sources.length > 1) {
    return (
      <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Which provider?</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {sources.length} providers report a company under the code <code>{corpCode}</code>, and
          they are not necessarily the same company.
        </p>
        <ul className="flex flex-col gap-2">
          {sources.map((s) => (
            <li key={s} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <Link
                href={`/company/${corpCode}/filings?source=${encodeURIComponent(s)}`}
                className="font-medium underline"
              >
                {s}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const sourceCode = source ?? sources[0];
  const [xray, filings] = await Promise.all([
    computeCompanyXray(corpCode, sourceCode),
    listCompanyFilings(corpCode, sourceCode),
  ]);
  if (!xray || !filings) {
    notFound();
  }

  const { company, changes, completeness } = xray;
  const comparable = changes.filter((c) => c.status === "COMPUTED");
  const notComparable = changes.filter((c) => c.status !== "COMPUTED");
  const backHref = `/company/${corpCode}?source=${encodeURIComponent(sourceCode)}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Filings and evidence — {company.corpName}
          </h1>
          <Link href={backHref} className="shrink-0 text-sm font-medium underline">
            Back to company
          </Link>
        </div>
        <p className="text-sm text-zinc-500">
          {company.sourceCode} · {company.corpCode} · every filing stored here, and the two filings
          behind each comparison shown on the company page.
        </p>
      </header>

      <p className={`rounded border p-3 text-sm ${completenessTone(completeness.status)}`}>
        <span className="font-medium">Data completeness: {completeness.status}</span> —{" "}
        {completeness.detail}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Comparison evidence</h2>
        <p className="text-sm text-zinc-500">
          Each row is an arithmetic difference between two figures the company filed. Both filings
          are named, so every number here can be checked against the provider&apos;s own copy.
        </p>

        {comparable.length === 0 ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span className="font-medium">UNVERIFIABLE</span> — nothing stored here has two
            comparable periods on record, so no comparison can be shown. That is a statement about
            what has been ingested, not a finding about the company.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {comparable.map((c) => (
              <ComparisonRow
                key={`${c.concept}-${c.unit}`}
                change={c}
                sourceCode={company.sourceCode}
                corpCode={company.corpCode}
              />
            ))}
          </ul>
        )}

        {notComparable.length > 0 && (
          <p className="text-xs text-zinc-500">
            <span className="font-medium">UNVERIFIABLE</span> for:{" "}
            {notComparable.map((c) => c.concept).join(", ")} — no comparable prior period is on
            record, so no difference exists to show.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Stored filings</h2>
        {filings.total === 0 ? (
          <p className="text-sm text-zinc-500">
            No filings are stored for this company. Data arrives once its provider is configured and
            has been fetched.
          </p>
        ) : (
          <>
            <p className="text-sm text-zinc-500">
              {filings.rows.length} of {filings.total} shown
              {filings.rows.length < filings.total
                ? `, newest first — this page shows at most ${filings.limit}.`
                : ", newest first."}
            </p>
            <ul className="flex flex-col gap-2">
              {filings.rows.map((f) => (
                <li
                  key={f.receiptNo}
                  className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="font-medium">{f.reportName}</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    {f.receiptDate} · {company.sourceCode} · {f.receiptNo}
                    {f.remark ? ` · ${f.remark}` : ""}
                  </div>
                  <SourceLink
                    sourceCode={company.sourceCode}
                    corpCode={company.corpCode}
                    receiptNo={f.receiptNo}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function completenessTone(status: string): string {
  if (status === "COMPLETE") {
    return "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400";
  }
  if (status === "UNCONFIRMED") {
    return "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200";
  }
  return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
}

/**
 * A link to the provider's own copy, or the raw identifier and why there is no link.
 *
 * `filingSourceUrl` returns null for any provider whose URL shape this repository has not verified
 * and for any identifier that does not match the shape it expects. Both cases render the
 * identifier as text: a reader can still find the filing with it, and a fabricated link that lands
 * nowhere would leave them unable to tell whether the filing is missing or the link was invented.
 */
function SourceLink({
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
      className="text-xs text-zinc-600 underline dark:text-zinc-400"
    >
      Open the original filing at {sourceCode}
    </a>
  );
}

/** One comparison, with both filings named and every caveat the engine attached to it. */
function ComparisonRow({
  change,
  sourceCode,
  corpCode,
}: {
  change: FilingDiffResult;
  sourceCode: string;
  corpCode: string;
}) {
  return (
    <li className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="font-medium">{change.concept}</div>
      <div className="text-zinc-600 dark:text-zinc-400">
        {change.previousValue?.toLocaleString("en-US")} →{" "}
        {change.currentValue?.toLocaleString("en-US")} {change.unit} ·{" "}
        {(change.absoluteChange ?? 0) >= 0 ? "+" : ""}
        {change.absoluteChange?.toLocaleString("en-US")}
        {change.percentChange !== null && change.percentChange !== undefined
          ? ` (${change.percentChange >= 0 ? "+" : ""}${change.percentChange}%)`
          : " (percent change undefined — the previous value was zero)"}
      </div>
      <div className="text-xs text-zinc-500">
        {change.previousPeriodEnd} → {change.currentPeriodEnd}
        {change.periodMonths !== null && change.periodMonths !== undefined
          ? `, ${change.periodMonths}-month periods`
          : ", point-in-time balances"}
      </div>

      {/*
        The whole reason this page exists. Both accessions were already on the result and nothing
        rendered them, so a reader could see the number and not the two documents it came from.
      */}
      <div className="mt-2 flex flex-col gap-1">
        {(
          [
            ["Earlier filing", change.previousAccession],
            ["Later filing", change.currentAccession],
          ] as const
        ).map(([label, accession]) =>
          accession ? (
            <div key={label} className="text-xs">
              <span className="text-zinc-500">{label}:</span> {accession}{" "}
              <SourceLink sourceCode={sourceCode} corpCode={corpCode} receiptNo={accession} />
            </div>
          ) : null,
        )}
      </div>

      {change.periodLengthMismatch && (
        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The two periods fall in the same month bucket but are {change.previousPeriodDays} and{" "}
          {change.currentPeriodDays} days long. Part of this difference is the extra time, not the
          business.
        </div>
      )}
      {(change.currentIsRestatement || change.previousIsRestatement) && (
        <div className="mt-1 rounded bg-sky-50 px-2 py-1 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
          {change.currentIsRestatement && change.previousIsRestatement
            ? "Both figures were restated by a later filing."
            : change.currentIsRestatement
              ? "The later figure supersedes one already reported for the same period."
              : "The earlier figure was superseded by a later filing."}
        </div>
      )}
    </li>
  );
}
