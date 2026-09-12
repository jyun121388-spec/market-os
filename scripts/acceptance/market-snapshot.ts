/**
 * ACCEPTANCE ONLY. Exports a deliberately scoped, non-secret market/evidence snapshot, and imports
 * it into a clean-room database so the packaged GUI can be exercised over real content.
 *
 *   npx tsx scripts/acceptance/market-snapshot.ts export --out <dir>
 *   npx tsx scripts/acceptance/market-snapshot.ts import --in <dir> --url <clean-room url>
 *
 * NOT part of the product and never staged into a distribution. A user never runs this; it is test
 * infrastructure that puts content in front of the GUI so a human journey can be walked.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN A `pg_dump`
 *
 * The first attempt at content evidence copied the whole developer database into a clean-room
 * installation. That is inadmissible twice over. It is not clean — the clone carries developer
 * users, sessions, password hashes and admin identities — and it is not scoped, so it drags in
 * ECOS and OpenDART rows whose acquisition is quarantined under IR-148.
 *
 * So the allowlist is DERIVED rather than typed: the models the application actually queries,
 * minus an explicit forbidden set, transitively closed over the schema's own relation graph. If
 * that closure ever reaches a forbidden table, this refuses to run rather than exporting it.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE SNAPSHOT IS NOT
 *
 * It is not a claim that a clean machine acquired this data. `acceptance-manifest.json` records
 * `DATA_TRANSFER_MODE = OFFLINE_ACCEPTANCE_SNAPSHOT` for exactly that reason. Provider provenance
 * is copied VERBATIM — source codes, accession numbers, observation dates, `retrievedAt` — so the
 * UI keeps attributing each fact to SEC EDGAR or FRED and not to this file. Timestamps are never
 * rewritten: if a series was stale in the source database it renders stale in the clean room,
 * because a freshness indicator that acceptance quietly refreshed would be worth nothing.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tables that must never leave the developer machine, whatever the closure says.
 *
 * Identity, authentication and per-user state. The check is not "did we remember to skip these" —
 * the derivation below asserts they are absent, and throws if one appears.
 */
export const FORBIDDEN_TABLES = ["users", "sessions", "watchlist_items"] as const;

/**
 * Providers whose data may appear in an acceptance snapshot.
 *
 * SEC EDGAR is public and keyless. FRED's gate HG-002 was granted by the user. ECOS and OpenDART
 * are excluded because HG-003 and HG-004 are `PENDING_USER`: their stored rows remain audit
 * evidence in the developer database and have no business in a delivery artefact. Every `TEST_*`
 * source is excluded too — those are synthetic fixtures, and showing them to a reader as market
 * content would be a different kind of dishonesty.
 */
export const ALLOWED_SOURCE_CODES = ["SEC_EDGAR", "FRED"] as const;

/** Manifest shape this harness understands. An older or newer snapshot is refused, not guessed at. */
export const MANIFEST_VERSION = 1;

/** The only transfer mode an acceptance import will accept. */
export const REQUIRED_TRANSFER_MODE = "OFFLINE_ACCEPTANCE_SNAPSHOT";

/** Import order. Parents first, so a foreign key never arrives before what it points at. */
export const TABLE_ORDER = [
  "sources",
  "series",
  "observations",
  "data_conflicts",
  "filings",
  "financial_facts",
  "etfs",
  "etf_holdings",
  "real_estate_transactions",
  "events",
  "event_mentions",
  "causal_edges",
  "claims",
  "ingest_runs",
] as const;

interface SchemaModel {
  model: string;
  table: string;
  references: string[];
}

/** Parse the Prisma schema into a model -> table map and the outgoing relation graph. */
export function readSchema(path = "prisma/schema.prisma"): SchemaModel[] {
  const text = readFileSync(path, "utf8");
  const models: SchemaModel[] = [];
  for (const [, name, body] of text.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const mapped = /@@map\("([^"]+)"\)/.exec(body);
    const references = [...body.matchAll(/^\s*\w+\s+(\w+)\??\s+@relation/gm)].map((m) => m[1]);
    models.push({ model: name, table: mapped ? mapped[1] : name, references });
  }
  return models;
}

