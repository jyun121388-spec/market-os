/**
 * What a first run must do, decided from probes alone.
 *
 * This is plain JavaScript on purpose, and it is the SAME FILE that ships. A packaged Market OS
 * has no TypeScript loader, so a `.ts` classifier would have to be re-implemented in the package —
 * two implementations of one decision, drifting apart, with the tested one not being the one that
 * runs. The tests import this file directly; `first-run-classify.d.ts` gives `tsc` the types it
 * needs to keep the callers honest.
 *
 * Nothing here does I/O. Every input is a value the caller measured, which is what makes the
 * dangerous cases — a database that belongs to something else, a database newer than the package,
 * a package with no migrations in it — testable without a PostgreSQL anywhere.
 */

/**
 * Everything this classifier may ever return. Closed, and asserted to be closed, for the same
 * reason `READINESS_VOCABULARY` is: the caller is a launcher and an installer, not a person
 * reading prose.
 */
export const FIRST_RUN_ACTIONS = [
  "REFUSE_EMPTY_PACKAGE",
  "WAIT_FOR_DATABASE",
  "REFUSE_FOREIGN_DATABASE",
  "REFUSE_DATABASE_AHEAD",
  "APPLY_MIGRATIONS",
  "NOTHING_TO_DO",
];

/**
 * Decide, from probes, what the first run should do.
 *
 * The order of the checks is the whole design, and each step is here because reporting the next
 * one instead would send whoever reads it after the wrong thing:
 *
 *  1. A package carrying no migrations is a defect in the PACKAGE, knowable before any database
 *     is contacted. It is checked first because the arithmetic below would otherwise absorb it in
 *     silence: with no packaged migrations, `pending` is empty, and an empty pending list reads as
 *     `NOTHING_TO_DO` — a schemaless database declared finished. This project has shipped that
 *     shape of bug before, in a guard that closed over `matches.every(...)` and was vacuously true
 *     on an empty array, so it is not a hypothetical worth being relaxed about.
 *  2. An unreachable database makes every other probe meaningless rather than false.
 *  3. Tables with no migration history are somebody else's data. Running seventeen migrations into
 *     a stranger's database is the single most destructive thing this program could do on a user's
 *     machine, and the only safe response is to refuse and say why.
 *  4. A database carrying migrations this package has never heard of is NEWER than the package —
 *     an older build pointed at a database a newer one created. Prisma would not downgrade it, but
 *     refusing before the runner starts gives a comprehensible message instead of a stack trace.
 *
 * @param {import("./first-run-classify.js").FirstRunProbes} probes
 * @returns {import("./first-run-classify.js").FirstRunVerdict}
 */
export function classifyFirstRun(probes) {
  const packaged = probes.packagedMigrations ?? [];
  const applied = probes.appliedMigrations ?? [];

  if (packaged.length === 0) {
    return { action: "REFUSE_EMPTY_PACKAGE" };
  }

  if (!probes.databaseReachable) {
    return { action: "WAIT_FOR_DATABASE" };
  }

  // Tables that exist without a migration history. `_prisma_migrations` itself is excluded, and
  // so is the case where the history table is present but empty — that is an interrupted first
  // run of OURS, not a foreign database, and it must be resumable rather than refused.
  const foreignTables = probes.publicTables.filter((t) => t !== "_prisma_migrations");
  if (!probes.migrationTablePresent && foreignTables.length > 0) {
    // The COUNT and not the names. This is fully actionable without them — the answer is always
    // "point Market OS at an empty database, or at one it created" — and the names would be the
    // schema of whatever else the user runs, written into a log they may later share.
    return { action: "REFUSE_FOREIGN_DATABASE", foreignTableCount: foreignTables.length };
  }

  const unknown = applied.filter((name) => !packaged.includes(name));
  if (unknown.length > 0) {
    // These names are the package's own filenames, so naming them leaks nothing and is the only
    // way for a reader to see which build they need.
    return { action: "REFUSE_DATABASE_AHEAD", unknownMigrations: unknown };
  }

  const pending = packaged.filter((name) => !applied.includes(name));
  if (pending.length > 0) {
    return { action: "APPLY_MIGRATIONS", pending };
  }

  return { action: "NOTHING_TO_DO" };
}
