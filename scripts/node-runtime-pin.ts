/**
 * The repository's authority over the Node runtime it redistributes.
 *
 * `process.execPath` is not source authority. It says which binary happened to be running the
 * build, which on a developer machine is whatever was installed last and on any other machine is
 * something else entirely. A build that accepts it because the major version looks right will
 * cheerfully redistribute a runtime nobody can identify.
 *
 * So the permitted runtime is pinned here as an exact tuple — version, sha256, upstream release
 * identity — and the sha256 is not merely asserted. `third-party/node/SHASUMS256.txt` is the Node.js
 * project's own release manifest for v24.14.0, committed beside the pin, and the pin is checked
 * against it. The licence text the binary must travel with is committed the same way. Nothing here
 * reaches the network: the acquisition happened once and its result is in the repository.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PIN_DIRECTORY = ["third-party", "node"] as const;
export const PIN_FILE = "NODE_RUNTIME_PIN.json";
export const SHASUMS_FILE = "SHASUMS256.txt";

export interface NodeRuntimePin {
  version: string;
  platform: string;
  binary: { upstreamPath: string; sha256: string; bytes: number; stagedAs: string };
  license: {
    repositoryPath: string;
    sha256: string;
    bytes: number;
    stagedAs: string;
    upstream: string;
  };
  upstream: {
    release: string;
    shasums: string;
    shasumsFile: string;
    shasumsSha256: string;
    acquiredAt: string;
  };
}

export function sha256OfFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Read one entry out of an upstream `SHASUMS256.txt`.
 *
 * The format is `<64 hex>  <path>` per line. Parsed rather than searched for as a substring: a
 * substring match would be satisfied by the hash appearing anywhere in the file, including on the
 * line for a completely different artifact.
 */
export function shasumsEntry(text: string, upstreamPath: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(line.trim());
    if (match && match[2] === upstreamPath) return match[1];
  }
  return undefined;
}

/**
 * Load the pin and prove it agrees with the upstream release manifest committed beside it.
 *
 * The self-check is the point. A pin whose hash was edited by hand — or updated for a new Node
 * without updating the manifest — is exactly as convincing as a correct one until something
 * compares the two.
 */
export function loadNodeRuntimePin(repoRoot: string = process.cwd()): NodeRuntimePin {
  const dir = join(repoRoot, ...PIN_DIRECTORY);
  const pinPath = join(dir, PIN_FILE);
  if (!existsSync(pinPath)) {
    throw new Error(
      `packaging refused: no Node runtime pin at ${pinPath}. The runtime a distribution ships ` +
        `is pinned by this repository, not by whatever ran the build.`,
    );
  }
  const pin = JSON.parse(readFileSync(pinPath, "utf8")) as NodeRuntimePin;

  const shasumsPath = join(dir, SHASUMS_FILE);
  if (!existsSync(shasumsPath)) {
    throw new Error(
      `packaging refused: the pin cites ${pin.upstream.shasums} but ${shasumsPath} is not in the ` +
        `repository, so nothing can check the pinned hash against the upstream release.`,
    );
  }
  const shasumsText = readFileSync(shasumsPath, "utf8");
  const manifestHash = sha256OfFile(shasumsPath);
  if (manifestHash !== pin.upstream.shasumsSha256) {
    throw new Error(
      `packaging refused: ${SHASUMS_FILE} hashes to ${manifestHash}, but the pin records ` +
        `${pin.upstream.shasumsSha256}. The release manifest has been altered.`,
    );
  }

  const upstreamHash = shasumsEntry(shasumsText, pin.binary.upstreamPath);
  if (upstreamHash === undefined) {
    throw new Error(
      `packaging refused: ${SHASUMS_FILE} has no entry for ${pin.binary.upstreamPath}.`,
    );
  }
  if (upstreamHash !== pin.binary.sha256) {
    throw new Error(
      `packaging refused: the pin claims ${pin.binary.sha256} for ${pin.binary.upstreamPath}, ` +
        `but the upstream release manifest says ${upstreamHash}.`,
    );
  }

  return pin;
}

/** The licence text the bundled binary must travel with, checked against the pin before use. */
export function loadPinnedLicense(
  pin: NodeRuntimePin,
  repoRoot: string = process.cwd(),
): { path: string; bytes: Buffer; sha256: string } {
  const path = join(repoRoot, ...pin.license.repositoryPath.split("/"));
  if (!existsSync(path)) {
    throw new Error(
      `packaging refused: the Node licence is not at ${path}. A redistributed runtime ships with ` +
        `its licence or it does not ship.`,
    );
  }
  const bytes = readFileSync(path);
  if (bytes.length === 0) {
    throw new Error(`packaging refused: the Node licence at ${path} is empty.`);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== pin.license.sha256) {
    throw new Error(
      `packaging refused: the Node licence at ${path} hashes to ${hash}, but the pin records ` +
        `${pin.license.sha256}. It has been altered.`,
    );
  }
  return { path, bytes, sha256: hash };
}
