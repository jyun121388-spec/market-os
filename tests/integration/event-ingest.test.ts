import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_SOURCE_A = "TEST_NEWS_WIRE_A";
const TEST_SOURCE_B = "TEST_NEWS_WIRE_B";

describeIfDb("event ingest (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let ingestMention: typeof import("@/server/domain/eventIngest").ingestMention;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ ingestMention } = await import("@/server/domain/eventIngest"));

    for (const code of [TEST_SOURCE_A, TEST_SOURCE_B]) {
      const existing = await prisma.source.findUnique({ where: { code } });
      if (existing) {
        await prisma.eventMention.deleteMany({ where: { sourceId: existing.id } });
        await prisma.source.delete({ where: { id: existing.id } });
      }
    }
    await prisma.eventMention.deleteMany({
      where: { url: { startsWith: "https://test.example/" } },
    });
    await prisma.event.deleteMany({ where: { topic: { startsWith: "TEST:" } } });

    await prisma.source.create({ data: { code: TEST_SOURCE_A, name: "Wire A", tier: "TIER_A" } });
    await prisma.source.create({ data: { code: TEST_SOURCE_B, name: "Wire B", tier: "TIER_B" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a new event for the first mention", async () => {
    const result = await ingestMention({
      title: "TEST: Fed Raises Rates by 25bps",
      url: "https://test.example/1",
      publishedAt: new Date("2026-08-15T09:00:00.000Z"),
      sourceCode: TEST_SOURCE_A,
      raw: { headline: "TEST: Fed Raises Rates by 25bps" },
    });
    expect(result.status).toBe("created_new_event");

    const event = await prisma.event.findUniqueOrThrow({ where: { id: result.eventId } });
    expect(event.mentionCount).toBe(1);
    expect(event.distinctTierCount).toBe(1);
  });

  it("clusters a similar mention from a different outlet into the same event", async () => {
    const first = await ingestMention({
      title: "TEST: Bank of Korea Cuts Base Rate to 2.75%",
      url: "https://test.example/2",
      publishedAt: new Date("2026-08-15T10:00:00.000Z"),
      sourceCode: TEST_SOURCE_A,
      raw: {},
    });
    expect(first.status).toBe("created_new_event");

    const second = await ingestMention({
      title: "TEST: BOK Cuts Base Rate to 2.75 Percent",
      url: "https://test.example/3",
      publishedAt: new Date("2026-08-15T10:30:00.000Z"),
      sourceCode: TEST_SOURCE_B,
      raw: {},
    });
    expect(second.status).toBe("joined_existing_event");
    expect(second.eventId).toBe(first.eventId);

    const event = await prisma.event.findUniqueOrThrow({ where: { id: first.eventId } });
    expect(event.mentionCount).toBe(2);
    expect(event.distinctTierCount).toBe(2); // TIER_A + TIER_B
  });

  it("does not cluster an unrelated headline into an existing event", async () => {
    const unrelated = await ingestMention({
      title: "TEST: Local Election Results Announced",
      url: "https://test.example/4",
      publishedAt: new Date("2026-08-15T11:00:00.000Z"),
      sourceCode: TEST_SOURCE_A,
      raw: {},
    });
    expect(unrelated.status).toBe("created_new_event");
  });

  it("treats a re-ingested identical URL as a duplicate, not a new mention", async () => {
    const first = await ingestMention({
      title: "TEST: Oil Prices Surge on Supply Concerns",
      url: "https://test.example/5",
      publishedAt: new Date("2026-08-15T12:00:00.000Z"),
      sourceCode: TEST_SOURCE_A,
      raw: {},
    });

    const duplicate = await ingestMention({
      title: "TEST: Oil Prices Surge on Supply Concerns",
      url: "https://test.example/5",
      publishedAt: new Date("2026-08-15T12:00:00.000Z"),
      sourceCode: TEST_SOURCE_A,
      raw: {},
    });

    expect(duplicate).toEqual({ status: "duplicate", eventId: first.eventId });

    const event = await prisma.event.findUniqueOrThrow({ where: { id: first.eventId } });
    expect(event.mentionCount).toBe(1); // unchanged by the duplicate
  });

  it("survives concurrent ingests of the same URL without throwing", async () => {
    // The fourth instance of read-then-write-treated-as-atomic found in this codebase, after
    // the observation revision chain, the watchlist upsert and the filing ingests. The
    // `findUnique` dedupe check is a hint, not a guarantee: concurrent callers all see nothing
    // and all insert. Reproduced before fixing — four concurrent calls with one URL rejected
    // three of four with a raw P2002, for what this function's own contract calls a duplicate.
    const url = "https://test.example/concurrent-same-url";
    const mention = {
      title: "TEST: Central Bank Holds Policy Rate Steady",
      url,
      publishedAt: new Date("2026-08-15T15:00:00.000Z"),
      sourceCode: TEST_SOURCE_A,
      raw: {},
    };

    // Promise.all rejects if any call throws, which is half the assertion.
    const results = await Promise.all([
      ingestMention({ ...mention }),
      ingestMention({ ...mention }),
      ingestMention({ ...mention }),
      ingestMention({ ...mention }),
    ]);

    // Exactly one row for the URL, and every caller agrees which event it belongs to.
    const stored = await prisma.eventMention.findMany({ where: { url } });
    expect(stored).toHaveLength(1);
    const eventIds = new Set(results.map((r) => r.eventId));
    expect(eventIds.size).toBe(1);
    expect([...eventIds][0]).toBe(stored[0].eventId);
  });

  it("never leaves an Event claiming mentions that do not exist", async () => {
    // An Event and its first EventMention used to be two separate statements, so a mention
    // insert failing after the event insert succeeded would leave an Event with
    // `mentionCount: 1` and nothing attached — a row that renders on /today as a real event
    // with a count nothing backs. They are written in one transaction now, so a rollback takes
    // the event with it.
    const events = await prisma.event.findMany({
      where: { topic: { startsWith: "TEST:" } },
      include: { mentions: { select: { id: true } } },
    });

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.mentions.length).toBeGreaterThan(0);
      // And the stored counter agrees with the rows actually present.
      expect(event.mentionCount).toBe(event.mentions.length);
    }
  });
});
