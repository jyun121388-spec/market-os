/**
 * Stages a runnable Market OS outside the source checkout, and refuses to stage anything a user
 * must never receive.
 *
 * `next build` with `output: "standalone"` emits a server plus a traced `node_modules`. That is
 * necessary and NOT sufficient, and this script exists because assuming otherwise is how a
 * packaging step passes while shipping something that cannot run:
 *
 *   - Next does not copy `.next/static` or `public` into the standalone folder. A server without
 *     them starts, serves HTML, and renders unstyled pages with 404s for every chunk.
 *   - The Prisma MIGRATION toolchain is not an import of the server, so nothing traces it. A
 *     packaged app that cannot create its own schema is not a packaged app.
 *   - `.next/standalone/node_modules` is a SYMLINK when the source `node_modules` is one — which
 *     it was in this worktree. Copying that produces a staging directory pointing straight back
 *     at the developer's checkout, which is precisely the dependency this whole unit exists to
 *     disprove. So it is checked, by hand, and refused.
 *
 * Usage: npx tsx scripts/stage-runtime.ts [--out <dir>]
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();

/**
 * Content that must never reach a user's machine. Checked against the STAGED tree after copying,
 * not against the copy list, because a check on intent proves nothing about the result.
 */
export interface ForbiddenPattern {
  pattern: RegExp;
  why: string;
  /**
   * Whether the rule also applies under `node_modules`.
   *
   * Most do not, and the reason is worth stating. Third-party packages legitimately ship `test/`
   * directories, and a rule that flagged them would refuse every real staging run — which was not
   * hypothetical: the first version of this list had no such scope, and it only mattered once the
   * migration toolchain's 136 packages were staged beside the server. A refusal nobody can satisfy
   * is a refusal somebody deletes, so the SCOPE is narrowed rather than the rule weakened.
   *
   * The three that apply everywhere are the ones no package has any business containing:
   * repository history, an environment file, and a database data directory.
   */
  insideNodeModules: boolean;
}

export const FORBIDDEN_STAGED_PATTERNS: ForbiddenPattern[] = [
  { pattern: /(^|[\\/])\.git([\\/]|$)/, why: "repository history", insideNodeModules: true },
  {
    pattern: /(^|[\\/])\.env(\.|$)/,
    why: "developer environment file",
    insideNodeModules: true,
  },
  {
    pattern: /(^|[\\/])pgdata([\\/]|$)/,
    why: "a database data directory",
    insideNodeModules: true,
  },
  { pattern: /(^|[\\/])tests?([\\/])/, why: "test sources", insideNodeModules: false },
  {
    pattern: /(^|[\\/])scripts[\\/]mutation([\\/])/,
    why: "the mutation harness",
    insideNodeModules: false,
  },
  {
    pattern: /(^|[\\/])CLAUDE\.md$/,
    why: "development instructions",
    insideNodeModules: false,
  },
  {
    pattern: /(^|[\\/])\.claude([\\/]|$)/,
    why: "development tooling state",
    insideNodeModules: false,
  },
  {
    pattern: /(^|[\\/])docs[\\/]escalation([\\/])/,
    why: "control-bus records",
    insideNodeModules: false,
  },
  { pattern: /\.test\.tsx?$/, why: "a test file", insideNodeModules: false },
  {
    /**
     * The bundler's on-disk build cache, and this one is not hypothetical. A leak audit during
     * the live-provider activation found REAL API key values sitting in
     * `.next/cache/turbopack/*.sst` on the developer machine: the cache had captured the
     * environment of a build run with `.env` loaded.
     *
     * Nothing shipped — `.next` is gitignored, and staging copies only `standalone` and `static`,
     * so the cache was excluded by construction. This makes that exclusion a REFUSAL instead of
     * an accident, so a future widening of the copy list cannot quietly ship a credential.
     */
    pattern: /(^|[\\/])cache[\\/](turbopack|webpack)([\\/]|$)/,
    why: "a bundler build cache, which has been observed holding credential values",
    insideNodeModules: true,
  },
];

