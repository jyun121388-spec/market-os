import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The v2 meta layers must stay INERT relative to Market OS v1.
 *
 * `docs/META_ARCHITECTURE_V2.md` promises that every shadow layer computes, logs and compares
 * without ever blocking or mutating. That promise is only as good as the import graph, and an
 * import is one autocomplete away — someone wiring a verdict into a page would break the guarantee
 * without noticing they had made an architectural decision at all.
 *
 * So the boundary is a test rather than a convention. It reads the actual source, not a
 * dependency manifest, because the manifest is what would be updated last.
 */

const ROOT = process.cwd();
const SHADOW_LAYERS = ["fabric", "verify", "governance", "evolution"];

/** v1 production code: everything a user request can reach. */
const V1_DIRECTORIES = [
  join("src", "app"),
  join("src", "server", "domain"),
  join("src", "server", "adapters"),
  join("src", "server", "actions"),
  join("src", "server", "db"),
  join("src", "lib"),
];

function sourceFilesUnder(dir: string): string[] {
  const absolute = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFilesUnder(join(dir, entry)));
    } else if (/\.(ts|tsx|mts)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const SHADOW_IMPORT = new RegExp(`["'@/.][^"']*server[\\\\/](${SHADOW_LAYERS.join("|")})[\\\\/]`);

describe("v2 shadow layers are inert relative to v1", () => {
  const v1Files = V1_DIRECTORIES.flatMap(sourceFilesUnder);

  it("finds v1 source to check, so a passing result is not vacuous", () => {
    // A boundary test that silently scanned nothing would pass forever. Guarding the guard.
    expect(v1Files.length).toBeGreaterThan(20);
  });

  it("no v1 production file imports fabric, verify, governance or evolution", () => {
    const offenders: string[] = [];
    for (const file of v1Files) {
      const contents = readFileSync(file, "utf8");
      for (const line of contents.split(/\r?\n/)) {
        if (!/^\s*(import|export)\b|require\(/.test(line)) continue;
        if (SHADOW_IMPORT.test(line)) {
          offenders.push(`${relative(ROOT, file).split(sep).join("/")}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      "A v1 module imported a shadow layer. Shadow mode means observational only — see " +
        "docs/META_ARCHITECTURE_V2.md before changing this.",
    ).toEqual([]);
  });

  it("the shadow layers do not import each other's internals out of order", () => {
    // The stack is Fabric → Verify → Evolution → Governance. Evolution must not reach into
    // Verify's evaluators, and Governance must not depend on Evolution, or the "Evolution
    // proposes, Governance decides" separation collapses into one tangled layer.
    const forbidden: Record<string, string[]> = {
      fabric: ["verify", "governance", "evolution"],
      governance: ["evolution", "verify", "fabric"],
    };
    const offenders: string[] = [];
    for (const [layer, mustNotImport] of Object.entries(forbidden)) {
      for (const file of sourceFilesUnder(join("src", "server", layer))) {
        const contents = readFileSync(file, "utf8");
        for (const other of mustNotImport) {
          if (new RegExp(`server[\\\\/]${other}[\\\\/]`).test(contents)) {
            offenders.push(`${relative(ROOT, file).split(sep).join("/")} imports ${other}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no shadow layer writes to the database", () => {
    // Read-only is the property that makes these safe to run against market_os_dev, which holds
    // real ingested SEC data. Checked structurally rather than trusted.
    const writes =
      /prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|\$executeRaw/;
    const offenders: string[] = [];
    for (const layer of SHADOW_LAYERS) {
      for (const file of sourceFilesUnder(join("src", "server", layer))) {
        const contents = readFileSync(file, "utf8");
        if (writes.test(contents)) {
          offenders.push(relative(ROOT, file).split(sep).join("/"));
        }
      }
    }
    expect(offenders, "A shadow layer performs a write. It must observe, never mutate.").toEqual(
      [],
    );
  });
});
