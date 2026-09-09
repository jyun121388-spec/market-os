import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeSystemHealth } from "@/server/domain/systemHealth";
import { computeCalendar } from "@/server/domain/economicCalendar";
import { evaluateStaleness } from "@/server/domain/staleness";
import { buildUserStatus, type UserStatus } from "@/lib/userStatus";

export const dynamic = "force-dynamic";

/**
 * System status, for the person who owns the installation rather than the person debugging it.
 *
 * `/admin` already exists and stays operator-only. Exposing it more widely was the obvious move
 * and the wrong one: it renders raw adapter error strings, ingest targets and run internals, which
 * is exactly right for an operator and exactly wrong for everybody else. The translation happens
 * in `src/lib/userStatus.ts`, which is pure so that "no adapter error reaches the user" is a
 * control rather than a promise — it is fed a fabricated error containing a connection string, an
 * absolute path, a PID and a stack frame, and asserted to leak none of them.
 *
 * This page reads only presence booleans for credentials. No value is read, rendered or logged.
 */
export default async function StatusPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [health, calendar] = await Promise.all([computeSystemHealth(), computeCalendar()]);

  // Freshness, counted the same way `/macro` reports it per indicator, so the two pages cannot
  // disagree about which series are stale.
  let stale = 0;
  let cadenceUnknown = 0;
  for (const entry of calendar) {
    if (
      entry.status !== "PROJECTED" ||
      entry.lastObservedDate === undefined ||
      entry.medianIntervalDays === undefined
    ) {
      cadenceUnknown += 1;
      continue;
    }
    const result = evaluateStaleness({
      lastObservedDate: entry.lastObservedDate,
      medianIntervalDays: entry.medianIntervalDays,
    });
    if (result.status === "STALE") stale += 1;
  }

  const status = buildUserStatus({
    health,
    // Presence only — `Boolean(...)` is the whole of what leaves the environment here.
    configured: {
      FRED: Boolean(process.env.FRED_API_KEY),
      DART: Boolean(process.env.DART_API_KEY),
      ECOS: Boolean(process.env.ECOS_API_KEY),
    },
    indicators: { total: calendar.length, stale, cadenceUnknown },
    // HG-006. Nothing in this repository implements the model sink, which
    // `tests/askCapabilityBoundary.test.ts` asserts structurally.
    generationEnabled: false,
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
        <p className="text-sm text-zinc-500">
          What Market OS can and cannot do right now, and why. Everything here describes this
          installation — no information about your setup leaves it.
        </p>
      </header>

      <p className={`rounded border p-4 text-sm ${overallTone(status.overall)}`}>
        <span className="font-medium">{overallLabel(status.overall)}</span> — {status.overallDetail}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Data providers</h2>
        <ul className="flex flex-col gap-2">
          {status.providers.map((p) => (
            <li
              key={p.sourceCode}
              className={`rounded border p-3 text-sm ${
                p.state === "HAS_DATA"
                  ? "border-zinc-200 dark:border-zinc-800"
                  : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{p.label}</span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  {p.state}
                  {p.optional ? " · optional" : ""}
                </span>
              </div>
              <div className="mt-1 text-zinc-600 dark:text-zinc-400">{p.detail}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What works right now</h2>
        <ul className="flex flex-col gap-2">
          {status.capabilities.map((c) => (
            <li
              key={c.name}
              className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">{c.state}</span>
              </div>
              <div className="mt-1 text-zinc-600 dark:text-zinc-400">{c.detail}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Data quality</h2>
        {status.issues.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nothing stored here is known to be incomplete, stale or in conflict.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {status.issues.map((issue, i) => (
              <li
                key={`${issue.kind}-${i}`}
                className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                <div className="font-medium">
                  {issueLabel(issue.kind)}
                  {issue.sourceCode ? ` — ${issue.sourceCode}` : ""}
                </div>
                <div className="mt-1">{issue.detail}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-zinc-500">
          <Link href="/macro" className="underline">
            Macro and regime
          </Link>{" "}
          lists every indicator held here with its own freshness.
        </p>
      </section>
    </div>
  );
}

function overallLabel(state: UserStatus["overall"]): string {
  if (state === "HEALTHY") return "Everything is working";
  if (state === "DEGRADED") return "Working, with gaps";
  return "No data yet";
}

function overallTone(state: UserStatus["overall"]): string {
  if (state === "HEALTHY") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  }
  return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
}

function issueLabel(kind: string): string {
  switch (kind) {
    case "FAILED_INGEST":
      return "A data fetch did not finish";
    case "PARTIAL_INGEST":
      return "Only part of a provider's data was stored";
    case "STALE_DATA":
      return "Some indicators are out of date";
    case "DATA_CONFLICT":
      return "Some stored figures disagree";
    default:
      return kind;
  }
}
