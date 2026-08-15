import { prisma } from "@/server/db/client";
import type { WatchlistItemType } from "@/generated/prisma/client";

/**
 * Watchlist (docs/PRODUCT_SPEC.md "Watchlist"). Personalization is limited to information
 * filtering — which items a user tracks — never personalized investment judgment. This module
 * has no opinion about what a user *should* watch or what they should do about it; it only
 * stores and retrieves their own choices.
 */

export interface AddWatchlistItemInput {
  userId: string;
  itemType: WatchlistItemType;
  itemRef: string;
  label: string;
}

/** Idempotent: adding the same (user, itemType, itemRef) twice returns the existing row. */
export async function addWatchlistItem(input: AddWatchlistItemInput) {
  return prisma.watchlistItem.upsert({
    where: {
      userId_itemType_itemRef: {
        userId: input.userId,
        itemType: input.itemType,
        itemRef: input.itemRef,
      },
    },
    update: {}, // already present — no-op, does not refresh the label or addedAt
    create: input,
  });
}

/** Idempotent: removing an item that isn't on the list is a no-op, not an error. */
export async function removeWatchlistItem(
  userId: string,
  itemType: WatchlistItemType,
  itemRef: string,
): Promise<{ removed: boolean }> {
  const result = await prisma.watchlistItem.deleteMany({
    where: { userId, itemType, itemRef },
  });
  return { removed: result.count > 0 };
}

export async function listWatchlist(userId: string, itemType?: WatchlistItemType) {
  return prisma.watchlistItem.findMany({
    where: { userId, ...(itemType ? { itemType } : {}) },
    orderBy: { addedAt: "desc" },
  });
}
