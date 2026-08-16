"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/actions/auth";
import { addWatchlistItem, removeWatchlistItem, listWatchlist } from "@/server/domain/watchlist";
import { WatchlistItemType } from "@/generated/prisma/client";

/**
 * Server-action boundary for the Watchlist (M19). The domain module underneath was built and
 * tested in M19 but had no caller from any page — this is the wiring that gives it a real
 * request path (docs/RELEASE_READINESS.md's Watchlist row).
 *
 * Security invariant: `userId` is ALWAYS taken from the validated session cookie, never from
 * the submitted form. A form field is attacker-controlled; accepting one here would turn every
 * per-user scope check in the domain module into decoration. Do not add a `userId` form input.
 */

const MAX_ITEM_REF_LENGTH = 128;
const MAX_LABEL_LENGTH = 128;

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

  await addWatchlistItem({ userId: user.id, itemType, itemRef, label });
  revalidatePath("/watchlist");
  return {};
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

/** Read side, session-scoped. Returns an empty list rather than throwing when signed out. */
export async function listCurrentUserWatchlist() {
  const user = await getCurrentUser();
  if (!user) return [];
  return listWatchlist(user.id);
}
