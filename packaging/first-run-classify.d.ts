/**
 * Types for `first-run-classify.mjs`, which is shipped verbatim and therefore cannot be written in
 * TypeScript. Keeping the declarations beside it means `tsc --noEmit` still checks every caller,
 * including the tests, against the shape the implementation actually returns.
 */

export type FirstRunAction =
  | "REFUSE_EMPTY_PACKAGE"
  | "WAIT_FOR_DATABASE"
  | "REFUSE_FOREIGN_DATABASE"
  | "REFUSE_DATABASE_AHEAD"
  | "APPLY_MIGRATIONS"
  | "NOTHING_TO_DO";

export interface FirstRunProbes {
  /** The database accepted a connection and answered a trivial query. */
  databaseReachable: boolean;
  /** Every table name in the `public` schema, `_prisma_migrations` included if it is there. */
  publicTables: string[];
  /** Whether Prisma's migration history table exists at all. */
  migrationTablePresent: boolean;
  /** Migration names recorded as FINISHED. An interrupted migration is not one of these. */
  appliedMigrations: string[];
  /** Migration directory names shipped inside the package. */
  packagedMigrations: string[];
}

export type FirstRunVerdict =
  | { action: "REFUSE_EMPTY_PACKAGE" }
  | { action: "WAIT_FOR_DATABASE" }
  | { action: "REFUSE_FOREIGN_DATABASE"; foreignTableCount: number }
  | { action: "REFUSE_DATABASE_AHEAD"; unknownMigrations: string[] }
  | { action: "APPLY_MIGRATIONS"; pending: string[] }
  | { action: "NOTHING_TO_DO" };

export declare const FIRST_RUN_ACTIONS: readonly FirstRunAction[];

export declare function classifyFirstRun(probes: FirstRunProbes): FirstRunVerdict;
