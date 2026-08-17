import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeSystemHealth } from "@/server/domain/systemHealth";
import { isOperatorEmail } from "@/server/domain/operatorAccess";
import { formatTimestampUtc } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  // Being signed in is not authorization. This page shows ingest errors, source tiers and
  // completeness shortfalls, and `Plan` (FREE/PRO) is a billing tier, not a role — so without
  // this check any self-registered user reads the operator view. Redirects rather than 403s so
  // the page's existence is not confirmed to someone who should not have it.
  if (!isOperatorEmail(user.email)) {
    redirect("/today");
  }

  const health = await computeSystemHealth();

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin — Pipeline Health</h1>
        <p className="text-sm text-zinc-500">Signed in as {user.email}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Unresolved data conflicts</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{health.unresolvedDataConflicts}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Ingest completeness
          {health.incompleteRuns > 0 && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {health.incompleteRuns} need attention
            </span>
          )}
        </h2>
        <p className="text-sm text-zinc-500">
          Latest run per source and target. &quot;Fetched vs. provider&quot; compares what was
          retrieved against what the provider itself said exists — a gap means the stored data is
          knowably incomplete, not merely old.
        </p>
        {health.recentRuns.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No ingest runs recorded yet. Runs are written by the <code>scripts/ingest-*.ts</code>{" "}
            entry points.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Target</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Fetched vs. provider</th>
                  <th className="py-2">Finished</th>
                </tr>
              </thead>
              <tbody>
                {health.recentRuns.map((r) => (
                  <tr
                    key={`${r.sourceCode}:${r.target}`}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="py-2 pr-4">{r.sourceCode}</td>
                    <td className="py-2 pr-4">{r.target}</td>
                    <td className="py-2 pr-4">
                      {r.status}
                      {r.truncated && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          TRUNCATED
                        </span>
                      )}
                      {r.error && (
                        <div className="text-xs text-red-600 dark:text-red-400">{r.error}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                      {r.fetched ?? "—"}
                      {r.providerTotal !== null ? ` / ${r.providerTotal}` : ""}
                      {r.skipped > 0 ? ` (${r.skipped} skipped)` : ""}
                    </td>
                    <td className="py-2 text-zinc-500">
                      {r.finishedAt ? formatTimestampUtc(r.finishedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sources</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">Tier</th>
              <th className="py-2">Last ingest</th>
            </tr>
          </thead>
          <tbody>
            {health.sources.map((s) => (
              <tr key={s.sourceCode} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4">
                  {s.sourceName} ({s.sourceCode})
                </td>
                <td className="py-2 pr-4">{s.tier}</td>
                <td className="py-2 text-zinc-500">
                  {s.lastIngestAt ? formatTimestampUtc(s.lastIngestAt) : "never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
