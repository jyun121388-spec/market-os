/**
 * Finding the authoritative value for an observation date.
 *
 * An observation date can hold several rows: one original plus a chain of revisions, each
 * pointing at its parent through `revisionOf`. Exactly one of them is current — the tail of the
 * chain — and picking the wrong one means showing a superseded number as if it were the latest.
 *
 * The obvious way to pick it is "most recently retrieved", and that is wrong. Prisma maps
 * `DateTime` to Postgres `timestamp(3)`, so an original and its revision written within the same
 * millisecond carry byte-identical `retrievedAt` values and Postgres is free to return them in
 * either order. The result is not a rare edge case: ingesting a revision immediately after its
 * original is the normal path, and on a fast machine it happens inside one millisecond routinely.
 *
 * The chain structure is unambiguous, so use that instead of the clock. The
 * `(seriesId, observationDate, isRevision, revisionOf)` unique constraint guarantees at most one
 * child per parent, which makes the chain a linked list with exactly one tail. That answer is the
 * same no matter how coarse the timestamps are.
 *
 * This started as a fix inside the ingest path (docs/DECISIONS.md, 2026-08-17) and was extracted
 * here once the identical mistake turned up in the READ path, where it decided which value users
 * actually see in What Changed, Macro Regime, Ask Market and Today.
 */

export interface RevisionChainRow {
  id: string;
  revisionOf: string | null;
}

/**
 * Returns the tail of a revision chain — the row no other row points at.
 *
 * `rows` must all belong to the same (seriesId, observationDate). Returns null for an empty
 * input. Throws on a cycle, which the constraints should make unreachable: failing loudly beats
 * returning an arbitrary row and calling it the current value.
 *
 * A forked chain (more than one tail) should also be impossible. If it happens, the caller's
 * ordering decides, so callers pass rows in a deterministic order and get a stable answer rather
 * than one that changes between requests.
 */
export function findRevisionChainTail<T extends RevisionChainRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;

  const referencedIds = new Set(rows.map((r) => r.revisionOf).filter((id): id is string => !!id));
  const tails = rows.filter((r) => !referencedIds.has(r.id));

  if (tails.length === 0) {
    throw new Error(
      "observation revision chain has no tail (cycle in revisionOf) — refusing to guess " +
        "which value is current",
    );
  }

  return tails[0];
}
