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
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import {
  isForbiddenStagedPath,
  stageRuntime,
  walkStagedTree,
  PACKAGED_INSTALLER_FILES,
} from "./stage-runtime";

const REPO = process.cwd();

/** The parts of a PostgreSQL distribution a packaged Market OS actually uses. */
export const POSTGRES_DIRECTORIES = ["bin", "lib", "share"] as const;

/** The programs the installer and the launcher invoke by name. Verified after the trim. */
export const POSTGRES_TOOLS = ["initdb", "pg_ctl", "createdb", "postgres"] as const;

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
): { outDir: string; manifestPath: string } {
  // Remove a previous build's PostgreSQL FIRST, so `stageRuntime` counts the application and
  // nothing else. Rebuilding over an existing distribution made its manifest report 13,929
  // application files — the whole tree, PostgreSQL included — which reads as a plausible number
  // and is not one. The manifest below now also asserts that the two halves add up.
  rmSync(join(outDir, "pgsql"), { recursive: true, force: true });

  const runtime = stageRuntime(outDir);

  for (const [name, destination] of Object.entries(PACKAGED_INSTALLER_FILES)) {
    const to = join(outDir, ...destination.split("/"));
    cpSync(join(REPO, "packaging", name), to);
  }

  const postgres = stagePostgres(outDir, postgresSource);

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
  // The two halves must account for the whole. A number that is merely plausible is what this
  // check exists to catch: it was one rebuild-over-an-existing-tree away from reporting the
  // application's size as the distribution's.
  if (manifest.fileCount + manifest.postgres.files !== manifest.distributionFileCount) {
    throw new Error(
      `manifest does not add up: ${manifest.fileCount} application + ${manifest.postgres.files} ` +
        `postgres != ${manifest.distributionFileCount} in the distribution.`,
    );
  }

  const manifestPath = join(outDir, "market-os-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { outDir, manifestPath };
}

if (process.argv[1] && process.argv[1].endsWith("build-installer.ts")) {
  const out = arg("out");
  const postgres = arg("postgres");
  if (!out || !postgres) {
    console.error("usage: --out <dir> --postgres <postgresql distribution dir>");
    process.exit(2);
  }
  const outDir = resolve(out);
  if (outDir.startsWith(resolve(REPO) + sep)) {
    console.error("REFUSING: the distribution directory is inside the repository.");
    process.exit(1);
  }

  const result = buildInstaller(outDir, resolve(postgres));
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  console.log(`built a distribution at ${result.outDir}`);
  console.log(`  commit     ${manifest.sourceCommit}`);
  console.log(`  buildId    ${manifest.buildId}`);
  console.log(`  app        ${manifest.fileCount.toLocaleString("en-US")} files`);
  console.log(`  postgres   ${manifest.postgres.files.toLocaleString("en-US")} files`);
  console.log(
    `  total      ${manifest.distributionFileCount.toLocaleString("en-US")} files, ` +
      `${manifest.distributionBytes.toLocaleString("en-US")} bytes`,
  );
  console.log(`  installer  ${manifest.installer.files.join(", ")}`);
  console.log(`  manifest   ${result.manifestPath}`);
}
