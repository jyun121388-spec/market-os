/**
 * Observes what ECOS and OpenDART responses ACTUALLY carry, axis by axis.
 *
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/observe-capability-axes.ts
 *
 * `src/server/fabric/providerCapability.ts` enforces one rule by test: `SUPPORTED` and
 * `NOT_SUPPORTED` both require `LIVE_RESPONSE`. Until HG-003 and HG-004 closed, all 28 ECOS and
 * OpenDART cells were `NOT_VERIFIED` — documented or declared, never seen. This script is what
 * makes the difference, and it exists as a committed script rather than a session's transcript so
 * the matrix can be re-derived instead of re-remembered.
 *
 * What it prints is a FIELD INVENTORY: the complete key set of a real response row, and nothing
 * else. That is deliberate. An axis is `NOT_SUPPORTED` only when a real response has been shown to
 * carry no mechanism for it, and the only honest way to show that is to enumerate every key the
 * provider actually sent and find none. Reading a documentation page again would be the same
 * mistake in a new place.
 *
 * No credential is printed. ECOS carries its key in the URL PATH, so nothing here prints a URL.
 */
import { fetchEcosObservations } from "../src/server/adapters/ecos/client";
import { TRACKED_ECOS_SERIES } from "../src/server/adapters/ecos/types";
import { fetchDartDisclosures } from "../src/server/adapters/dart/client";

/** Samsung Electronics. The one company this installation has ingested. */
const CORP_CODE = "00126380";