/** True when this staged path must be refused. Paths use forward slashes. */
export function isForbiddenStagedPath(path: string): boolean {
  const vendored = /(^|\/)node_modules\//.test(path);
  return FORBIDDEN_STAGED_PATTERNS.some(
    (p) => (p.insideNodeModules || !vendored) && p.pattern.test(path),
  );
}

/**
 * The first-run files, copied from `packaging/` to the package root unchanged.
 *
 * They are plain `.mjs` and they are the SAME BYTES the tests exercise. A packaged runtime has no
 * TypeScript loader, so writing the setup logic in `src/` would have meant a second copy of it
 * living in the package — and the tested copy would not have been the one that runs.
 */
export const PACKAGED_SETUP_FILES: Readonly<Record<string, string>> = {
  "first-run.mjs": "first-run.mjs",
  "first-run-classify.mjs": "first-run-classify.mjs",
  "first-run-redact.mjs": "first-run-redact.mjs",
  "launcher.mjs": "launcher.mjs",
  "launch-config.mjs": "launch-config.mjs",
  "ready-poll.mjs": "ready-poll.mjs",
  // The double-clickable entry point, at the top of the package where a person will find it.
  "Market OS.cmd": "Market OS.cmd",
  // Not the package root. `prisma.config.mjs` imports `prisma/config`, which only the toolchain
  // directory can resolve — staged at the root, the very first real run failed with
  // `Cannot find module 'prisma/config'`.
  "prisma.config.mjs": "migrate-tools/prisma.config.mjs",
};

/**
 * The installer's own files, which only `build-installer.ts` stages. They are separate from
 * `PACKAGED_SETUP_FILES` because a runtime staged for testing has no business carrying a program
 * that runs `initdb`.
 */
export const PACKAGED_INSTALLER_FILES: Readonly<Record<string, string>> = {
  "install.mjs": "install.mjs",
  "install-classify.mjs": "install-classify.mjs",
  "Install Market OS.cmd": "Install Market OS.cmd",
};

/**
 * Where the packaged Prisma CLI must end up. `first-run.mjs` looks here and nowhere else, so this
 * path is a contract between the two and a test asserts they still agree.
 */
export const MIGRATION_RUNNER_PATH = "migrate-tools/node_modules/prisma/build/index.js";

interface StagedFile {
  path: string;
  bytes: number;
}

/**
 * Every file under `dir`, with its size, refusing any symlink on the way.
 *
 * Exported because `build-installer.ts` adds a PostgreSQL distribution to a tree this module has
 * already checked, and a refusal that only ever saw the earlier tree would be a refusal about
 * something nobody ships.
 */
export function walkStagedTree(dir: string, base: string, out: StagedFile[] = []): StagedFile[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      // A symlink in a staged runtime is a pointer out of the package. Even when it resolves on
      // this machine, it will not on the user's.
      throw new Error(
        `staged tree contains a symlink, which cannot be packaged: ${relative(base, full)}`,
      );
    }
    if (st.isDirectory()) walkStagedTree(full, base, out);
    else out.push({ path: relative(base, full).split(sep).join("/"), bytes: st.size });
  }
  return out;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function copyInto(from: string, to: string, label: string) {
  if (!existsSync(from)) throw new Error(`${label} is missing at ${from} — nothing to stage`);
  if (lstatSync(from).isSymbolicLink()) {
    throw new Error(
      `${label} at ${from} is a SYMLINK. Staging it would point the packaged app back at this ` +
        `checkout. Replace the symlink with a real directory (npm ci) and rebuild.`,
    );
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, dereference: false, errorOnExist: false });
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

