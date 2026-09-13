/**
 * Builds the distributable a user actually receives: the staged runtime, plus the PostgreSQL it
 * will run against, plus the installer that wires the two together.
 *
 *   npx tsx scripts/build-installer.ts --out <dir> --postgres <dir>
 *
 * `stage-runtime.ts` produces something that RUNS given a database. This produces something that
 * can CREATE one, which is the difference between a package for a developer and a package for a
 * person.
 *
 * The forbidden-path check runs again here, on the tree AFTER PostgreSQL has been copied into it.
 * Re-checking is the whole point: `stageRuntime` verified a tree that this script then adds several
 * hundred megabytes to, and a refusal that only ever saw the earlier tree would be a refusal about
 * something nobody ships. The pattern that matters most is `pgdata` — a distribution must carry a
 * PostgreSQL INSTALLATION and never somebody's database.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";

import {
  copyPackagedFile,
  isForbiddenStagedPath,
  stageRuntime,
  walkStagedTree,
  PACKAGED_INSTALLER_FILES,
} from "./stage-runtime";
import { loadNodeRuntimePin, loadPinnedLicense, type NodeRuntimePin } from "./node-runtime-pin";

const REPO = process.cwd();

/** The parts of a PostgreSQL distribution a packaged Market OS actually uses. */
export const POSTGRES_DIRECTORIES = ["bin", "lib", "share"] as const;

/** The programs the installer and the launcher invoke by name. Verified after the trim. */
export const POSTGRES_TOOLS = ["initdb", "pg_ctl", "createdb", "postgres"] as const;

/**
 * Where the bundled Node runtime goes, and the contract the `.cmd` entry points already assumed.
 *
 * `Market OS.cmd` has looked for `node\\node.exe` since it was written. Nothing ever put one there.
 * The launcher therefore fell through to `where node` and, failing that, told the user to go and
 * install Node.js — which is precisely the thing a V1 delivery is supposed to make unnecessary. An
 * old `node/` directory left in a reused output tree could make one acceptance run pass while a
 * clean rebuild on a machine without Node still sent the user to a download page.
 *
 * So the build pipeline creates it, every time, into a clean directory.
 */
export const BUNDLED_NODE_PATH = "node/node.exe";

/** Where the licence that must travel with that binary goes. */
export const BUNDLED_NODE_LICENSE_PATH = "node/LICENSE";

/** The oldest runtime this package will ship. Matches `MINIMUM_NODE_MAJOR` in the launcher. */
export const MINIMUM_BUNDLED_NODE_MAJOR = 20;

export interface BundledNodeIdentity {
  path: string;
  version: string;
  sha256: string;
  bytes: number;
  vendoredFrom: string;
  /** The upstream release this binary was proven to be, not the machine that supplied it. */
  upstream: {
    release: string;
    artifact: string;
    shasums: string;
    shasumsSha256: string;
    pinnedSha256: string;
  };
  /**
   * True only because the file in the FINAL tree was re-read and re-hashed.
   *
   * This field said `false` for one commit, with a note admitting the licence was an open packaging
   * item, which is how a redistributed third-party binary ends up shipping without the notices it
   * is required to carry. A boolean is worth nothing unless something had to happen to set it.
   */
  licenseTextIncluded: boolean;
  license: { path: string; sha256: string; bytes: number; source: string };
}

/**
 * Put the PINNED Node runtime inside the artifact, with its licence, and refuse everything else.
 *
 * Three separate things are checked, because each can pass while the others fail:
 *
 *   - identity. The source binary must hash to the pin, and the pin must agree with the Node
 *     project's own release manifest committed beside it. `process.execPath` was the old default
 *     and the old authority; it is still an acceptable *candidate*, and it is no longer an
 *     argument. A different v24 runtime that executes perfectly now fails here.
 *   - execution. The STAGED binary is run and asked its own version, because a copy that succeeded
 *     proves the filesystem worked and proves nothing about what was copied.
 *   - licence. The pinned notice text is staged beside the binary, then read back out of the final
 *     tree and hashed. A missing, empty or altered licence fails the build.
 */
export interface VerifiedRuntimeSource {
  pin: NodeRuntimePin;
  licence: { path: string; bytes: Buffer; sha256: string };
  sourceHash: string;
}

