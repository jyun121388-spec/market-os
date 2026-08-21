import { Prisma } from "@/generated/prisma/client";

/**
 * Treats a losing unique-constraint race as "already there" rather than an error.
 *
 * Three ingests (EDGAR filings, DART filings, EDGAR XBRL facts) share the shape
 * `findUnique` → if absent, `create`. That is a read-then-write pretending to be atomic: two
 * concurrent runs over the same range both see nothing and both insert, and the loser gets a
 * raw P2002 for a row that is, by the ingest's own definition, idempotent. Sequential runs never
 * hit it, which is exactly why it survived — the job runner is sequential today, but nothing
 * stops two overlapping invocations of `npm run jobs:ingest-all`.
 *
 * This is the same failure the observation revision chain and the watchlist upsert both had
 * (docs/DECISIONS.md, 2026-08-17). In every case the database constraint already guarantees the
 * invariant, so losing the race IS the correct outcome — the row exists, which is all the caller
 * wanted. What must not happen is a crash, or a silent miscount that reports the row as newly
 * inserted when another writer created it.
 *
 * Returns true when this call actually inserted, false when a concurrent writer got there first.
 */
export async function insertIfAbsent(create: () => Promise<unknown>): Promise<boolean> {
  try {
    await create();
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false;
    }
    throw err;
  }
}
