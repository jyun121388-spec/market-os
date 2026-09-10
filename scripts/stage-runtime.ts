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
import { join, relative, resolve, sep } from "node:path";
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
];

/** True when this staged path must be refused. Paths use forward slashes. */
export function isForbiddenStagedPath(path: string): boolean {
  const vendored = /(^|\/)node_modules\//.test(path);
  return FORBIDDEN_STAGED_PATTERNS.some(
    (p) => (p.insideNodeModules || !vendored) && p.pattern.test(path),
  );
}

interface StagedFile {
  path: string;
  bytes: number;
}

function walk(dir: string, base: string, out: StagedFile[] = []): StagedFile[] {
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
    if (st.isDirectory()) walk(full, base, out);
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

  const files = walk(outDir, outDir).sort((a, b) => a.path.localeCompare(b.path));

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
    keyFileHashes: {
      "server.js": sha256(join(outDir, "server.js")),
      "prisma/schema.prisma": sha256(join(outDir, "prisma", "schema.prisma")),
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
  console.log(`  manifest   ${result.manifestPath}`);
  const staticCount = result.files.filter((f) => f.path.startsWith(".next/static/")).length;
  console.log(`  static     ${staticCount} files`);
  if (statSync(join(outDir, "node_modules")).isDirectory()) {
    console.log(`  node_modules is a real directory (not a link out of the package)`);
  }
}
