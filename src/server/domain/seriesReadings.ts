import { prisma } from "@/server/db/client";
import { findRevisionChainTail } from "@/server/domain/revisionChain";
import type { Observation } from "@/generated/prisma/client";

export interface ObservationPair {
  current: Observation;
  previous: Observation;
}

/**
 * Shared read logic for "the two most recent distinct observation dates for a series, respecting
 * revisions" — used by whatChanged.ts (M10), macroRegime.ts (M11) and askMarket.ts (M21).
 *
 * This decides which number a user is shown, so picking the wrong row within a date means
 * displaying a superseded value as if it were current.
 *
 * It used to do that. The query was
 * `orderBy: [{ observationDate: "desc" }, { retrievedAt: "desc" }], distinct: ["observationDate"]`,
 * on the theory that the most recently retrieved value for a date wins. `retrievedAt` is a
 * `timestamp(3)`, so an original and its revision written in the same millisecond are
 * indistinguishable and Postgres may return either first — after which `distinct` keeps whichever
 * happened to come first. Ingesting a revision right after its original is the normal path, so
 * this was not a rare edge case, and the wrong answer was non-deterministic rather than
 * consistently wrong. Found on 2026-08-17 as the read-path twin of the same bug in the ingest.
 *
 * Now resolved structurally: take the two most recent distinct dates, then pick each date's
 * revision-chain tail (see revisionChain.ts). Independent of timestamp resolution.
 */
export async function getRecentObservationPair(seriesId: string): Promise<ObservationPair | null> {
  const recentDates = await prisma.observation.findMany({
    where: { seriesId },
    orderBy: { observationDate: "desc" },
    distinct: ["observationDate"],
    select: { observationDate: true },
    take: 2,
  });

  if (recentDates.length < 2) {
    return null;
  }

  const rows = await prisma.observation.findMany({
    where: { seriesId, observationDate: { in: recentDates.map((d) => d.observationDate) } },
    // Only a tiebreaker for a chain that should be impossible (see revisionChain.ts) — keeps a
    // malformed chain answering the same way twice instead of flickering between requests.
    orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
  });

  const forDate = (date: Date) =>
    findRevisionChainTail(rows.filter((r) => r.observationDate.getTime() === date.getTime()));

  const current = forDate(recentDates[0].observationDate);
  const previous = forDate(recentDates[1].observationDate);
  if (!current || !previous) {
    return null;
  }

  return { current, previous };
}

export interface DeterministicChange {
  absoluteChange: number;
  percentChange: number | null; // null when previous value is 0 (percent change undefined)
  bpsChange: number | null; // only meaningful when unit === "percent"
}

/** Pure, deterministic change calculation — no DB access, no LLM. */
export function computeChange(pair: ObservationPair, unit: string): DeterministicChange {
  const currentValue = Number(pair.current.value.toString());
  const previousValue = Number(pair.previous.value.toString());

  const absoluteChange = round(currentValue - previousValue, 6);
  const percentChange =
    previousValue === 0 ? null : round((absoluteChange / previousValue) * 100, 4);
  const bpsChange = unit === "percent" ? round(absoluteChange * 100, 2) : null;

  return { absoluteChange, percentChange, bpsChange };
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
