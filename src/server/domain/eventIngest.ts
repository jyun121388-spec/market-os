import { prisma } from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";
import {
  DEFAULT_CLUSTERING_OPTIONS,
  extractKeywords,
  findMatchingEvent,
  type ClusteringOptions,
} from "./eventClustering";

export interface MentionInput {
  title: string;
  url: string;
  publishedAt: Date;
  sourceCode?: string; // Source.code, if known (see docs/DATA_POLICY.md "Source hierarchy")
  raw: Prisma.InputJsonValue; // metadata only — never full article text
}

export type IngestMentionResult =
  | { status: "duplicate"; eventId: string }
  | { status: "joined_existing_event"; eventId: string; similarity: number }
  | { status: "created_new_event"; eventId: string };

/** Unique constraint violation — here, two writers racing on the same `EventMention.url`. */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

/**
 * Ingests one news/metadata mention: dedupes exact-URL repeats, clusters into an existing
 * Event via deterministic keyword-similarity matching (eventClustering.ts), or creates a new
 * Event if nothing matches closely enough. See docs/DATA_POLICY.md "News policy" — only
 * metadata is stored here, and `raw` must never contain full article body text.
 *
 * Two concurrency properties, both added on 2026-08-17 after this turned out to be the fourth
 * instance of the same mistake found elsewhere in the codebase:
 *
 *  1. The `findUnique` below is a hint, not a guarantee. It is a read-then-write pretending to
 *     be atomic: two concurrent ingests of the same URL both see nothing and both insert, and
 *     the loser used to get a raw P2002 for what this function's own contract calls a duplicate.
 *     Reproduced before fixing — four concurrent calls with one URL rejected three of four. The
 *     unique index on `url` already guarantees the invariant, so losing the race IS the correct
 *     outcome: report the duplicate the winner created.
 *  2. An Event and its first EventMention are written in ONE transaction. They were two separate
 *     statements, so a mention insert failing after the event insert succeeded would leave an
 *     Event claiming `mentionCount: 1` with no mentions attached — a row that renders on
 *     `/today` as a real event with a count that nothing backs. Same for the join path, where a
 *     failed `event.update` would leave the count behind the mentions.
 */
export async function ingestMention(
  mention: MentionInput,
  options: ClusteringOptions = DEFAULT_CLUSTERING_OPTIONS,
): Promise<IngestMentionResult> {
  const existingMention = await prisma.eventMention.findUnique({ where: { url: mention.url } });
  if (existingMention) {
    return { status: "duplicate", eventId: existingMention.eventId };
  }

  const source = mention.sourceCode
    ? await prisma.source.findUnique({ where: { code: mention.sourceCode } })
    : null;

  const windowMs = options.windowHours * 60 * 60 * 1000;
  const candidates = await prisma.event.findMany({
    where: {
      latestUpdateAt: {
        gte: new Date(mention.publishedAt.getTime() - windowMs),
        lte: new Date(mention.publishedAt.getTime() + windowMs),
      },
    },
    select: { id: true, keywords: true, latestUpdateAt: true },
  });

  const mentionKeywords = extractKeywords(mention.title);
  const match = findMatchingEvent(mentionKeywords, mention.publishedAt, candidates, options);

  try {
    if (match) {
      // Mention insert and the event's counters move together, so the count can never describe
      // mentions that are not there.
      await prisma.$transaction(async (tx) => {
        await tx.eventMention.create({
          data: {
            eventId: match.event.id,
            sourceId: source?.id,
            title: mention.title,
            url: mention.url,
            publishedAt: mention.publishedAt,
            raw: mention.raw,
          },
        });

        const mergedKeywords = new Set([...match.event.keywords, ...mentionKeywords]);
        const distinctTierCount = await countDistinctTiers(tx, match.event.id);

        await tx.event.update({
          where: { id: match.event.id },
          data: {
            keywords: [...mergedKeywords],
            latestUpdateAt:
              mention.publishedAt > match.event.latestUpdateAt
                ? mention.publishedAt
                : match.event.latestUpdateAt,
            mentionCount: { increment: 1 },
            distinctTierCount,
          },
        });
      });

      return {
        status: "joined_existing_event",
        eventId: match.event.id,
        similarity: match.similarity,
      };
    }

    const eventId = await prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          topic: mention.title,
          keywords: [...mentionKeywords],
          firstSeenAt: mention.publishedAt,
          latestUpdateAt: mention.publishedAt,
          mentionCount: 1,
          distinctTierCount: source ? 1 : 0,
        },
      });

      await tx.eventMention.create({
        data: {
          eventId: event.id,
          sourceId: source?.id,
          title: mention.title,
          url: mention.url,
          publishedAt: mention.publishedAt,
          raw: mention.raw,
        },
      });

      return event.id;
    });

    return { status: "created_new_event", eventId };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    // A concurrent writer inserted this URL between our check and our write. The transaction
    // rolled back, so no partial event survives. Report what the winner created rather than
    // failing an operation whose contract is "duplicates are a no-op".
    const winner = await prisma.eventMention.findUnique({ where: { url: mention.url } });
    if (!winner) throw err; // the violation was something else entirely — do not swallow it
    return { status: "duplicate", eventId: winner.eventId };
  }
}

/** Runs inside the caller's transaction so the count reflects the mention just inserted. */
async function countDistinctTiers(tx: Prisma.TransactionClient, eventId: string): Promise<number> {
  const mentions = await tx.eventMention.findMany({
    where: { eventId },
    select: { source: { select: { tier: true } } },
  });
  const tiers = new Set(mentions.map((m) => m.source?.tier).filter(Boolean));
  return tiers.size;
}