/**
 * Put Prisma's own migration runner in the package.
 *
 * Why the real toolchain and not a loop over `migration.sql` files: `migrate deploy` checksums
 * each migration and refuses when an applied one has changed on disk, applies each in its own
 * transaction, and records failure so the next run resumes rather than half-applying. That
 * behaviour IS the safety of migrations, and a fifteen-line loop that skips it is not the same
 * thing written shorter. The user's packaging directive asked for this to be measured before it
 * was replaced; measured, it costs one `npm install` at packaging time and the runner works
 * unmodified from inside the package, so there is nothing to replace.
 *
 * The version is read from the INSTALLED CLI rather than from the `package.json` range, so the
 * runner shipped is the one that generated and last verified these migrations, not whatever the
 * range resolves to on the day someone packages.
 *
 * Idempotent: an existing toolchain of the right version is reused, so re-staging does not need
 * the network.
 */
function stageMigrationToolchain(outDir: string): {
  version: string;
  packages: number;
  reused: boolean;
} {
  const installed = JSON.parse(
    readFileSync(join(REPO, "node_modules", "prisma", "package.json"), "utf8"),
  ) as { version: string };
  const version = installed.version;

  const dir = join(outDir, "migrate-tools");
  const marker = join(dir, "node_modules", "prisma", "package.json");
  let reused = false;

  if (existsSync(marker)) {
    const there = JSON.parse(readFileSync(marker, "utf8")) as { version: string };
    reused = there.version === version;
  }

  if (!reused) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        { name: "market-os-migrate-tools", version: "1.0.0", private: true },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    // Hand-picking the CLI's dependencies was tried first and failed on a transitive import
    // (`Cannot find module 'effect'`). npm computes the closure correctly; nothing else does.
    // `npm.cmd` by name rather than `shell: true`. Node warns about the latter, and it is right
    // to: with a shell, arguments are concatenated instead of escaped, and one of these arguments
    // is a version string read out of a file.
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npm, ["install", `prisma@${version}`, "--no-audit", "--no-fund", "--silent"], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
    });
  }

  if (!existsSync(join(outDir, MIGRATION_RUNNER_PATH))) {
    throw new Error(
      `the migration runner is not at ${MIGRATION_RUNNER_PATH} after staging the toolchain. ` +
        `A package that cannot create its own schema is not a package.`,
    );
  }

  const packages = readdirSync(join(dir, "node_modules")).filter((n) => !n.startsWith(".")).length;
  return { version, packages, reused };
}

