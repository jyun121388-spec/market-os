import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeSystemHealth } from "@/server/domain/systemHealth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
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
                  {s.lastIngestAt ? new Date(s.lastIngestAt).toLocaleString() : "never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