/**
 * Everything that can be known about the runtime BEFORE a single byte is written.
 *
 * Separated out and called first because it was not. The pin check lived inside `stageNodeRuntime`,
 * which runs after the application, the installer files and several hundred megabytes of PostgreSQL
 * have already been copied — so a build handed an unpinned binary staged the entire distribution
 * and only then refused, leaving a directory behind that the clean-output rule would refuse to
 * build over. The discrimination run caught it: the refusal was correct and its timing was not.
 */
export function verifyPinnedRuntimeSource(
  source: string,
  repoRoot: string = REPO,
): VerifiedRuntimeSource {
  const pin = loadNodeRuntimePin(repoRoot);
  const licence = loadPinnedLicense(pin, repoRoot);

  if (!existsSync(source)) {
    throw new Error(`packaging refused: no Node runtime at ${source} to bundle.`);
  }
  if (lstatSync(source).isSymbolicLink()) {
    throw new Error(
      `packaging refused: ${source} is a symlink; a bundled runtime must be a real file.`,
    );
  }

  const sourceHash = sha256(source);
  if (sourceHash !== pin.binary.sha256) {
    throw new Error(
      `packaging refused: ${source} is not the pinned Node runtime. Expected ` +
        `${pin.binary.sha256} (${pin.version}, ${pin.binary.upstreamPath}) but found ` +
        `${sourceHash}. Passing the version check is not the same as being the pinned release.`,
    );
  }

  return { pin, licence, sourceHash };
}