/**
 * Two DIFFERENT ways a forbidden table can come up, which the first version of this file conflated.
 *
 * A forbidden model the application queries DIRECTLY is a root we decline to export. That is a
 * deliberate omission and it is recorded as one.
 *
 * A forbidden table reached by FOLLOWING A RELATION out of a table we do export is something else
 * entirely: it means an exported row carries a foreign key to a row that will not exist in the
 * target. There is no safe silent pruning for that — the import either violates the constraint or
 * quietly drops a reference the schema says is required — so it is a hard refusal.
 */
export interface ForbiddenReach {
  /** The exportable table whose relation points into forbidden territory. */
  from: string;
  /** The forbidden table it reaches. */
  to: string;
}

export interface AllowlistDerivation {
  /** Tables the snapshot may contain. */
  tables: string[];
  /** Models the application was observed to query. */
  queried: string[];
  /**
   * Forbidden models the application queries directly, declined as export ROOTS.
   *
   * Named honestly. The earlier version called this `refused` and folded it into what it described
   * as a transitive-closure pass, which made an intentional omission look like a safety property
   * the traversal had established.
   */
  omittedForbiddenRoots: string[];
  /** Relations out of exportable tables into forbidden ones. Non-empty means the derivation threw. */
  forbiddenReaches: ForbiddenReach[];
}

/**
 * The tables an acceptance snapshot may contain, derived rather than declared.
 *
 * Start from the models the APPLICATION queries — found by scanning `src/` for `prisma.<model>.`,
 * which is the same thing the routes do — and follow the schema's relation graph until it closes.
 * Typing a list by hand would make this a statement about what somebody remembered.
 *
 * WHAT CHANGED, and why the previous version was worse than useless: it computed
 * `closure.filter(forbidden)` and threw if that was non-empty — but `visit()` returned before ever
 * adding a forbidden table to `closure`, so the check could not fire under any input. It read as a
 * safety property and was an assertion that `true === true`. Verification `V1D-EI-02` reproduced
 * exactly that.
 *
 * The contract now distinguishes the two cases above and REFUSES on a forbidden reach, which is a
 * condition the traversal can actually reach.
 */
export function deriveAllowlist(
  options: {
    schema?: SchemaModel[];
    sourceRoot?: string;
    /** Injectable so a negative control can present a graph this repository does not have today. */
    queried?: string[];
  } = {},
): AllowlistDerivation {
  const schema = options.schema ?? readSchema();
  const byModel = new Map(schema.map((m) => [m.model, m]));
  const forbidden = new Set<string>(FORBIDDEN_TABLES);

  const queriedModels = new Set<string>(
    options.queried ?? scanQueriedModels(schema, options.sourceRoot ?? "src"),
  );

  // Roots we decline, stated as an omission rather than discovered by traversal.
  const omittedForbiddenRoots: string[] = [];
  const roots: string[] = [];
  for (const model of queriedModels) {
    const entry = byModel.get(model);
    if (!entry) continue;
    if (forbidden.has(entry.table)) omittedForbiddenRoots.push(entry.table);
    else roots.push(model);
  }

  const closure = new Set<string>();
  const forbiddenReaches: ForbiddenReach[] = [];
  const visit = (model: string) => {
    const entry = byModel.get(model);
    if (!entry || closure.has(entry.table)) return;
    closure.add(entry.table);
    for (const reference of entry.references) {
      const target = byModel.get(reference);
      if (!target) continue;
      if (forbidden.has(target.table)) {
        // Recorded, not pruned. An exported row would point at a row we refuse to export.
        forbiddenReaches.push({ from: entry.table, to: target.table });
        continue;
      }
      visit(reference);
    }
  };
  for (const model of roots) visit(model);

  if (forbiddenReaches.length > 0) {
    throw new Error(
      `snapshot refused: exportable table(s) reach forbidden identity or user-state tables — ` +
        forbiddenReaches.map((r) => `${r.from} -> ${r.to}`).join(", ") +
        `. Exporting a row whose foreign key points at a row this snapshot will not carry breaks ` +
        `referential integrity on import, and there is no safe way to prune it silently.`,
    );
  }

  return {
    tables: [...closure].sort(),
    queried: [...queriedModels].sort(),
    omittedForbiddenRoots: [...new Set(omittedForbiddenRoots)].sort(),
    forbiddenReaches,
  };
}

