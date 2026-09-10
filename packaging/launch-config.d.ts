/** Types for `launch-config.mjs`, which ships verbatim and so cannot be TypeScript. */

export type LaunchRefusal =
  | "MALFORMED_CONFIG"
  | "NO_DATABASE_URL"
  | "INVALID_DATABASE_URL"
  | "INVALID_PORT"
  | "INCOMPLETE_POSTGRES_CONFIG";

export interface ManagedPostgres {
  manage: true;
  binDir: string;
  dataDir: string;
}

export interface LaunchConfig {
  databaseUrl: string;
  port: number;
  /** `null` when this installation must not start or stop a database it does not own. */
  postgres: ManagedPostgres | null;
  openBrowser: boolean;
}

export type LaunchResolution =
  { ok: true; config: LaunchConfig } | { ok: false; refusal: LaunchRefusal };

export declare const LAUNCH_REFUSALS: readonly LaunchRefusal[];

export declare function resolveLaunchConfig(input: {
  file?: unknown;
  env?: Record<string, string | undefined>;
}): LaunchResolution;

export declare function describeLaunchConfig(config: LaunchConfig): string;
