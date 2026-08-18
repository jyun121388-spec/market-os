import { prisma } from "@/server/db/client";
import { Prisma, type WatchlistItemType } from "@/generated/prisma/client";

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

/**
 * Idempotent: adding the same (user, itemType, itemRef) twice returns the existing row.
 *
 * The P2002 catch is not defensive padding. `upsert` is only atomic when Prisma can compile it
 * to a single `INSERT ... ON CONFLICT`; with an empty `update` it may fall back to a
 * read-then-write, and two concurrent submissions of the same item then race — one inserts, the
 * other violates `@@unique([userId, itemType, itemRef])` and surfaces a raw P2002 to the user
 * for what the contract above calls a no-op. This is the same shape of bug as the observation
 * revision-chain race (docs/DECISIONS.md, 2026-08-17): a read-then-write treated as atomic.
 * Here the unique constraint already guarantees the invariant, so losing the race IS the
 * correct outcome — return the row the winner created.
 */
export async function addWatchlistItem(input: AddWatchlistItemInput) {
  const where = {
    userId_itemType_itemRef: {
      userId: input.userId,
      itemType: input.itemType,
      itemRef: input.itemRef,
    },
  };

  try {
    return await prisma.watchlistItem.upsert({
      where,
      update: {}, // already present — no-op, does not refresh the label or addedAt
      create: input,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" // unique constraint — a concurrent caller inserted the same item
    ) {
      return prisma.watchlistItem.findUniqueOrThrow({ where });
    }
    throw err;
  }
}

/**
 * Counts a user's tracked items, optionally narrowed to one exact (itemType, itemRef). Scoped
 * by userId like every other function here — a count that leaked across users would be a slow
 * enumeration oracle, not just a wrong number.
 */
export async function countWatchlistItems(
  userId: string,
  narrow?: { itemType: WatchlistItemType; itemRef: string },
): Promise<number> {
  return prisma.watchlistItem.count({
    where: { userId, ...(narrow ?? {}) },
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
    // ORDERING_WAIVER: the user's own list, newest first. Two items added in the same millisecond may appear in either order, which is invisible and harmless.
    orderBy: { addedAt: "desc" },
  });
}
