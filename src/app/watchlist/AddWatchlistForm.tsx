"use client";

import { useActionState } from "react";
import { addWatchlistItemAction, type WatchlistFormState } from "@/server/actions/watchlist";

const initialState: WatchlistFormState = {};

const ITEM_TYPE_HINTS: Record<string, string> = {
  COMPANY: "ticker or corp code, e.g. AAPL / 00126380",
  ETF: "ticker, e.g. SPY",
  INDICATOR: "series id, e.g. CPIAUCSL",
  INDUSTRY: "industry name",
  THEME: "free-text theme",
};

export function AddWatchlistForm() {
  const [state, formAction, pending] = useActionState(addWatchlistItemAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            name="itemType"
            defaultValue="COMPANY"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          >
            {Object.keys(ITEM_TYPE_HINTS).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Reference
          <input
            type="text"
            name="itemRef"
            required
            maxLength={128}
            placeholder="AAPL"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Label
          <input
            type="text"
            name="label"
            required
            maxLength={128}
            placeholder="Apple Inc."
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          />
        </label>
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add to watchlist"}
      </button>
    </form>
  );
}
