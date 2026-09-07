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

/**
 * A chain row that may carry the provider's own statement of when its value became current.
 *
 * `releaseDate` is NULL for every row this repository wrote before IR-130, and for every provider
 * that does not publish a vintage. It is NOT globally reinterpreted from FRED's measurement: a
 * value here means the adapter that wrote the row established provider-vintage semantics for it
 * (`normalizeFredObservations({ vintageAware: true })` is the only such writer today), and a NULL
 * means nothing is known either way.
 */
export interface VintagedChainRow extends RevisionChainRow {
  releaseDate: Date | null;
}

/**
 * Which row of a chain is CURRENT, and on what authority — or a refusal to say.
 *
 * The basis is carried rather than assumed because the two answers are not equally strong. A
 * structural answer is only as good as the order rows arrived in; a vintage answer is the
 * provider's own.
 */
export type CurrentSelection<T> =
  | { kind: "CURRENT"; row: T; basis: "PROVIDER_VINTAGE" | "CHAIN_STRUCTURE" }
  | { kind: "UNVERIFIABLE"; because: string };

/**
 * Selects the current value for one observation date.
 *
 * IR-131, and the defect it repairs was reproduced rather than reasoned about. `findRevisionChainTail`
 * is correct about the STRUCTURE, and the structure is built by the writer attaching each new row to
 * the current tail — so chain order is ARRIVAL order. That is fine while everything arrives in the
 * order it happened, and it is wrong the moment history arrives after the present. Ingesting FRED's
 * vintage history into a chain that already held the current value put three older vintages after
 * the newest one, and the read path served 300.456 (a 2025-02-12 vintage) where the current value is
 * 300.420. Measured on a real database on 2026-09-06.
 *
 * Three cases, and the middle one is the whole point:
 *
 *   NO row carries a vintage      the structural tail, exactly as before. Every chain this
 *                                 repository held before IR-130 is in this case, so ordinary
 *                                 behaviour is unchanged and a control pins that.
 *   EVERY row carries one         the provider's own answer: the latest `releaseDate` wins,
 *                                 whatever order the rows arrived in or were linked in.
 *   SOME do                       REFUSED. A chain that mixes rows with provider authority and rows
 *                                 without has no orderable total: the vintage rows can be ordered
 *                                 among themselves and the NULL rows cannot be placed against them
 *                                 at all. Arrival order is exactly what is not trustworthy here, so
 *                                 there is nothing to fall back to. This is the CPIAUCSL case.
 *
 * Refusing is not free — the caller loses that date — and it is still better than the alternative,
 * because the alternative is a superseded number displayed as current with nothing marking it. The
 * boundary that shows it already has an unreadable state and this reuses it.
 *
 * The structure is validated FIRST in every case, so a malformed chain still throws before any
 * vintage reasoning happens. Ordering by vintage must not become a way to stop noticing a cycle.
 */
export function selectCurrentObservation<T extends VintagedChainRow>(
  rows: T[],
): CurrentSelection<T> | null {
  if (rows.length === 0) return null;

  // Structural validation first and always. `findRevisionChainTail` throws on a cycle, a fork, a
  // dangling parent or a disconnected row, and none of those become acceptable just because the
  // rows happen to carry vintages.
  const structuralTail = findRevisionChainTail(rows);
  if (!structuralTail) return null;

  // A vintage that is not a usable date is not evidence. Found by adversarial review of this
  // repair (read-only Codex, 2026-09-07): an `Invalid Date` makes every comparison below NaN, so
  // the loop never moves `latest` and never sets `tied`, and the FIRST row would be returned as
  // though the provider had chosen it. Prisma and Postgres make that shape unlikely; this function
  // is exported and claims to decide which number a user sees, so it enforces its own precondition
  // rather than inheriting one. An unusable vintage is treated as absent, which routes the chain
  // into the mixed branch and refuses — the same answer as any other unorderable chain.
  const hasUsableVintage = (r: T): boolean =>
    r.releaseDate instanceof Date && !Number.isNaN(r.releaseDate.getTime());
  const withVintage = rows.filter(hasUsableVintage);

  if (withVintage.length === 0) {
    return { kind: "CURRENT", row: structuralTail, basis: "CHAIN_STRUCTURE" };
  }

  if (withVintage.length !== rows.length) {
    return {
      kind: "UNVERIFIABLE",
      because:
        `${withVintage.length} of ${rows.length} rows carry a provider release date. A chain that ` +
        "mixes provider-dated rows with undated ones cannot be ordered: the undated rows cannot be " +
        "placed against the dated ones, and arrival order is the thing that is not trustworthy here.",
    };
  }

  // Every row has one. The provider decides, and a tie means the provider did not.
  let latest = withVintage[0];
  let tied = false;
  for (const row of withVintage.slice(1)) {
    const delta = row.releaseDate!.getTime() - latest.releaseDate!.getTime();
    if (delta > 0) {
      latest = row;
      tied = false;
    } else if (delta === 0) {
      tied = true;
    }
  }

  if (tied) {
    return {
      kind: "UNVERIFIABLE",
      because:
        `two or more rows claim the same provider release date (${latest.releaseDate!.toISOString()}), ` +
        "so the provider's own evidence does not say which is current. Falling back to arrival " +
        "order here would reintroduce exactly the ordering this function exists to stop trusting.",
    };
  }

  return { kind: "CURRENT", row: latest, basis: "PROVIDER_VINTAGE" };
}
