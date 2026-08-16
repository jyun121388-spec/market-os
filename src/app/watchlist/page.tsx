import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { listWatchlist } from "@/server/domain/watchlist";
import { removeWatchlistItemAction } from "@/server/actions/watchlist";
import { formatTimestampUtc } from "@/lib/formatDate";
import { AddWatchlistForm } from "./AddWatchlistForm";

export const dynamic = "force-dynamic"; // per-user data, never statically cached

/**
 * Watchlist (M19). Tracking-only personalization: which items a user follows. This page
 * deliberately shows no judgment about those items — no score, no rating, no suggested action
 * (docs/LEGAL_GUARDRAILS.md). It is a filter over what information the user cares about.
 */
export default async function WatchlistPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const items = await listWatchlist(user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <p className="text-sm text-zinc-500">
            The companies, ETFs, indicators, industries and themes you track. Tracking an item
            changes what you see — it is not a judgment about the item.
          </p>
        </div>
        <Link href="/today" className="shrink-0 text-sm font-medium underline">
          Today
        </Link>
      </header>

      <AddWatchlistForm />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Tracked items ({items.length})</h2>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nothing tracked yet. Add an item above to start following it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-4 rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div>
                  <div className="font-medium">{item.label}</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    {item.itemType} · {item.itemRef}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Added {formatTimestampUtc(item.addedAt)}
                  </div>
                </div>
                <form action={removeWatchlistItemAction}>
                  <input type="hidden" name="itemType" value={item.itemType} />
                  <input type="hidden" name="itemRef" value={item.itemRef} />
                  <button type="submit" className="text-sm text-zinc-500 underline">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
