import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { listCompanies } from "@/server/domain/companyXray";

export const dynamic = "force-dynamic";

/**
 * Company index (docs/ROADMAP.md M15). Lists only companies with stored filings — nothing is
 * shown for a company the system has never ingested, rather than an empty shell that implies
 * coverage it does not have.
 */
export default async function CompanyIndexPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const companies = await listCompanies();

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-zinc-500">
            Companies with filings on record. The filing span shown is what is actually stored, not
            what the source has available.
          </p>
        </div>
        <Link href="/today" className="shrink-0 text-sm font-medium underline">
          Today
        </Link>
      </header>

      {companies.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No filings ingested yet. Run one of the <code>ingest:*</code> scripts.
        </p>
      ) : (
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
      )}
    </div>
  );
}