function inventory(label: string, rows: Record<string, unknown>[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  console.log(`\n${label}`);
  console.log(`  rows observed   ${rows.length}`);
  console.log(`  distinct keys   ${keys.size}`);
  for (const key of [...keys].sort()) {
    const populated = rows.filter((r) => r[key] !== undefined && r[key] !== null && r[key] !== "");
    // The COUNT, and the shape of one value. Never the whole row: an ECOS row is a public
    // statistic, but a habit of dumping provider payloads is how a credential eventually appears
    // in a log.
    const sample = populated.length > 0 ? typeof populated[0][key] : "absent";
    console.log(
      `    ${key.padEnd(24)} populated ${String(populated.length).padStart(4)}/${rows.length}  (${sample})`,
    );
  }
  return keys;
}

function axis(name: string, present: boolean, note: string) {
  console.log(`  ${present ? "PRESENT" : "ABSENT "}  ${name.padEnd(28)} ${note}`);
}

async function observeEcos() {
  console.log("=".repeat(78));
  console.log("ECOS — Bank of Korea");
  console.log("=".repeat(78));

  const series = TRACKED_ECOS_SERIES[0];
  const response = await fetchEcosObservations(series, {
    start: "202401",
    end: "202612",
    startIdx: 1,
    endIdx: 1000,
  });
  if ("RESULT" in response) {
    console.log("  the provider returned an error envelope; nothing to observe");
    return;
  }

  const body = response.StatisticSearch;
  const rows = body.row as unknown as Record<string, unknown>[];
  console.log(`\n  envelope keys   ${Object.keys(body).sort().join(", ")}`);
  console.log(`  list_total_count ${body.list_total_count}`);
  const keys = inventory("  ROW FIELD INVENTORY (StatisticSearch.row)", rows);

  console.log("\n  AXIS OBSERVATIONS");
  axis("observation_time", keys.has("TIME"), "TIME names the period a value describes");
  axis(
    "period_start",
    keys.has("START_TIME") || keys.has("PERIOD_START"),
    "no explicit span opening; TIME denotes a period by convention",
  );
  axis("period_end", keys.has("TIME"), "the same field, read as the period it closes");
  axis(
    "source_release_time",
    [...keys].some((k) => /RELEASE|PUBLISH|ANNOUNCE/i.test(k)),
    "when the provider published this value",
  );
  axis(
    "provider_revision_identity",
    [...keys].some((k) => /REVISION|VERSION|SEQ/i.test(k)),
    "an identifier for THIS version of a value",
  );
  axis(
    "provider_vintage_time",
    [...keys].some((k) => /VINTAGE|AS_OF|ASOF/i.test(k)),
    "when this version became current",
  );
  axis(
    "amendment_identity",
    [...keys].some((k) => /AMEND|RESTATE/i.test(k)),
    "whether a record amends an earlier one",
  );
  axis(
    "pagination_evidence",
    typeof body.list_total_count === "number" || typeof body.list_total_count === "string",
    "startIdx/endIdx window plus a provider-stated total",
  );
  axis(
    "total_count_evidence",
    body.list_total_count !== undefined,
    `list_total_count = ${body.list_total_count}, against ${rows.length} rows returned`,
  );
  axis(
    "freshness_semantics",
    [...keys].some((k) => /NEXT|SCHEDULE|DUE/i.test(k)),
    "the provider stating when the next value is due",
  );
  axis(
    "revision_history",
    [...keys].some((k) => /PREV|SUPERSED|HISTORY/i.test(k)),
    "an explicit link to the value this replaced",
  );
  axis(
    "source_provenance",
    keys.has("STAT_CODE") && keys.has("ITEM_CODE1"),
    "enough per record to trace it to a provider artefact",
  );
  axis(
    "schema_version_metadata",
    [...keys].some((k) => /SCHEMA|TAXONOMY|VER/i.test(k)),
    "a version stamp for the response's own shape",
  );
  axis(
    "preliminary_final_identity",
    [...keys].some((k) => /PRELIM|PROVISION|CONFIRM|잠정/i.test(k)),
    "whether a value is marked provisional",
  );

  // The missing-value marker: still the largest documented unknown about this provider, and still
  // unobserved. Reported as an absence of evidence rather than as a settled convention.
  const missing = rows.filter((r) => r.DATA_VALUE === "" || r.DATA_VALUE === null);
  console.log(
    `\n  MISSING-VALUE MARKER: ${missing.length} of ${rows.length} rows carry an empty DATA_VALUE.`,
  );
  if (missing.length === 0) {
    console.log(
      "    Still UNOBSERVED. The convention cannot be established from a window with no gaps.",
    );
  }
}

async function observeDart() {
  console.log("\n" + "=".repeat(78));
  console.log("OpenDART — Financial Supervisory Service");
  console.log("=".repeat(78));

  const body = await fetchDartDisclosures(CORP_CODE, {
    beginDate: "20250101",
    endDate: "20251231",
    pageNo: 1,
    pageCount: 100,
  });
  const envelope = body as unknown as Record<string, unknown>;
  console.log(`\n  envelope keys   ${Object.keys(envelope).sort().join(", ")}`);
  console.log(
    `  total_count ${envelope.total_count} · total_page ${envelope.total_page} · page_no ${envelope.page_no} · page_count ${envelope.page_count}`,
  );

  // Narrowed by presence rather than by the union's tag: fetchDartDisclosures maps the "013"
  // no-data status into an empty list, so a body with no list here means the shape changed.
  const rows = ("list" in body ? (body.list ?? []) : []) as unknown as Record<string, unknown>[];
  const keys = inventory("  ROW FIELD INVENTORY (list[])", rows);

  console.log("\n  AXIS OBSERVATIONS");
  axis("observation_time", keys.has("rcept_dt"), "the date the disclosure was received");
  axis(
    "period_start",
    [...keys].some((k) => /bgn|begin|start/i.test(k)),
    "a filing is an event, not a span",
  );
  axis("period_end", keys.has("rcept_dt"), "the receipt date, read as the instant");
  axis("source_release_time", keys.has("rcept_dt"), "receipt date is the publication date");
  axis(
    "provider_revision_identity",
    keys.has("rcept_no"),
    "the receipt number identifies a filing",
  );
  axis(
    "provider_vintage_time",
    [...keys].some((k) => /vintage|as_of/i.test(k)),
    "when this version became current",
  );
  axis(
    "amendment_identity",
    [...keys].some((k) => /rm|correct|amend/i.test(k)),
    "a remark flag marking corrections",
  );
  axis(
    "pagination_evidence",
    envelope.total_page !== undefined && envelope.page_no !== undefined,
    "page_no / total_page",
  );
  axis(
    "total_count_evidence",
    envelope.total_count !== undefined,
    `total_count = ${envelope.total_count}, against ${rows.length} rows on this page`,
  );
  axis(
    "freshness_semantics",
    [...keys].some((k) => /next|schedule|due/i.test(k)),
    "when the next filing is due",
  );
  axis(
    "revision_history",
    [...keys].some((k) => /prev|supersed|history/i.test(k)),
    "an explicit link to the filing this replaces",
  );
  axis(
    "source_provenance",
    keys.has("rcept_no") && keys.has("corp_code"),
    "receipt number plus corp code reach the source document",
  );
  axis(
    "schema_version_metadata",
    [...keys].some((k) => /schema|version/i.test(k)),
    "a version stamp for the response's shape",
  );
  axis(
    "preliminary_final_identity",
    [...keys].some((k) => /prelim|provision/i.test(k)),
    "whether a filing is marked provisional",
  );

  // The remark field, if present, is the only amendment signal — and it is a string convention.
  const remarks = new Set(rows.map((r) => String(r.rm ?? "")).filter((v) => v.length > 0));
  console.log(
    `\n  REMARK VALUES OBSERVED: ${remarks.size === 0 ? "(none)" : [...remarks].sort().join(", ")}`,
  );
}

async function main() {
  console.log(
    `credential presence: ECOS=${Boolean(process.env.ECOS_API_KEY)} DART=${Boolean(process.env.DART_API_KEY)}\n`,
  );
  await observeEcos();
  await observeDart();
  console.log("\nObservation complete. Every state written into the capability matrix from this");
  console.log("run must cite what was PRESENT or ABSENT above, and nothing else.");
}

main().catch((error: unknown) => {
  // Never the error object: an ECOS failure can carry the key, which travels in the URL path.
  console.error(`observation failed (${(error as Error)?.name ?? "Error"})`);
  process.exitCode = 1;
});
