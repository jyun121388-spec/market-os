/**
 * The launcher's question, and the smallest honest answer to it.
 *
 * A Windows launcher must not open a browser at the moment the server process starts: the HTTP
 * port accepts connections before the database is reachable and long before the schema exists, so
 * a user's first sight of Market OS would be an error page it then had to explain. The distinction
 * this boundary draws is exactly `APP_PROCESS_STARTED` versus `MARKET_OS_READY`.
 *
 * WHAT IT MAY SAY is deliberately tiny. `/status` is the owner-facing health surface and can
 * afford sentences; this is consumed by a launcher, and every extra field is a chance to leak.
 * The reasons are a closed set of machine tokens with no free text, so there is no channel through
 * which a connection string, a path, a pid or a stack frame could travel — and a control asserts
 * that by throwing every one of those at the classifier.
 */

export type ReadinessState = "READY" | "NOT_READY";

/**
 * Why not, from a closed vocabulary. `UNKNOWN_ERROR` is the catch-all and carries NOTHING about
 * the error it stands for, which is the point: the alternative is a message field that eventually
 * receives an exception someone forgot to sanitise.
 */
export type NotReadyReason = "DATABASE_UNAVAILABLE" | "SCHEMA_NOT_READY" | "UNKNOWN_ERROR";

export interface ReadinessResult {
  status: ReadinessState;
  reason?: NotReadyReason;
}

/** What the two probes established. Booleans only — no error object reaches this module. */
export interface ReadinessProbes {
  /** The database accepted a connection and answered a trivial query. */
  databaseReachable: boolean;
  /** A product table the schema must contain could be read. */
  schemaUsable: boolean;
}

/**
 * Order matters and is not cosmetic. An unreachable database makes every schema probe fail too,
 * and reporting `SCHEMA_NOT_READY` for a database that is simply not up yet would send whoever
 * reads it — a launcher's retry loop, or a person — after the wrong thing entirely.
 */
export function classifyReadiness(probes: ReadinessProbes): ReadinessResult {
  if (!probes.databaseReachable) return { status: "NOT_READY", reason: "DATABASE_UNAVAILABLE" };
  if (!probes.schemaUsable) return { status: "NOT_READY", reason: "SCHEMA_NOT_READY" };
  return { status: "READY" };
}

/** Every token this endpoint may ever emit. A control asserts the response is a subset. */
export const READINESS_VOCABULARY = [
  "READY",
  "NOT_READY",
  "DATABASE_UNAVAILABLE",
  "SCHEMA_NOT_READY",
  "UNKNOWN_ERROR",
] as const;