function stageNodeRuntime(
  outDir: string,
  source: string,
  verified: VerifiedRuntimeSource,
): BundledNodeIdentity {
  const { pin, licence } = verified;

  const destination = join(outDir, ...BUNDLED_NODE_PATH.split("/"));
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { dereference: true });

  const licenceDestination = join(outDir, ...BUNDLED_NODE_LICENSE_PATH.split("/"));
  writeFileSync(licenceDestination, licence.bytes);

  const staged = lstatSync(destination);
  if (staged.isSymbolicLink()) {
    throw new Error("packaging refused: the staged Node runtime is a symlink out of the package.");
  }

  // Ask the STAGED binary what it is. This is the check that cannot be satisfied by a broken copy.
  let version: string;
  try {
    version = execFileSync(destination, ["-v"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("packaging refused: the staged Node runtime would not execute.");
  }
  if (version !== pin.version) {
    throw new Error(
      `packaging refused: the staged runtime reports ${version} but the pin is ${pin.version}.`,
    );
  }
  const major = Number(/^v(\d+)\./.exec(version)?.[1]);
  if (!Number.isInteger(major) || major < MINIMUM_BUNDLED_NODE_MAJOR) {
    throw new Error(
      `packaging refused: bundled Node ${version} is older than the required v${MINIMUM_BUNDLED_NODE_MAJOR}.`,
    );
  }

  // Read BOTH back out of the tree that will ship. Until this line the licence is something this
  // function believes it wrote.
  const stagedBinaryHash = sha256(destination);
  if (stagedBinaryHash !== pin.binary.sha256) {
    throw new Error(
      `packaging refused: the staged runtime hashes to ${stagedBinaryHash}, not the pinned ` +
        `${pin.binary.sha256}.`,
    );
  }
  if (!existsSync(licenceDestination)) {
    throw new Error(
      `packaging refused: ${BUNDLED_NODE_LICENSE_PATH} is not in the distribution. The runtime ` +
        `may not ship without its licence.`,
    );
  }
  const stagedLicenceHash = sha256(licenceDestination);
  if (stagedLicenceHash !== pin.license.sha256) {
    throw new Error(
      `packaging refused: the staged Node licence hashes to ${stagedLicenceHash}, not the pinned ` +
        `${pin.license.sha256}.`,
    );
  }

  return {
    path: BUNDLED_NODE_PATH,
    version,
    sha256: stagedBinaryHash,
    bytes: staged.size,
    vendoredFrom:
      `a local binary supplied to the build, accepted only because it hashes to the pinned ` +
      `${pin.binary.upstreamPath} of ${pin.version}; the build performs no network access`,
    upstream: {
      release: pin.upstream.release,
      artifact: pin.binary.upstreamPath,
      shasums: pin.upstream.shasums,
      shasumsSha256: pin.upstream.shasumsSha256,
      pinnedSha256: pin.binary.sha256,
    },
    licenseTextIncluded: true,
    license: {
      path: BUNDLED_NODE_LICENSE_PATH,
      sha256: stagedLicenceHash,
      bytes: licence.bytes.length,
      source: pin.license.upstream,
    },
  };
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Copy a PostgreSQL distribution into the package.
 *
 * Checked, not assumed: a directory that has no `bin/initdb` is not a PostgreSQL distribution, and
 * finding that out at build time is a message, while finding it out at install time is a user
 * looking at a program that cannot create its own database.
 */
function stagePostgres(outDir: string, source: string): { files: number; bytes: number } {
  const initdb = join(source, "bin", process.platform === "win32" ? "initdb.exe" : "initdb");
  if (!existsSync(initdb)) {
    throw new Error(
      `${source} does not look like a PostgreSQL distribution: no bin/initdb. A package built ` +
        `from it could not create a database.`,
    );
  }
  if (lstatSync(source).isSymbolicLink()) {
    throw new Error(`${source} is a symlink, which cannot be packaged.`);
  }

  const destination = join(outDir, "pgsql");
  mkdirSync(destination, { recursive: true });
  // Named directories, not the whole distribution. A stock Windows PostgreSQL folder also carries
  // pgAdmin 4 and StackBuilder — a browser-based administration console and a package downloader,
  // together about two thirds of its size, neither of which this application ever invokes.
  // Copying the lot made a 1.15 GB distribution of which 700 MB was two programs a user would be
  // surprised to find they had installed. `bin`, `lib` and `share` are what `initdb`, `pg_ctl`,
  // `createdb` and the server itself need, and `stagePostgres` verifies afterwards that the three
  // binaries this package actually runs survived the trim.
  for (const dir of POSTGRES_DIRECTORIES) {
    const from = join(source, dir);
    if (!existsSync(from)) {
      throw new Error(`${source} has no ${dir}/, so it is not a usable PostgreSQL distribution.`);
    }
    cpSync(from, join(destination, dir), {
      recursive: true,
      dereference: false,
      errorOnExist: false,
    });
  }

  for (const tool of POSTGRES_TOOLS) {
    const exe = join(destination, "bin", process.platform === "win32" ? `${tool}.exe` : tool);
    if (!existsSync(exe)) {
      throw new Error(`the trimmed PostgreSQL is missing ${tool}, which the installer runs.`);
    }
  }

  const staged = walkStagedTree(destination, destination);
  return { files: staged.length, bytes: staged.reduce((sum, f) => sum + f.bytes, 0) };
}

export function buildInstaller(
  outDir: string,
  postgresSource: string,
  /**
   * The Node runtime to vendor. Defaults to the one running the build — as a CANDIDATE. It is
   * accepted only if it hashes to the repository's pin, so the default is a convenience and never
   * an authority.
   */
  nodeSource: string = process.execPath,
): { outDir: string; manifestPath: string } {
  // A distribution is built into a directory that DOES NOT YET EXIST.
  //
  // This started as `rmSync(join(outDir, "pgsql"))` and nothing else, because rebuilding over an
  // existing distribution had made the manifest report 13,929 application files — the whole tree,
  // PostgreSQL included — which reads as a plausible number and is not one. Deleting the one
  // subtree that had been observed to cause it treated the symptom: every other piece of residue
  // still counted, and a `node/` directory left by an earlier build would let an acceptance run
  // pass on a runtime this build never staged, which `stageNodeRuntime` cannot catch because the
  // file it finds is real. The manifest below asserts that the parts add up, and that assertion
  // only means anything if the directory started with nothing in it.
  //
  // Absence rather than emptiness, because an empty directory is not a safe starting point on this
  // machine. Node v24.14.0 aborts the entire process — STATUS_STACK_BUFFER_OVERRUN, 0xC0000409, no
  // stdout, no stderr, no exception, nothing copied — when `cpSync(tree, dest, {recursive: true})`
  // is given a `dest` that already exists AND sits directly under a drive root; with `dest` absent
  // the identical call copies all 2,156 files, and under a nested path both forms work. Measured
  // four trials, alternating, all four reproducing. That is a runtime defect and not a Market OS
  // one, and it is silent, which is the part that matters here: an operator who hit it would see a
  // build that produced no distribution and no reason. `stageRuntime` no longer pre-creates the
  // directory, so the first copy is the one that makes it.
  if (existsSync(outDir)) {
    const residue = readdirSync(outDir);
    throw new Error(
      `installer refused: ${outDir} already exists (${residue.length} entr` +
        `${residue.length === 1 ? "y" : "ies"}${residue.length > 0 ? `: ${residue.slice(0, 5).join(", ")}${residue.length > 5 ? ", ..." : ""}` : ""}). ` +
        `Build every distribution into a fresh directory, so the manifest describes only what ` +
        `this build produced.`,
    );
  }

  // The runtime and its licence are settled BEFORE anything is written. Everything below this line
  // creates files, and a refusal that arrives after half a gigabyte has been staged also leaves a
  // directory the rule above will then refuse to build over. Second rather than first only so that
  // the emptiness refusal does not depend on which binary the build was handed.
  const verifiedRuntime = verifyPinnedRuntimeSource(nodeSource);

  const runtime = stageRuntime(outDir);

  for (const [name, destination] of Object.entries(PACKAGED_INSTALLER_FILES)) {
    const to = join(outDir, ...destination.split("/"));
    // The same copier the runtime staging uses, so the installer's `.cmd` gets the same ASCII
    // refusal and the same CRLF endings. Two copy paths with one of them lenient is how the
    // broken one ships.
    copyPackagedFile(join(REPO, "packaging", name), to);
  }

  const postgres = stagePostgres(outDir, postgresSource);
  const nodeRuntime = stageNodeRuntime(outDir, nodeSource, verifiedRuntime);

  // The refusal, on the FINAL tree. Everything above added files to a directory that had already
  // passed one.
  const files = walkStagedTree(outDir, outDir);
  const offenders = files.filter((f) => isForbiddenStagedPath(f.path));
  if (offenders.length > 0) {
    throw new Error(
      `installer refused: ${offenders.length} forbidden path(s) reached the distribution:\n` +
        offenders
          .slice(0, 10)
          .map((o) => `  ${o.path}`)
          .join("\n"),
    );
  }

  const runtimeManifest = JSON.parse(readFileSync(runtime.manifestPath, "utf8"));
  const manifest = {
    ...runtimeManifest,
    builtAt: new Date().toISOString(),
    postgres: { files: postgres.files, bytes: postgres.bytes },
    nodeRuntime,
    installer: {
      files: Object.values(PACKAGED_INSTALLER_FILES),
      hashes: Object.fromEntries(
        Object.values(PACKAGED_INSTALLER_FILES).map((d) => [
          d,
          sha256(join(outDir, ...d.split("/"))),
        ]),
      ),
    },
    distributionFileCount: files.length,
    distributionBytes: files.reduce((sum, f) => sum + f.bytes, 0),
  };
  // The parts must account for the whole. A number that is merely plausible is what this check
  // exists to catch: it was one rebuild-over-an-existing-tree away from reporting the
  // application's size as the distribution's.
  //
  // The parts were wrong, and only a genuinely fresh build could show it. `stageRuntime` counts the
  // application BEFORE it writes its own manifest, and this script then adds the three installer
  // files and the Node runtime — five files the count never saw. Every previous build ran over a
  // tree that already contained all five, so `stageRuntime` counted them as application files and
  // the sum balanced. The equation was arithmetic about residue. Enumerated here rather than
  // written as a constant, so the next file added to a distribution has to appear in this list to
  // pass, and each is checked for existence: a count that balances because two errors cancel is the
  // failure this whole check is about.
  const addedAfterTheApplicationWasCounted = [
    ...Object.values(PACKAGED_INSTALLER_FILES),
    BUNDLED_NODE_PATH,
    BUNDLED_NODE_LICENSE_PATH,
    // `stageRuntime` writes this after counting, and this script overwrites it at the same path.
    "market-os-manifest.json",
  ];
  const staged = new Set(files.map((f) => f.path));
  const missing = addedAfterTheApplicationWasCounted.filter((p) => !staged.has(p));
  if (missing.length > 0) {
    throw new Error(
      `manifest cannot be trusted: ${missing.length} file(s) this build was supposed to add are ` +
        `not in the distribution: ${missing.join(", ")}.`,
    );
  }
  const parts =
    manifest.fileCount + manifest.postgres.files + addedAfterTheApplicationWasCounted.length;
  if (parts !== manifest.distributionFileCount) {
    throw new Error(
      `manifest does not add up: ${manifest.fileCount} application + ${manifest.postgres.files} ` +
        `postgres + ${addedAfterTheApplicationWasCounted.length} added ` +
        `(${addedAfterTheApplicationWasCounted.join(", ")}) = ${parts} != ` +
        `${manifest.distributionFileCount} in the distribution.`,
    );
  }

  // The last word on the runtime, checked against the tree that will actually ship rather than
  // against the variable this function happens to be holding.
  const stagedNode = files.find((f) => f.path === BUNDLED_NODE_PATH);
  if (stagedNode === undefined) {
    throw new Error(`packaging refused: ${BUNDLED_NODE_PATH} is not in the built distribution.`);
  }
  if (sha256(join(outDir, ...BUNDLED_NODE_PATH.split("/"))) !== nodeRuntime.sha256) {
    throw new Error("packaging refused: the bundled Node runtime changed after it was verified.");
  }
  // And the licence, on the same terms. A runtime staged correctly beside a licence that was
  // deleted, truncated or replaced between then and now ships without its notices, and the manifest
  // would say `licenseTextIncluded: true` about it.
  if (files.find((f) => f.path === BUNDLED_NODE_LICENSE_PATH) === undefined) {
    throw new Error(
      `packaging refused: ${BUNDLED_NODE_LICENSE_PATH} is not in the built distribution.`,
    );
  }
  if (
    sha256(join(outDir, ...BUNDLED_NODE_LICENSE_PATH.split("/"))) !== nodeRuntime.license.sha256
  ) {
    throw new Error("packaging refused: the bundled Node licence changed after it was verified.");
  }

  const manifestPath = join(outDir, "market-os-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { outDir, manifestPath };
}

if (process.argv[1] && process.argv[1].endsWith("build-installer.ts")) {
  const out = arg("out");
  const postgres = arg("postgres");
  if (!out || !postgres) {
    console.error(
      "usage: --out <dir> --postgres <postgresql distribution dir> [--node <node.exe>]",
    );
    process.exit(2);
  }
  const outDir = resolve(out);
  if (outDir.startsWith(resolve(REPO) + sep)) {
    console.error("REFUSING: the distribution directory is inside the repository.");
    process.exit(1);
  }

  const result = buildInstaller(
    outDir,
    resolve(postgres),
    resolve(arg("node") ?? process.execPath),
  );
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  console.log(`built a distribution at ${result.outDir}`);
  console.log(`  commit     ${manifest.sourceCommit}`);
  console.log(`  buildId    ${manifest.buildId}`);
  console.log(`  app        ${manifest.fileCount.toLocaleString("en-US")} files`);
  console.log(`  postgres   ${manifest.postgres.files.toLocaleString("en-US")} files`);
  console.log(`  node       ${manifest.nodeRuntime.version} at ${manifest.nodeRuntime.path}`);
  console.log(`             sha256 ${manifest.nodeRuntime.sha256}`);
  console.log(
    `             pinned as ${manifest.nodeRuntime.upstream.artifact} of ` +
      `${manifest.nodeRuntime.upstream.release}`,
  );
  console.log(
    `  licence    ${manifest.nodeRuntime.license.path}, ` +
      `${manifest.nodeRuntime.license.bytes.toLocaleString("en-US")} bytes, ` +
      `sha256 ${manifest.nodeRuntime.license.sha256}`,
  );
  console.log(
    `  total      ${manifest.distributionFileCount.toLocaleString("en-US")} files, ` +
      `${manifest.distributionBytes.toLocaleString("en-US")} bytes`,
  );
  console.log(`  installer  ${manifest.installer.files.join(", ")}`);
  console.log(`  manifest   ${result.manifestPath}`);
}
