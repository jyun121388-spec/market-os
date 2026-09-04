"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/actions/auth";
import {
  addWatchlistItem,
  removeWatchlistItem,
  countWatchlistItems,
} from "@/server/domain/watchlist";
import { WatchlistItemType } from "@/generated/prisma/client";

/**
 * Server-action boundary for the Watchlist (M19). The domain module underneath was built and
 * tested in M19 but had no caller from any page — this is the wiring that gives it a real
 * request path (docs/RELEASE_READINESS.md's Watchlist row).
 *
 * Security invariants for this file, from the 2026-08-17 audit of this request path:
 *
 *  1. `userId` is ALWAYS taken from the validated session cookie, never from the submitted
 *     form. A form field is attacker-controlled; accepting one here would turn every per-user
 *     scope check in the domain module into decoration. Do not add a `userId` form input.
 *  2. No action accepts a `WatchlistItem.id`. Removal is addressed by (itemType, itemRef),
 *     which is only ever resolved together with the session user's id — so there is no direct
 *     object reference for an attacker to tamper with in the first place. Do not "optimise"
 *     this into a delete-by-row-id: that would create the IDOR this design avoids.
 *  3. EVERY exported async function in a "use server" module is a network-reachable endpoint,
 *     whether or not any page calls it. Do not export helpers from here for convenience —
 *     an unused export is not dead code, it is an unauthenticated-by-default HTTP surface.
 *     `tests/integration/watchlist-actions.test.ts` asserts the exact export list.
 */

const MAX_ITEM_REF_LENGTH = 128;
const MAX_LABEL_LENGTH = 128;
// Per-user cap. Nothing else bounds how many rows one authenticated account can create, and
// an unbounded per-user table is a cheap way for a single account to grow the database without
// limit. Well above any plausible real watchlist, low enough to stay a bound.
const MAX_ITEMS_PER_USER = 500;

const ITEM_TYPES = Object.values(WatchlistItemType) as string[];

export interface WatchlistFormState {
  error?: string;
}

function parseItemType(raw: string): WatchlistItemType | null {
  return ITEM_TYPES.includes(raw) ? (raw as WatchlistItemType) : null;
}

export async function addWatchlistItemAction(
  _prevState: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "You must be logged in to change your watchlist." };
  }

  const itemType = parseItemType(String(formData.get("itemType") ?? ""));
  if (!itemType) {
    return { error: "Pick a valid item type." };
  }

  const itemRef = String(formData.get("itemRef") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();

  if (!itemRef) {
    return { error: "Reference is required (ticker, corp code, series id, or theme)." };
  }
  if (itemRef.length > MAX_ITEM_REF_LENGTH) {
    return { error: `Reference must be ${MAX_ITEM_REF_LENGTH} characters or fewer.` };
  }
  if (!label) {
    return { error: "Label is required." };
  }
  if (label.length > MAX_LABEL_LENGTH) {
    return { error: `Label must be ${MAX_LABEL_LENGTH} characters or fewer.` };
  }

  // Checked before the write, and only as a cap on growth — adding an item already on the list
  // is idempotent and must keep working even at the cap, so the count check is scoped to the
  // insert path by letting addWatchlistItem no-op on an existing row.
  if (await isAtItemCap(user.id, itemType, itemRef)) {
    return {
      error: `Your watchlist is limited to ${MAX_ITEMS_PER_USER} items. Remove something first.`,
    };
  }

  await addWatchlistItem({ userId: user.id, itemType, itemRef, label });
  revalidatePath("/watchlist");
  return {};
}

/**
 * Best-effort, and deliberately so — it is a count followed by an insert, which is the same
 * read-then-write shape corrected elsewhere in this codebase. A user submitting many adds
 * concurrently could land a few rows past 500.
 *
 * Left as-is rather than enforced with a trigger or a counter column, because the cap is an
 * abuse guard rather than an invariant: nothing depends on the number being exactly 500, and
 * overshooting by a handful has no consequence. Recorded here so the looseness is a decision
 * rather than an oversight — an exact-sounding limit that is not exact is worth saying out loud.
 */
async function isAtItemCap(
  userId: string,
  itemType: WatchlistItemType,
  itemRef: string,
): Promise<boolean> {
  const count = await countWatchlistItems(userId);
  if (count < MAX_ITEMS_PER_USER) return false;
  // At the cap, re-adding something already tracked is a no-op rather than growth — allow it.
  const items = await countWatchlistItems(userId, { itemType, itemRef });
  return items === 0;
}

export async function removeWatchlistItemAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    // Not an error path worth surfacing: an unauthenticated caller has no watchlist to change,
    // and the page itself already redirects to /login.
    return;
  }

  const itemType = parseItemType(String(formData.get("itemType") ?? ""));
  const itemRef = String(formData.get("itemRef") ?? "");
  if (!itemType || !itemRef) {
    return;
  }

  await removeWatchlistItem(user.id, itemType, itemRef);
  revalidatePath("/watchlist");
}
