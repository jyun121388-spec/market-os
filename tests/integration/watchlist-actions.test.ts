import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Watchlist server-action boundary (the wiring added when the Watchlist finally got a page).
 *
 * The M19 domain module was already tested in tests/integration/watchlist.test.ts, but every
 * one of those tests passes `userId` in directly — so cross-user isolation was only ever
 * verified at the function-signature level (docs/RELEASE_READINESS.md's Watchlist row said
 * exactly this). These tests exercise the layer that actually decides *whose* userId is used:
 * the session cookie. The failure mode they exist to catch is an action that trusts a
 * form-supplied userId, or one that mutates another user's list.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const USER_A_EMAIL = "test-watchlist-actions-a@example.com";
const USER_B_EMAIL = "test-watchlist-actions-b@example.com";

// Mutable: each test points the mocked cookie store at whichever user's session it is acting as.
let activeSessionToken: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "market_os_session" && activeSessionToken
        ? { name, value: activeSessionToken }
        : undefined,
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describeIfDb("watchlist server actions (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let actions: typeof import("@/server/actions/watchlist");
  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    actions = await import("@/server/actions/watchlist");
    const { createSession } = await import("@/server/domain/auth");

    for (const email of [USER_A_EMAIL, USER_B_EMAIL]) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        await prisma.watchlistItem.deleteMany({ where: { userId: existing.id } });
        await prisma.session.deleteMany({ where: { userId: existing.id } });
        await prisma.user.delete({ where: { id: existing.id } });
      }
    }

    const userA = await prisma.user.create({
      data: { email: USER_A_EMAIL, passwordHash: "test-fixture-not-a-real-hash" },
    });
    const userB = await prisma.user.create({
      data: { email: USER_B_EMAIL, passwordHash: "test-fixture-not-a-real-hash" },
    });
    userAId = userA.id;
    userBId = userB.id;
    tokenA = (await createSession(userAId)).id;
    tokenB = (await createSession(userBId)).id;
    // Vitest's default 10s hook timeout is not enough for eight sequential statements against a
    // Postgres shared with the rest of the suite. This hook has exceeded it under load, and the
    // timeout was not evidence of a defect — the work genuinely takes longer when the database is
    // busy, and a hook that fails for being slow produces a failure nobody can act on.
  }, 60_000);

  afterAll(async () => {
    for (const id of [userAId, userBId]) {
      // Skip an id the setup never assigned.
      //
      // When `beforeAll` timed out under database contention, these were undefined, and
      // `user.delete({ where: { id: undefined } })` threw a Prisma validation error — which became
      // the REPORTED failure and buried the timeout that actually caused it. That is why an
      // earlier intermittent failure in this suite went unidentified through eight clean reruns:
      // the error on screen was the cleanup's, not the cause's.
      //
      // Deliberately NOT `deleteMany`, which is the obvious-looking fix and is far worse: Prisma
      // reads `undefined` in a filter as "no condition", so `deleteMany({ where: { id: undefined } })`
      // is `deleteMany({})` and would delete every user in the database.
      if (!id) continue;
      await prisma.watchlistItem.deleteMany({ where: { userId: id } });
      await prisma.session.deleteMany({ where: { userId: id } });
      await prisma.user.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it("refuses to add anything when there is no session", async () => {
    activeSessionToken = undefined;
    const state = await actions.addWatchlistItemAction(
      {},
      form({ itemType: "COMPANY", itemRef: "AAPL", label: "Apple Inc." }),
    );
    expect(state.error).toMatch(/logged in/i);
    expect(await prisma.watchlistItem.count()).toBe(0);
  });

  it("adds the item to the session user's own list", async () => {
    activeSessionToken = tokenA;
    const state = await actions.addWatchlistItemAction(
      {},
      form({ itemType: "COMPANY", itemRef: "AAPL", label: "Apple Inc." }),
    );
    expect(state.error).toBeUndefined();

    const items = await prisma.watchlistItem.findMany({ where: { userId: userAId } });
    expect(items).toHaveLength(1);
    expect(items[0].itemRef).toBe("AAPL");
  });

  it("ignores a userId smuggled in through the form and uses the session user instead", async () => {
    activeSessionToken = tokenA;
    await actions.addWatchlistItemAction(
      {},
      form({ itemType: "ETF", itemRef: "SPY", label: "S&P 500 ETF", userId: userBId }),
    );

    // The whole point: user B's list must be untouched no matter what the form claimed.
    expect(await prisma.watchlistItem.count({ where: { userId: userBId } })).toBe(0);
    expect(await prisma.watchlistItem.count({ where: { userId: userAId } })).toBe(2);
  });

  it("cannot remove another user's item, even with an exact (itemType, itemRef) match", async () => {
    activeSessionToken = tokenB;
    await actions.addWatchlistItemAction(
      {},
      form({ itemType: "COMPANY", itemRef: "AAPL", label: "Apple Inc. (B's copy)" }),
    );
    expect(await prisma.watchlistItem.count({ where: { userId: userBId } })).toBe(1);

    // B removes "AAPL" — this must delete B's row only, never A's identically-keyed row.
    await actions.removeWatchlistItemAction(form({ itemType: "COMPANY", itemRef: "AAPL" }));

    expect(await prisma.watchlistItem.count({ where: { userId: userBId } })).toBe(0);
    const aItems = await prisma.watchlistItem.findMany({ where: { userId: userAId } });
    expect(aItems.map((i) => i.itemRef).sort()).toEqual(["AAPL", "SPY"]);
  });

  it("exposes exactly two server actions and nothing else", async () => {
    // Every exported async function in a "use server" module is a network-reachable endpoint,
    // reachable by anyone who knows its action id — whether or not a page calls it. An export
    // added here "just as a helper" is therefore new attack surface, not dead code. This
    // originally caught a `listCurrentUserWatchlist` read endpoint that no page ever used.
    const exported = Object.keys(actions).sort();
    expect(exported).toEqual(["addWatchlistItemAction", "removeWatchlistItemAction"]);
  });

  it("rejects an unknown itemType rather than coercing it", async () => {
    activeSessionToken = tokenA;
    const state = await actions.addWatchlistItemAction(
      {},
      form({ itemType: "NOT_A_REAL_TYPE", itemRef: "X", label: "X" }),
    );
    expect(state.error).toMatch(/valid item type/i);
    expect(await prisma.watchlistItem.count({ where: { userId: userAId } })).toBe(2);
  });

  it("rejects blank and over-long fields", async () => {
    activeSessionToken = tokenA;

    expect(
      (
        await actions.addWatchlistItemAction(
          {},
          form({ itemType: "THEME", itemRef: "   ", label: "x" }),
        )
      ).error,
    ).toMatch(/reference is required/i);

    expect(
      (
        await actions.addWatchlistItemAction(
          {},
          form({ itemType: "THEME", itemRef: "x", label: "  " }),
        )
      ).error,
    ).toMatch(/label is required/i);

    expect(
      (
        await actions.addWatchlistItemAction(
          {},
          form({ itemType: "THEME", itemRef: "x".repeat(129), label: "x" }),
        )
      ).error,
    ).toMatch(/128 characters or fewer/i);

    expect(await prisma.watchlistItem.count({ where: { userId: userAId } })).toBe(2);
  });

  it("does not mutate anything when an expired session is presented", async () => {
    const expired = await prisma.session.create({
      data: {
        id: "expired-watchlist-action-token-".padEnd(64, "0"),
        userId: userAId,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    activeSessionToken = expired.id;

    const state = await actions.addWatchlistItemAction(
      {},
      form({ itemType: "THEME", itemRef: "should-not-land", label: "should not land" }),
    );
    expect(state.error).toMatch(/logged in/i);
    expect(await prisma.watchlistItem.count({ where: { userId: userAId } })).toBe(2);
  });

  it("concurrent submissions of the same item settle as one row, not a raw constraint error", async () => {
    // Same failure shape as the observation revision-chain race: a read-then-write that looks
    // atomic. `upsert` with an empty `update` can fall back to read-then-write, and the loser
    // of the race would surface a raw P2002 for what the domain module documents as a no-op.
    activeSessionToken = tokenA;
    const submissions = Array.from({ length: 6 }, () =>
      actions.addWatchlistItemAction(
        {},
        form({ itemType: "INDUSTRY", itemRef: "semiconductors", label: "Semiconductors" }),
      ),
    );

    const results = await Promise.all(submissions);
    for (const r of results) {
      expect(r.error).toBeUndefined();
    }

    const rows = await prisma.watchlistItem.findMany({
      where: { userId: userAId, itemType: "INDUSTRY", itemRef: "semiconductors" },
    });
    expect(rows).toHaveLength(1);

    await prisma.watchlistItem.deleteMany({
      where: { userId: userAId, itemType: "INDUSTRY", itemRef: "semiconductors" },
    });
  });

  it("caps how many items one account can accumulate, while still allowing re-adds at the cap", async () => {
    // Nothing else bounds per-user growth; an authenticated account could otherwise enlarge the
    // table without limit. Seeded directly rather than through 500 action calls — the action is
    // what is under test at the boundary, not the 498 uneventful inserts before it.
    activeSessionToken = tokenA;
    const existing = await prisma.watchlistItem.count({ where: { userId: userAId } });
    await prisma.watchlistItem.createMany({
      data: Array.from({ length: 500 - existing }, (_, i) => ({
        userId: userAId,
        itemType: "THEME" as const,
        itemRef: `filler-${i}`,
        label: `Filler ${i}`,
      })),
    });
    expect(await prisma.watchlistItem.count({ where: { userId: userAId } })).toBe(500);

    const blocked = await actions.addWatchlistItemAction(
      {},
      form({ itemType: "THEME", itemRef: "one-too-many", label: "One too many" }),
    );
    expect(blocked.error).toMatch(/limited to 500 items/i);
    expect(await prisma.watchlistItem.count({ where: { userId: userAId } })).toBe(500);

    // Re-adding something already tracked is a no-op, not growth — it must still succeed.
    const reAdd = await actions.addWatchlistItemAction(
      {},
      form({ itemType: "THEME", itemRef: "filler-0", label: "Filler 0" }),
    );
    expect(reAdd.error).toBeUndefined();
    expect(await prisma.watchlistItem.count({ where: { userId: userAId } })).toBe(500);

    // The cap is per user, so B is unaffected by A being full.
    activeSessionToken = tokenB;
    const forB = await actions.addWatchlistItemAction(
      {},
      form({ itemType: "THEME", itemRef: "b-is-fine", label: "B is fine" }),
    );
    expect(forB.error).toBeUndefined();
    expect(await prisma.watchlistItem.count({ where: { userId: userBId } })).toBe(1);
  });
});
