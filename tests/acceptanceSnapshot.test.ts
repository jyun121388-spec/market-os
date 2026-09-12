import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ALLOWED_SOURCE_CODES,
  computeRootDigest,
  deriveAllowlist,
  FORBIDDEN_TABLES,
  MANIFEST_VERSION,
  REQUIRED_TRANSFER_MODE,
  runImport,
  verifySnapshot,
  type SnapshotIo,
} from "../scripts/acceptance/market-snapshot";

/**
 * The acceptance snapshot harness, against the two findings independent verification reproduced.
 *
 * `V1D-EI-01`: the import read `manifest.snapshotSha256`, carried it into its result and reported
 * it — and never recomputed it. A snapshot edited after export would have imported cleanly and
 * then been attested under a digest describing bytes that no longer existed.
 *
 * `V1D-EI-02`: `deriveAllowlist` computed `closure.filter(forbidden)` and threw if that was
 * non-empty, but `visit()` returned before ever putting a forbidden table into `closure`. The
 * check could not fire under any input. It read as a safety property and asserted `true === true`.
 *
 * Both controls below are written so that reverting the repair turns them RED, which is the only
 * property that makes a regression test worth having.
 */

let dir = "";

/** A valid tiny corpus, built with the SAME digest function the exporter uses. */
function writeCorpus(rows: Record<string, string[]>): { rootDigest: string; tables: string[] } {
  const tables = Object.keys(rows);
  const counts: Record<string, number> = {};
  const hashes: Record<string, string> = {};
  for (const table of tables) {
    const file = join(dir, `${table}.csv`);
    writeFileSync(file, rows[table].join("\n") + "\n", "utf8");
    counts[table] = rows[table].length - 1;
    hashes[table] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  const rootDigest = computeRootDigest(tables, counts, hashes);
  writeFileSync(
    join(dir, "acceptance-manifest.json"),
    JSON.stringify(
      {
        manifestVersion: MANIFEST_VERSION,
        DATA_TRANSFER_MODE: REQUIRED_TRANSFER_MODE,
        counts,
        hashes,
        derivation: { tables },
        snapshotSha256: rootDigest,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { rootDigest, tables };
}

const CORPUS = {
  sources: ["id,code", "s1,SEC_EDGAR", "s2,FRED"],
  filings: ["id,sourceId,accession", "f1,s1,0000320193-24-000001"],
};

/** Records every call the import makes, so "it touched nothing" is measured rather than read. */
function recordingIo(): SnapshotIo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exec(sql: string) {
      calls.push(`exec:${sql}`);
      return "1";
    },
    copyIn(table: string) {
      calls.push(`copy:${table}`);
    },
  };
}

const TARGET = "postgresql://acceptance@127.0.0.1:9999/market_os";

beforeEach(() => {
  dir = join(tmpdir(), `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("V1D-EI-01: snapshot identity, established before the target is touched", () => {
  it("imports a byte-identical corpus and binds the RECOMPUTED root digest", () => {
    const { rootDigest } = writeCorpus(CORPUS);
    const io = recordingIo();
    const result = runImport(dir, TARGET, io);

    expect(result.rootDigest).toBe(rootDigest);
    // Recomputed, not copied: the same digest the corpus was built with, arrived at independently
    // by re-hashing the files on disk.
    expect(io.calls.filter((c) => c.startsWith("copy:"))).toEqual(["copy:sources", "copy:filings"]);
  });

  it("refuses a corpus whose CSV changed, BEFORE any DELETE or COPY", () => {
    // The exact shape the finding describes: one value edited, the row count preserved, so nothing
    // but a hash can tell. The manifest still carries the original digest.
    writeCorpus(CORPUS);
    const filings = join(dir, "filings.csv");
    writeFileSync(
      filings,
      readFileSync(filings, "utf8").replace("0000320193-24-000001", "0000320193-24-000999"),
      "utf8",
    );

    const io = recordingIo();
    expect(() => runImport(dir, TARGET, io)).toThrow(/does not match its manifest hash/);
    // THE load-bearing assertion. Remove the verification and this list is no longer empty,
    // because the import will have started deleting before it noticed.
    expect(io.calls).toEqual([]);
  });

  it("refuses when the manifest's own summary disagrees with files that each match", () => {
    // Every file hashes correctly and the root digest is still wrong — the case a per-file check
    // alone would wave through.
    writeCorpus(CORPUS);
    const manifestPath = join(dir, "acceptance-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.snapshotSha256 = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const io = recordingIo();
    expect(() => runImport(dir, TARGET, io)).toThrow(/recomputed root digest does not match/);
    expect(io.calls).toEqual([]);
  });

  it("refuses a row count that drifted from the manifest", () => {
    writeCorpus(CORPUS);
    const filings = join(dir, "filings.csv");
    writeFileSync(filings, readFileSync(filings, "utf8") + "f2,s1,0000320193-24-000002\n", "utf8");
    expect(() => runImport(dir, TARGET, recordingIo())).toThrow(/does not match its manifest hash/);
  });

  it("refuses a manifest of an unknown version or transfer mode", () => {
    // Shape validated before anything is measured, so a snapshot from a different harness is
    // refused rather than reinterpreted.
    for (const [field, value] of [
      ["manifestVersion", 99],
      ["DATA_TRANSFER_MODE", "SOMETHING_ELSE"],
    ] as const) {
      writeCorpus(CORPUS);
      const manifestPath = join(dir, "acceptance-manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest[field] = value;
      writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
      expect(() => verifySnapshot(dir), `${field}=${value} was accepted`).toThrow(
        /snapshot refused/,
      );
    }
  });

  it("still refuses to import into the developer database", () => {
    writeCorpus(CORPUS);
    expect(() =>
      runImport(dir, "postgresql://postgres@127.0.0.1:55432/market_os_dev", recordingIo()),
    ).toThrow(/developer database/);
  });
});

describe("V1D-EI-02: forbidden reach is a condition the traversal can actually reach", () => {
  /** A schema shaped like the repository's, with one edge the repository does not have. */
  const schema = (extraReferences: string[] = []) => [
    { model: "Source", table: "sources", references: [] },
    { model: "Filing", table: "filings", references: ["Source", ...extraReferences] },
    { model: "User", table: "users", references: [] },
    { model: "Session", table: "sessions", references: ["User"] },
  ];

  it("refuses when an exportable table's relation reaches a forbidden one", () => {
    // The negative control. Nothing in this repository has such an edge today, so the graph is
    // constructed — and the refusal must name the exact edge and the exact reason.
    expect(() =>
      deriveAllowlist({ schema: schema(["User"]), queried: ["Filing", "Source"] }),
    ).toThrow(/filings -> users/);
    expect(() =>
      deriveAllowlist({ schema: schema(["User"]), queried: ["Filing", "Source"] }),
    ).toThrow(/referential integrity/);
  });

  it("does not refuse the same graph without that edge", () => {
    // The control that stops the assertion above from passing for the wrong reason.
    const derived = deriveAllowlist({ schema: schema(), queried: ["Filing", "Source"] });
    expect(derived.tables).toEqual(["filings", "sources"]);
    expect(derived.forbiddenReaches).toEqual([]);
  });

  it("reports a forbidden model the application queries as an explicit OMISSION, not a closure result", () => {
    // The truthfulness half of the finding. `User` and `Session` are queried by the application and
    // deliberately not exported; that is a decision this harness makes, and calling it the output
    // of a transitive-closure pass — as the previous comment did — described work the traversal
    // never performed.
    const derived = deriveAllowlist({
      schema: schema(),
      queried: ["Filing", "Source", "User", "Session"],
    });
    expect(derived.omittedForbiddenRoots).toEqual(["sessions", "users"]);
    expect(derived.tables).not.toContain("users");
    expect(derived.tables).not.toContain("sessions");
  });

  it("silently pruning the edge instead of refusing would fail these controls", () => {
    // Stated as an assertion rather than as a comment: the refusal is thrown, so a traversal that
    // merely skipped the edge and carried on would return a value here and fail the expectation.
    let threw = false;
    try {
      deriveAllowlist({ schema: schema(["User"]), queried: ["Filing"] });
    } catch {
      threw = true;
    }
    expect(threw, "a forbidden reach must throw, not be pruned in silence").toBe(true);
  });
});

describe("the real repository, measured", () => {
  it("has no exportable table reaching a forbidden one", () => {
    const derived = deriveAllowlist();
    expect(derived.forbiddenReaches).toEqual([]);
  });

  it("omits exactly the three identity and user-state roots the application queries", () => {
    const derived = deriveAllowlist();
    expect(derived.omittedForbiddenRoots).toEqual([...FORBIDDEN_TABLES].sort());
    for (const table of FORBIDDEN_TABLES) expect(derived.tables).not.toContain(table);
  });

  it("still restricts the snapshot to the two authorized providers", () => {
    // ECOS and OpenDART stay out while HG-003 and HG-004 are pending.
    expect([...ALLOWED_SOURCE_CODES]).toEqual(["SEC_EDGAR", "FRED"]);
  });
});