/** The models the application queries, read out of the source rather than declared. */
function scanQueriedModels(schema: SchemaModel[], sourceRoot: string): string[] {
  const lowerToModel = new Map(
    schema.map((m) => [m.model[0].toLowerCase() + m.model.slice(1), m.model]),
  );
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        for (const [, accessor] of readFileSync(full, "utf8").matchAll(/prisma\.([a-zA-Z]+)\./g)) {
          const model = lowerToModel.get(accessor);
          if (model) found.add(model);
        }
      }
    }
  };
  walk(sourceRoot);
  return [...found];
}

/**
 * The row filter for one table.
 *
 * Source-scoped tables are filtered to the allowed providers. The two that carry no `sourceId`
 * reach their provider through a parent, and are filtered through it rather than exported whole.
 */
function rowFilter(table: string, allowedSourceIds: string[]): string {
  const ids = allowedSourceIds.map((id) => `'${id}'`).join(", ");
  switch (table) {
    case "sources":
      return `WHERE id IN (${ids})`;
    case "data_conflicts":
      return `WHERE "observationId" IN (SELECT id FROM observations WHERE "sourceId" IN (${ids}))`;
    case "etf_holdings":
      return `WHERE "etfId" IN (SELECT id FROM etfs WHERE "sourceId" IN (${ids}))`;
    case "events":
      return `WHERE id IN (SELECT "eventId" FROM event_mentions WHERE "sourceId" IN (${ids}))`;
    case "causal_edges":
      // Curated domain relationships between concepts, with no provider and no personal data.
      return "";
    default:
      return `WHERE "sourceId" IN (${ids})`;
  }
}