export function stageRuntime(outDir: string): {
  outDir: string;
  files: StagedFile[];
  manifestPath: string;
} {
  const standalone = join(REPO, ".next", "standalone");
  const staticDir = join(REPO, ".next", "static");

  if (!existsSync(standalone)) {
    throw new Error(
      '`.next/standalone` is absent. Build with `output: "standalone"` configured first.',
    );
  }

  mkdirSync(outDir, { recursive: true });

  // 1. The server and its traced dependencies.
  copyInto(standalone, outDir, "the standalone server");

  // 2. Static assets. Next leaves these out of standalone by design and says so in its docs; the
  //    failure mode if they are forgotten is a page that renders with no CSS and no client JS,
  //    which looks like a product bug rather than a packaging one.
  copyInto(staticDir, join(outDir, ".next", "static"), "the static assets");

  // 3. Public assets, if the app has any.
  const publicDir = join(REPO, "public");
  if (existsSync(publicDir)) copyInto(publicDir, join(outDir, "public"), "the public assets");

  // 4. Schema and migrations. Not an import of the server, so nothing traced them, and without
  //    them a fresh installation has no way to create its own database.
  copyInto(join(REPO, "prisma", "migrations"), join(outDir, "prisma", "migrations"), "migrations");
  cpSync(join(REPO, "prisma", "schema.prisma"), join(outDir, "prisma", "schema.prisma"));

  // 5. The migration toolchain. Nothing traces it, because it is not an import of the server.
  //    Staged BEFORE the setup files, since one of them belongs inside it.
  const toolchain = stageMigrationToolchain(outDir);

  // 6. First-run setup, shipped as the same files the tests import. See `packaging/`.
  for (const [name, destination] of Object.entries(PACKAGED_SETUP_FILES)) {
    const to = join(outDir, ...destination.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(REPO, "packaging", name), to);
  }

  const files = walkStagedTree(outDir, outDir).sort((a, b) => a.path.localeCompare(b.path));

  // 5. The refusal. Checked on the RESULT, so it cannot be satisfied by a careful copy list that
  //    a later edit widens.
  const offenders = files.filter((f) => isForbiddenStagedPath(f.path));
  if (offenders.length > 0) {
    const shown = offenders
      .slice(0, 10)
      .map((o) => `  ${o.path}`)
      .join("\n");
    throw new Error(
      `staging refused: ${offenders.length} forbidden path(s) reached the staged tree:\n${shown}`,
    );
  }

  const buildId = readFileSync(join(outDir, ".next", "BUILD_ID"), "utf8").trim();
  const manifest = {
    stagedAt: new Date().toISOString(),
    sourceCommit: gitOutput(["rev-parse", "HEAD"]),
    sourceTree: gitOutput(["rev-parse", "HEAD^{tree}"]),
    sourceDirtyFiles: gitOutput(["status", "--porcelain"]).split("\n").filter(Boolean).length,
    buildId,
    nodeVersion: process.version,
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    migrations: readdirSync(join(outDir, "prisma", "migrations")).filter((n) => /^\d/.test(n)),
    migrationRunner: {
      prismaVersion: toolchain.version,
      packages: toolchain.packages,
      path: MIGRATION_RUNNER_PATH,
    },
    keyFileHashes: {
      "server.js": sha256(join(outDir, "server.js")),
      "prisma/schema.prisma": sha256(join(outDir, "prisma", "schema.prisma")),
      // The setup files are hashed because they are the part of the package that decides whether
      // to touch a user's database. A silent difference between what was tested and what shipped
      // is exactly what a manifest is for.
      ...Object.fromEntries(
        Object.values(PACKAGED_SETUP_FILES).map((d) => [d, sha256(join(outDir, ...d.split("/")))]),
      ),
    },
  };
  const manifestPath = join(outDir, "market-os-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { outDir, files, manifestPath };
}

function defaultOut(): string {
  // Outside the repository, always. A staging directory inside the worktree could resolve
  // dependencies from it by accident and prove nothing.
  const dir = join(tmpdir(), "market-os-staging", `run-${Date.now().toString(36)}`);
  if (resolve(dir).startsWith(resolve(REPO) + sep)) {
    throw new Error("refusing to stage inside the repository");
  }
  return dir;
}

if (process.argv[1] && process.argv[1].endsWith("stage-runtime.ts")) {
  const outIndex = process.argv.indexOf("--out");
  const outDir = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : defaultOut();
  if (resolve(outDir).startsWith(resolve(REPO) + sep)) {
    console.error("REFUSING: staging directory is inside the repository.");
    process.exit(1);
  }
  const result = stageRuntime(outDir);
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  console.log(`staged ${result.files.length} files to ${result.outDir}`);
  console.log(`  commit     ${manifest.sourceCommit}`);
  console.log(`  tree       ${manifest.sourceTree} (${manifest.sourceDirtyFiles} dirty)`);
  console.log(`  buildId    ${manifest.buildId}`);
  console.log(`  node       ${manifest.nodeVersion}`);
  console.log(`  bytes      ${manifest.totalBytes.toLocaleString("en-US")}`);
  console.log(`  migrations ${manifest.migrations.length}`);
  console.log(
    `  runner     prisma ${manifest.migrationRunner.prismaVersion} ` +
      `(${manifest.migrationRunner.packages} packages)`,
  );
  console.log(`  manifest   ${result.manifestPath}`);
  const staticCount = result.files.filter((f) => f.path.startsWith(".next/static/")).length;
  console.log(`  static     ${staticCount} files`);
  if (statSync(join(outDir, "node_modules")).isDirectory()) {
    console.log(`  node_modules is a real directory (not a link out of the package)`);
  }
}
