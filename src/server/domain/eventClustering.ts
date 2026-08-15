/**
 * Deterministic event clustering (docs/ARCHITECTURE.md "Event Intelligence"): decides whether
 * a new news/metadata mention belongs to an existing Event or should start a new one. No LLM
 * is used to make this decision — see docs/AI_RESOURCE_POLICY.md "prefer deterministic
 * calculations" and CLAUDE.md's zero-extra-AI-cost rule. The heuristic is intentionally simple
 * and inspectable: keyword-set overlap (Jaccard similarity) within a time window.
 */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "are",
  "with",
  "at",
  "by",
  "as",
  "its",
  "will",
  "after",
  "over",
]);

/** Extracts a lowercase keyword set from a headline, dropping stopwords and short tokens. */
export function extractKeywords(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return new Set(tokens);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface ClusterCandidateEvent {
  id: string;
  keywords: string[];
  latestUpdateAt: Date;
}

export interface ClusteringOptions {
  /** How far back an event can still be considered "open" for new mentions. */
  windowHours: number;
  /** Minimum Jaccard similarity to consider a mention part of an existing event. */
  similarityThreshold: number;
}

export const DEFAULT_CLUSTERING_OPTIONS: ClusteringOptions = {
  windowHours: 72,
  similarityThreshold: 0.4,
};

/**
 * Finds the best-matching open event for a new mention, or null if none clears the
 * similarity threshold (the caller should then create a new Event). Deterministic: same
 * inputs always produce the same match.
 */
export function findMatchingEvent(
  mentionKeywords: Set<string>,
  mentionPublishedAt: Date,
  candidates: ClusterCandidateEvent[],
  options: ClusteringOptions = DEFAULT_CLUSTERING_OPTIONS,
): { event: ClusterCandidateEvent; similarity: number } | null {
  const windowMs = options.windowHours * 60 * 60 * 1000;
  let best: { event: ClusterCandidateEvent; similarity: number } | null = null;

  for (const candidate of candidates) {
    const ageMs = Math.abs(mentionPublishedAt.getTime() - candidate.latestUpdateAt.getTime());
    if (ageMs > windowMs) continue;

    const similarity = jaccardSimilarity(mentionKeywords, new Set(candidate.keywords));
    if (similarity < options.similarityThreshold) continue;

    if (!best || similarity > best.similarity) {
      best = { event: candidate, similarity };
    }
  }

  return best;
}
