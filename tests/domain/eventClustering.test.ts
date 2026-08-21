import { describe, expect, it } from "vitest";
import {
  extractKeywords,
  findMatchingEvent,
  jaccardSimilarity,
  type ClusterCandidateEvent,
} from "@/server/domain/eventClustering";

describe("extractKeywords", () => {
  it("lowercases and drops stopwords and short tokens", () => {
    const keywords = extractKeywords("The Fed Raises Rates by 25bps After Meeting");
    expect(keywords.has("the")).toBe(false);
    expect(keywords.has("by")).toBe(false);
    expect(keywords.has("fed")).toBe(true);
    expect(keywords.has("raises")).toBe(true);
    expect(keywords.has("25bps")).toBe(true);
  });
});

describe("jaccardSimilarity", () => {
  it("is 1 for identical sets", () => {
    const a = new Set(["fed", "rates", "hike"]);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("is 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["fed"]), new Set(["oil"]))).toBe(0);
  });

  it("computes partial overlap correctly", () => {
    const a = new Set(["fed", "rates", "hike"]);
    const b = new Set(["fed", "rates", "pause"]);
    // intersection = {fed, rates} = 2, union = {fed, rates, hike, pause} = 4
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });
});

describe("findMatchingEvent", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const candidates: ClusterCandidateEvent[] = [
    { id: "ev1", keywords: ["fed", "rates", "hike", "meeting"], latestUpdateAt: now },
    { id: "ev2", keywords: ["oil", "opec", "production", "cut"], latestUpdateAt: now },
  ];

  it("matches a mention with high keyword overlap", () => {
    const mentionKeywords = extractKeywords("Fed Hikes Rates After Meeting");
    const result = findMatchingEvent(mentionKeywords, now, candidates);
    expect(result?.event.id).toBe("ev1");
  });

  it("returns null when nothing clears the similarity threshold", () => {
    const mentionKeywords = extractKeywords("Local Bakery Wins Award");
    const result = findMatchingEvent(mentionKeywords, now, candidates);
    expect(result).toBeNull();
  });

  it("excludes candidates outside the time window even with a perfect keyword match", () => {
    const mentionKeywords = new Set(["fed", "rates", "hike", "meeting"]);
    const farFuture = new Date(now.getTime() + 200 * 60 * 60 * 1000); // 200h later
    const result = findMatchingEvent(mentionKeywords, farFuture, candidates, {
      windowHours: 72,
      similarityThreshold: 0.4,
    });
    expect(result).toBeNull();
  });

  it("picks the higher-similarity candidate when multiple match", () => {
    const dual: ClusterCandidateEvent[] = [
      { id: "close", keywords: ["fed", "rates", "hike"], latestUpdateAt: now },
      { id: "closer", keywords: ["fed", "rates", "hike", "meeting"], latestUpdateAt: now },
    ];
    const mentionKeywords = extractKeywords("Fed Hikes Rates After Meeting Today");
    const result = findMatchingEvent(mentionKeywords, now, dual);
    expect(result?.event.id).toBe("closer");
  });
});