function psql(url: string, sql: string, binDir: string): string {
  return execFileSync(join(binDir, "psql"), ["-d", url, "-tAqc", sql], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Rows in a CSV, counted the same way at export and at verification. */
function csvRowCount(file: string): number {
  return Math.max(
    0,
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.length > 0).length - 1,
  );
}

/**
 * The snapshot's root digest, over the (table, count, hash) tuple of every exported file.
 *
 * One function, called by the exporter and by the verifier, because two implementations of a
 * digest are two chances to disagree — and the disagreement would surface as a false refusal or,
 * far worse, a false acceptance.
 */
export function computeRootDigest(
  tables: readonly string[],
  counts: Record<string, number>,
  hashes: Record<string, string>,
): string {
  return createHash("sha256")
    .update(tables.map((t) => `${t}:${counts[t]}:${hashes[t]}`).join("\n"))
    .digest("hex");
}

export interface VerifiedSnapshot {
  tables: string[];
  counts: Record<string, number>;
  rootDigest: string;
}

/**
 * Establish that a snapshot directory is the snapshot its manifest claims to be.
 *
 * Called BEFORE the import touches the target, and that ordering is the whole point. Verification
 * `V1D-EI-01` reproduced the earlier behaviour: the manifest's `snapshotSha256` was read, carried
 * into the result, and reported — and never once recomputed. A snapshot whose CSV had been edited
 * after export would have imported cleanly and then been attested under a digest describing bytes
 * that no longer existed.
 *
 * So nothing here trusts the manifest about itself. Every CSV is re-hashed and re-counted from
 * disk, the root digest is recomputed from those measured values, and only then is the manifest's
 * own claim compared against it. A digest is evidence when you compute it and a decoration when
 * you copy it.
 */
export function verifySnapshot(inDir: string): VerifiedSnapshot {
  const manifestPath = join(inDir, "acceptance-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`snapshot refused: no acceptance-manifest.json in ${inDir}`);
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    // Not quoted: a malformed manifest is reported by shape, never by echoing its contents.
    throw new Error("snapshot refused: acceptance-manifest.json is not readable JSON");
  }

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `snapshot refused: manifest version ${String(manifest.manifestVersion)} is not ${MANIFEST_VERSION}`,
    );
  }
  if (manifest.DATA_TRANSFER_MODE !== REQUIRED_TRANSFER_MODE) {
    throw new Error(
      `snapshot refused: transfer mode ${String(manifest.DATA_TRANSFER_MODE)} is not ${REQUIRED_TRANSFER_MODE}`,
    );
  }

  const derivation = manifest.derivation as { tables?: unknown } | undefined;
  const tables = derivation?.tables;
  const counts = manifest.counts as Record<string, number> | undefined;
  const hashes = manifest.hashes as Record<string, string> | undefined;
  if (!Array.isArray(tables) || counts === undefined || hashes === undefined) {
    throw new Error("snapshot refused: manifest is missing derivation.tables, counts or hashes");
  }

  const measuredCounts: Record<string, number> = {};
  const measuredHashes: Record<string, string> = {};
  for (const table of tables as string[]) {
    const file = join(inDir, `${table}.csv`);
    if (!existsSync(file)) throw new Error(`snapshot refused: ${table}.csv is missing`);
    measuredHashes[table] = sha256(file);
    measuredCounts[table] = csvRowCount(file);
    if (measuredHashes[table] !== hashes[table]) {
      throw new Error(
        `snapshot refused: ${table}.csv does not match its manifest hash. The file changed after ` +
          `export, so nothing about this snapshot can be attested.`,
      );
    }
    if (measuredCounts[table] !== counts[table]) {
      throw new Error(
        `snapshot refused: ${table}.csv holds ${measuredCounts[table]} rows, manifest says ${counts[table]}`,
      );
    }
  }

  const rootDigest = computeRootDigest(tables as string[], measuredCounts, measuredHashes);
  if (rootDigest !== manifest.snapshotSha256) {
    throw new Error(
      "snapshot refused: the recomputed root digest does not match the manifest. Every file " +
        "matched its own hash, so the manifest's own summary of them is what is wrong.",
    );
  }
  return { tables: tables as string[], counts: measuredCounts, rootDigest };
}

