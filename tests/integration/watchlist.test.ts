import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("watchlist (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let addWatchlistItem: typeof import("@/server/domain/watchlist").addWatchlistItem;
  let removeWatchlistItem: typeof import("@/server/domain/watchlist").removeWatchlistItem;
  let listWatchlist: typeof import("@/server/domain/watchlist").listWatchlist;
  let userId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ addWatchlistItem, removeWatchlistItem, listWatchlist } =
      await import("@/server/domain/watchlist"));

    const existing = await prisma.user.findUnique({
      where: { email: "test-watchlist-user@example.com" },
    });
    if (existing) {
      await prisma.watchlistItem.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }

    const user = await prisma.user.create({
      data: {
        email: "test-watchlist-user@example.com",
        passwordHash: "test-fixture-not-a-real-hash",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.watchlistItem.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("adds an item and lists it back", async () => {
    await addWatchlistItem({
      userId,
      itemType: "COMPANY",
      itemRef: "320193",
      label: "Apple Inc.",
    });

    const items = await listWatchlist(userId);
    expect(items).toHaveLength(1);
    expect(items[0].itemRef).toBe("320193");
    expect(items[0].label).toBe("Apple Inc.");
  });

  it("is idempotent: adding the same item twice does not create a duplicate row", async () => {
    await addWatchlistItem({
      userId,
      itemType: "COMPANY",
      itemRef: "320193",
      label: "Apple Inc. (renamed)", // update is a no-op per the module's documented behavior
    });

    const items = await listWatchlist(userId, "COMPANY");
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("Apple Inc."); // original label preserved, not overwritten
  });

  it("allows the same itemRef under a different itemType (composite uniqueness)", async () => {
    await addWatchlistItem({
      userId,
      itemType: "ETF",
      itemRef: "320193", // same string, different type — should not collide
      label: "Not actually an ETF, just testing composite uniqueness",
    });

    const items = await listWatchlist(userId);
    expect(items).toHaveLength(2);
  });

  it("removeWatchlistItem is idempotent and reports whether anything was removed", async () => {
    const first = await removeWatchlistItem(userId, "ETF", "320193");
    expect(first.removed).toBe(true);

    const second = await removeWatchlistItem(userId, "ETF", "320193");
    expect(second.removed).toBe(false); // already gone — no-op, not an error

    const items = await listWatchlist(userId);
    expect(items).toHaveLength(1); // only the COMPANY item remains
  });

  it("filters by itemType", async () => {
    await addWatchlistItem({
      userId,
      itemType: "INDICATOR",
      itemRef: "DGS10",
      label: "US 10Y Treasury Yield",
    });

    const companies = await listWatchlist(userId, "COMPANY");
    const indicators = await listWatchlist(userId, "INDICATOR");
    expect(companies).toHaveLength(1);
    expect(indicators).toHaveLength(1);
    expect(indicators[0].itemRef).toBe("DGS10");
  });
});
