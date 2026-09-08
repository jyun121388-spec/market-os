import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { listCompanies } from "@/server/domain/companyXray";
import { filterCompanies, summariseCoverage } from "@/lib/companySearch";

export const dynamic = "force-dynamic";

/**
 * Company index (docs/ROADMAP.md M15). Lists only companies with stored filings — nothing is
 * shown for a company the system has never ingested, rather than an empty shell that implies
 * coverage it does not have.
 *
 * The delivery audit found two things wrong with it as a PRODUCT surface: there was no way to
 * search a list that grows with every ingest, and the page stated no coverage at all, so an empty
 * Korean universe was indistinguishable from Korea not being supported. Both are addressed here
 * without touching `listCompanies`.
 */
export default async function CompanyIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const all = await listCompanies();
  const companies = filterCompanies(all, query);

  const bySource = new Map<string, number>();
  for (const c of all) bySource.set(c.sourceCode, (bySource.get(c.sourceCode) ?? 0) + 1);

  // Booleans only. Whether a credential exists is a fact a user needs; its value is never read,
  // never rendered and never logged.
  const coverage = summariseCoverage(bySource, {
    SEC_EDGAR: true,
    DART: Boolean(process.env.DART_API_KEY),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="text-sm text-zinc-500">
          Companies with filings on record. The filing span shown is what is actually stored, not
          what the source has available.
        </p>
      </header>

      {/*
        The coverage statement is a CLAIM, so it is derived from what is stored and from whether a
        credential exists — never from a sentence somebody wrote once. "Korea and US companies"
        would be false on almost every installation.
      */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">What this installation covers</h2>
        <ul className="flex flex-col gap-2">
          {coverage.map((c) => (
            <li
              key={c.sourceCode}
              className={`rounded border p-3 text-sm ${
                c.state === "HAS_DATA"
                  ? "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
                  : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              }`}
            >
              <span className="font-medium">
                {c.universe} ({c.sourceCode}) — {c.state}
              </span>{" "}
              {c.detail}
            </li>
          ))}
        </ul>
      </section>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <label className="flex-1 text-sm">
          <span className="sr-only">Search companies</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by name, ticker or provider code"
            aria-label="Search companies"
            className="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Search
        </button>
        {query.length > 0 ? (
          <Link href="/company" className="text-sm underline">
            Clear
          </Link>
        ) : null}
      </form>

      {all.length === 0 ? (
        // Never an instruction to run a script. A person who cannot open a terminal is the reader
        // this product is now being delivered for, and "run one of the ingest:* scripts" is the
        // same failure as a stack trace — it is the developer's answer, handed to a user.
        <p className="text-sm text-zinc-500">
          No filings are stored yet. Data arrives once a provider above is configured and has been
          fetched; the coverage list says which are which.
        </p>
      ) : companies.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing on record matches “{query}”. That is a statement about what is stored here, not
          about whether the company exists.
        </p>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            {companies.length} of {all.length} shown.
          </p>
          <ul className="flex flex-col gap-2">
            {companies.map((c) => (
              <li
                key={`${c.sourceCode}:${c.corpCode}`}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <Link
                  href={`/company/${c.corpCode}?source=${encodeURIComponent(c.sourceCode)}`}
                  className="font-medium underline"
                >
                  {c.corpName}
                </Link>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {c.sourceCode} · {c.corpCode}
                  {c.stockCode ? ` · ${c.stockCode}` : ""}
                </div>
                <div className="text-xs text-zinc-500">
                  {c.filingCount} filing{c.filingCount === 1 ? "" : "s"}
                  {c.earliestFilingDate && c.latestFilingDate
                    ? ` · ${c.earliestFilingDate} → ${c.latestFilingDate}`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