function runExport(outDir: string, sourceUrl: string, binDir: string) {
  const { tables, queried, omittedForbiddenRoots } = deriveAllowlist();
  const exportable = TABLE_ORDER.filter((t) => tables.includes(t));
  const missing = tables.filter((t) => !TABLE_ORDER.includes(t as (typeof TABLE_ORDER)[number]));
  if (missing.length > 0) {
    throw new Error(
      `derived closure contains tables with no declared import order: ${missing.join(", ")}`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const codes = ALLOWED_SOURCE_CODES.map((c) => `'${c}'`).join(", ");
  const ids = psql(
    sourceUrl,
    `SELECT id FROM sources WHERE code IN (${codes}) ORDER BY code`,
    binDir,
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0)
    throw new Error("no allowed source rows found; refusing to write an empty snapshot");

  const counts: Record<string, number> = {};
  const hashes: Record<string, string> = {};
  for (const table of exportable) {
    const file = join(outDir, `${table}.csv`);
    // `\copy` runs client-side, so the developer database is only ever READ.
    const command = `\\copy (SELECT * FROM "${table}" ${rowFilter(table, ids)}) TO '${file.replace(/\\/g, "/")}' CSV HEADER`;
    execFileSync(join(binDir, "psql"), ["-d", sourceUrl, "-qc", command], { encoding: "utf8" });
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    counts[table] = Math.max(0, lines.length - 1);
    hashes[table] = sha256(file);
  }

  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    DATA_TRANSFER_MODE: REQUIRED_TRANSFER_MODE,
    SOURCE_DATABASE: "DEVELOPMENT_EVIDENCE_STORE",
    LIVE_PROVIDER_CALLS_DURING_ACCEPTANCE: 0,
    exportedAt: new Date().toISOString(),
    allowedSourceCodes: [...ALLOWED_SOURCE_CODES],
    excluded: {
      providers: ["ECOS", "OPENDART"],
      why: "HG-003 and HG-004 are PENDING_USER; their stored rows stay audit evidence and ship nowhere",
      syntheticSources: "every TEST_* source, which is a fixture rather than market content",
      tables: [...FORBIDDEN_TABLES],
    },
    derivation: {
      modelsQueriedByApplication: queried,
      omittedForbiddenRoots,
      tables: exportable,
    },
    counts,
    hashes,
    snapshotSha256: computeRootDigest(exportable, counts, hashes),
  };
  const manifestPath = join(outDir, "acceptance-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

/**
 * How the import reaches the database.
 *
 * Injectable so that "it refused BEFORE touching the target" is a measurable claim rather than a
 * reading of the source. A test passes a recorder and asserts the call count is zero.
 */
export interface SnapshotIo {
  exec(sql: string): string;
  copyIn(table: string, file: string): void;
}

export function psqlIo(targetUrl: string, binDir: string): SnapshotIo {
  return {
    exec: (sql) => psql(targetUrl, sql, binDir),
    copyIn: (table, file) => {
      execFileSync(
        join(binDir, "psql"),
        ["-d", targetUrl, "-qc", `\\copy "${table}" FROM '${file.replace(/\\/g, "/")}' CSV HEADER`],
        { encoding: "utf8" },
      );
    },
  };
}

export function runImport(
  inDir: string,
  targetUrl: string,
  io: SnapshotIo,
): { imported: Record<string, number>; expected: Record<string, number>; rootDigest: string } {
  // The developer database is named explicitly so that a mistyped target cannot overwrite it.
  if (/market_os_dev\b/.test(targetUrl) || /:55432\b/.test(targetUrl)) {
    throw new Error("refusing to import into the developer database or its cluster");
  }

  // IDENTITY FIRST. Everything below mutates the target, and none of it runs until the snapshot
  // has been re-measured from disk and found to be what its manifest says (V1D-EI-01).
  const verified = verifySnapshot(inDir);

  for (const table of verified.tables) {
    if ((FORBIDDEN_TABLES as readonly string[]).includes(table)) {
      throw new Error(`refusing to import forbidden table ${table}`);
    }
  }

  // Reverse order so a child is cleared before its parent.
  for (const table of [...verified.tables].reverse()) io.exec(`DELETE FROM "${table}"`);

  const imported: Record<string, number> = {};
  for (const table of verified.tables) {
    io.copyIn(table, join(inDir, `${table}.csv`));
    imported[table] = Number(io.exec(`SELECT count(*) FROM "${table}"`).trim());
  }
  return { imported, expected: verified.counts, rootDigest: verified.rootDigest };
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

if (process.argv[1] && process.argv[1].endsWith("market-snapshot.ts")) {
  const mode = process.argv[2];
  const binDir = arg("pg-bin") ?? "C:/AI-Projects/market-os/.local/pgsql/bin";
  if (mode === "export") {
    const manifest = runExport(arg("out") ?? "acceptance-snapshot", arg("url") ?? "", binDir);
    console.log(`snapshot ${manifest.snapshotSha256}`);
    for (const [table, count] of Object.entries(manifest.counts))
      console.log(`  ${table.padEnd(26)} ${count}`);
  } else if (mode === "import") {
    const url = arg("url") ?? "";
    const result = runImport(arg("in") ?? "acceptance-snapshot", url, psqlIo(url, binDir));
    let mismatched = 0;
    for (const [table, count] of Object.entries(result.imported)) {
      const same = count === result.expected[table];
      if (!same) mismatched += 1;
      console.log(
        `  ${same ? "OK  " : "DIFF"} ${table.padEnd(26)} ${count} (expected ${result.expected[table]})`,
      );
    }
    console.log(
      mismatched === 0 ? `imported ${result.rootDigest}` : `${mismatched} table(s) differ`,
    );
    process.exitCode = mismatched === 0 ? 0 : 1;
  } else {
    console.error("usage: market-snapshot.ts export|import --url <db url> [--out|--in <dir>]");
    process.exit(2);
  }
}
