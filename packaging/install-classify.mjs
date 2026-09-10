/**
 * What an installation should do, decided from probes alone.
 *
 * Plain JavaScript, shipped verbatim, tested as the bytes that ship — the same arrangement as
 * `first-run-classify.mjs`, for the same reason: nothing here may exist in two versions.
 *
 * An installer is the most destructive program in a package. It creates a database cluster, and
 * `initdb` into a directory that already contains files is how somebody loses work that had
 * nothing to do with this application. So the refusals are the substance of this file and the
 * install path is the short case at the end.
 */

export const INSTALL_ACTIONS = [
  "REFUSE_INCOMPLETE_PACKAGE",
  "REFUSE_NO_POSTGRES",
  "REFUSE_DATA_DIR_NOT_EMPTY",
  "REFUSE_CLUSTER_WITHOUT_CONFIG",
  "ALREADY_INSTALLED",
  "CREATE_CLUSTER",
];

/**
 * @param {import("./install-classify.js").InstallProbes} probes
 * @returns {import("./install-classify.js").InstallVerdict}
 */
export function classifyInstall(probes) {
  // The package first, because both later questions are about what this package is going to do
  // with a directory, and a package that cannot run has no business creating one.
  if (!probes.applicationFilesPresent) {
    return { action: "REFUSE_INCOMPLETE_PACKAGE" };
  }
  if (!probes.postgresPresent) {
    return { action: "REFUSE_NO_POSTGRES" };
  }

  if (probes.clusterPresent) {
    // A cluster exists. The only question left is whether this installation knows how to reach it.
    //
    // When it does not, the honest answer is to refuse. The credential for that cluster was
    // generated at install time and written to the configuration; with the configuration gone it
    // is not recoverable, and the plausible-looking repair — initdb again — would destroy a
    // database that may hold everything the user has. So this says what is wrong and stops.
    return probes.configPresent
      ? { action: "ALREADY_INSTALLED" }
      : { action: "REFUSE_CLUSTER_WITHOUT_CONFIG" };
  }

  // No cluster, but something is in the directory. This is the case the refusal exists for: the
  // user pointed the installer at a folder that is already theirs.
  if (probes.dataDirExists && !probes.dataDirEmpty) {
    return { action: "REFUSE_DATA_DIR_NOT_EMPTY", entryCount: probes.dataDirEntryCount };
  }

  return { action: "CREATE_CLUSTER" };
}
