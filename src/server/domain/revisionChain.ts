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
 * input, and throws on any structure that is not one connected acyclic chain: failing loudly
 * beats returning an arbitrary row and calling it the current value.
 *
 * Every malformed case below is prevented by a database constraint —
 * `observations_series_date_original_unique` permits one original per (seriesId, observationDate),
 * and the composite unique on (seriesId, observationDate, isRevision, revisionOf) permits one
 * child per parent. The validation exists anyway because this function decides which number a
 * user sees, and "the schema should prevent it" is the assumption that produced most of this
 * project's real defects.
 *
 * Counting unreferenced rows is not on its own enough, which is the correction made here on
 * 2026-08-18 after an independent review (`gpt-5.6-terra`) pointed it out. Given an original `o`
 * plus two revisions `a → b` and `b → a`, both `a` and `b` are referenced, so `o` is the sole
 * unreferenced row and the old implementation returned it with no complaint — presenting a
 * superseded value as current and silently discarding both revisions. The cycle only tripped the
 * old check when it consumed every row. Walking the chain from the tail catches it, and catches
 * dangling parents and disconnected components with the same traversal.
 */
export function findRevisionChainTail<T extends RevisionChainRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const referencedIds = new Set(rows.map((r) => r.revisionOf).filter((id): id is string => !!id));
  const tails = rows.filter((r) => !referencedIds.has(r.id));

  if (tails.length === 0) {
    throw new Error(
      "observation revision chain has no tail (cycle in revisionOf) — refusing to guess " +
        "which value is current",
    );
  }
  if (tails.length > 1) {
    throw new Error(
      `observation revision chain has ${tails.length} tails (${tails.map((t) => t.id).join(", ")}) ` +
        "— two competing current values, refusing to pick one arbitrarily",
    );
  }

  // Walk back to the original. Every row must lie on this one path; anything not visited is
  // either in a cycle or in a component disconnected from the tail, and in both cases a value
  // that is stored would be silently ignored.
  const tail = tails[0];
  const visited = new Set<string>();
  let cursor: T | undefined = tail;
  while (cursor) {
    if (visited.has(cursor.id)) {
      throw new Error(
        `observation revision chain contains a cycle at ${cursor.id} — refusing to guess ` +
          "which value is current",
      );
    }
    visited.add(cursor.id);
    const parentId: string | null = cursor.revisionOf;
    if (parentId === null) break;
    const parent = byId.get(parentId);
    if (!parent) {
      throw new Error(
        `observation revision chain references a parent (${parentId}) that is not present — ` +
          "the caller passed a partial chain, so any answer would be a guess",
      );
    }
    cursor = parent;
  }

  if (visited.size !== rows.length) {
    const unreachable = rows.filter((r) => !visited.has(r.id)).map((r) => r.id);
    throw new Error(
      `observation revision chain has ${unreachable.length} row(s) unreachable from its tail ` +
        `(${unreachable.join(", ")}) — refusing to present a value while ignoring stored ones`,
    );
  }

  return tail;
}
