import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
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

/**
 * Ingests one news/metadata mention: dedupes exact-URL repeats, clusters into an existing
 * Event via deterministic keyword-similarity matching (eventClustering.ts), or creates a new
 * Event if nothing matches closely enough. See docs/DATA_POLICY.md "News policy" — only
 * metadata is stored here, and `raw` must never contain full article body text.
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

  if (match) {
    await prisma.eventMention.create({
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
    const distinctTierCount = await countDistinctTiers(match.event.id);

    await prisma.event.update({
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

    return {
      status: "joined_existing_event",
      eventId: match.event.id,
      similarity: match.similarity,
    };
  }

  const event = await prisma.event.create({
    data: {
      topic: mention.title,
      keywords: [...mentionKeywords],
      firstSeenAt: mention.publishedAt,
      latestUpdateAt: mention.publishedAt,
      mentionCount: 1,
      distinctTierCount: source ? 1 : 0,
    },
  });

  await prisma.eventMention.create({
    data: {
      eventId: event.id,
      sourceId: source?.id,
      title: mention.title,
      url: mention.url,
      publishedAt: mention.publishedAt,
      raw: mention.raw,
    },
  });

  return { status: "created_new_event", eventId: event.id };
}

async function countDistinctTiers(eventId: string): Promise<number> {
  const mentions = await prisma.eventMention.findMany({
    where: { eventId },
    select: { source: { select: { tier: true } } },
  });
  const tiers = new Set(mentions.map((m) => m.source?.tier).filter(Boolean));
  return tiers.size;
}
