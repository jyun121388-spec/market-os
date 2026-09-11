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
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
 * The tables an acceptance snapshot may contain, derived rather than declared.
 *
 * Start from the models the APPLICATION queries — found by scanning `src/` for `prisma.<model>.`,
 * which is the same thing the routes do — drop the forbidden ones, then follow the schema's
 * relation graph until it closes. Typing a list by hand would make this a statement about what
 * somebody remembered.
 */
export function deriveAllowlist(
  schema: SchemaModel[] = readSchema(),
  sourceRoot = "src",
): { tables: string[]; queried: string[]; refused: string[] } {
  const byModel = new Map(schema.map((m) => [m.model, m]));
  const lowerToModel = new Map(
    schema.map((m) => [m.model[0].toLowerCase() + m.model.slice(1), m.model]),
  );

  const queriedModels = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        for (const [, accessor] of readFileSync(full, "utf8").matchAll(/prisma\.([a-zA-Z]+)\./g)) {
          const model = lowerToModel.get(accessor);
          if (model) queriedModels.add(model);
        }
      }
    }
  };
  walk(sourceRoot);

  const forbidden = new Set<string>(FORBIDDEN_TABLES);
  const refused: string[] = [];
  const closure = new Set<string>();
  const visit = (model: string) => {
    const entry = byModel.get(model);
    if (!entry || closure.has(entry.table)) return;
    if (forbidden.has(entry.table)) {
      refused.push(entry.table);
      return;
    }
    closure.add(entry.table);
    for (const reference of entry.references) visit(reference);
  };
  for (const model of queriedModels) visit(model);

  const leaked = [...closure].filter((t) => forbidden.has(t));
  if (leaked.length > 0) {
    throw new Error(
      `snapshot refused: the derived closure reached forbidden table(s) ${leaked.join(", ")}. ` +
        `An acceptance snapshot must carry no identity, authentication or per-user state.`,
    );
  }
  return {
    tables: [...closure].sort(),
    queried: [...queriedModels].sort(),
    refused: refused.sort(),
  };
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

function runExport(outDir: string, sourceUrl: string, binDir: string) {
  const { tables, queried, refused } = deriveAllowlist();
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
    DATA_TRANSFER_MODE: "OFFLINE_ACCEPTANCE_SNAPSHOT",
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
      refusedAtDerivation: refused,
      tables: exportable,
    },
    counts,
    hashes,
    snapshotSha256: createHash("sha256")
      .update(exportable.map((t) => `${t}:${counts[t]}:${hashes[t]}`).join("\n"))
      .digest("hex"),
  };
  const manifestPath = join(outDir, "acceptance-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

function runImport(inDir: string, targetUrl: string, binDir: string) {
  // The developer database is named explicitly so that a mistyped target cannot overwrite it.
  if (/market_os_dev\b/.test(targetUrl) || /:55432\b/.test(targetUrl)) {
    throw new Error("refusing to import into the developer database or its cluster");
  }
  const manifest = JSON.parse(readFileSync(join(inDir, "acceptance-manifest.json"), "utf8"));
  const tables: string[] = manifest.derivation.tables;

  for (const table of tables) {
    if ((FORBIDDEN_TABLES as readonly string[]).includes(table)) {
      throw new Error(`refusing to import forbidden table ${table}`);
    }
  }
  // Reverse order so a child is cleared before its parent.
  for (const table of [...tables].reverse()) {
    psql(targetUrl, `DELETE FROM "${table}"`, binDir);
  }
  const imported: Record<string, number> = {};
  for (const table of tables) {
    const file = join(inDir, `${table}.csv`).replace(/\\/g, "/");
    execFileSync(
      join(binDir, "psql"),
      ["-d", targetUrl, "-qc", `\\copy "${table}" FROM '${file}' CSV HEADER`],
      {
        encoding: "utf8",
      },
    );
    imported[table] = Number(psql(targetUrl, `SELECT count(*) FROM "${table}"`, binDir).trim());
  }
  return { imported, expected: manifest.counts, snapshotSha256: manifest.snapshotSha256 };
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
    const result = runImport(arg("in") ?? "acceptance-snapshot", arg("url") ?? "", binDir);
    let mismatched = 0;
    for (const [table, count] of Object.entries(result.imported)) {
      const same = count === result.expected[table];
      if (!same) mismatched += 1;
      console.log(
        `  ${same ? "OK  " : "DIFF"} ${table.padEnd(26)} ${count} (expected ${result.expected[table]})`,
      );
    }
    console.log(
      mismatched === 0 ? `imported ${result.snapshotSha256}` : `${mismatched} table(s) differ`,
    );
    process.exitCode = mismatched === 0 ? 0 : 1;
  } else {
    console.error("usage: market-snapshot.ts export|import --url <db url> [--out|--in <dir>]");
    process.exit(2);
  }
}
