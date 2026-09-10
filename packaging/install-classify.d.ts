/** Types for `install-classify.mjs`, which ships verbatim and so cannot be TypeScript. */

export type InstallAction =
  | "REFUSE_INCOMPLETE_PACKAGE"
  | "REFUSE_NO_POSTGRES"
  | "REFUSE_DATA_DIR_NOT_EMPTY"
  | "REFUSE_CLUSTER_WITHOUT_CONFIG"
  | "ALREADY_INSTALLED"
  | "CREATE_CLUSTER";

export interface InstallProbes {
  /** The server and the setup programs are all present in this package. */
  applicationFilesPresent: boolean;
  /** A PostgreSQL distribution is bundled beside them. */
  postgresPresent: boolean;
  /** The data directory exists at all. */
  dataDirExists: boolean;
  dataDirEmpty: boolean;
  dataDirEntryCount: number;
  /** The data directory holds an initialised cluster (a `PG_VERSION` file). */
  clusterPresent: boolean;
  /** `market-os.json` exists, which is where the generated credential lives. */
  configPresent: boolean;
}

export type InstallVerdict =
  | { action: "REFUSE_INCOMPLETE_PACKAGE" }
  | { action: "REFUSE_NO_POSTGRES" }
  | { action: "REFUSE_DATA_DIR_NOT_EMPTY"; entryCount: number }
  | { action: "REFUSE_CLUSTER_WITHOUT_CONFIG" }
  | { action: "ALREADY_INSTALLED" }
  | { action: "CREATE_CLUSTER" };

export declare const INSTALL_ACTIONS: readonly InstallAction[];

export declare function classifyInstall(probes: InstallProbes): InstallVerdict;
