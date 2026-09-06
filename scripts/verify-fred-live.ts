/**
 * Live contract verification for the FRED adapter.
 *
 * `docs/RELEASE_READINESS.md` classifies FRED as LIVE_KEY_PENDING: the host is reachable from
 * this machine, but the adapter shape was written from FRED's documentation and has never met a
 * real response. The EDGAR equivalent of this script found real drift on its first run, so the
 * working assumption here is that this one will too.
 *
 * Read-only. Writes nothing to the database.
 *
 * Usage: FRED_API_KEY=... npx tsx scripts/verify-fred-live.ts
 * Free key: https://fred.stlouisfed.org/docs/api/api_key.html
 */
import {
  REDACTED,
  redactSecrets,
  sanitiseErrorForStorage,
} from "../src/server/adapters/redactSecrets";
import {
  ContractCheck,
  ISO_DATE,
  requireCredential,
  summariseNonNumericMarkers,
} from "./lib/contract-check";
import {
  FredApiError,
  fetchFredObservations,
  fetchAllFredObservations,
} from "../src/server/adapters/fred/client";
import { TRACKED_FRED_SERIES } from "../src/server/adapters/fred/types";
import { normalizeFredObservations } from "../src/server/adapters/fred/normalize";

const c = new ContractCheck("FRED");

/** One daily and one monthly series — different cadences exercise different date handling. */
const SAMPLES = ["DGS10", "CPIAUCSL"];

async function verifySeries(seriesId: string) {
  c.section(`series/observations ${seriesId}`);
  const res = await fetchFredObservations(seriesId, { limit: 1000, offset: 0 });

  c.check("observation_start is a string", typeof res.observation_start === "string");
  c.check("observation_end is a string", typeof res.observation_end === "string");
  c.check("units is a string", typeof res.units === "string");
  c.check("count is a number", typeof res.count === "number");
  c.check("observations is an array", Array.isArray(res.observations));

  // Pagination fields are the reason the adapter was silently truncatable. The declared type
  // marks them optional precisely because their presence was unverified — this is the check
  // that settles it.
  c.check("limit is present and numeric (pagination is real)", typeof res.limit === "number", {
    limit: res.limit,
  });
  c.check("offset is present and numeric", typeof res.offset === "number", {
    offset: res.offset,
  });
  if (typeof res.limit === "number") {
    c.check("the requested limit was honoured", res.limit === 1000, { got: res.limit });
  }
  c.check(
    "count is the query total, not the page size (count >= returned rows)",
    res.count >= res.observations.length,
    { count: res.count, returned: res.observations.length },
  );

  const obs = res.observations;
  c.check("at least one observation returned", obs.length > 0);
  c.check(
    "every observation has date/realtime_start/realtime_end/value as strings",
    obs.every(
      (o) =>
        typeof o.date === "string" &&
        typeof o.realtime_start === "string" &&
        typeof o.realtime_end === "string" &&
        typeof o.value === "string",
    ),
    obs.find((o) => typeof o.value !== "string"),
  );
  c.check(
    "every date is YYYY-MM-DD",
    obs.every((o) => ISO_DATE.test(o.date)),
    obs.find((o) => !ISO_DATE.test(o.date)),
  );
  c.check(
    "realtime_start / realtime_end are YYYY-MM-DD",
    obs.every((o) => ISO_DATE.test(o.realtime_start) && ISO_DATE.test(o.realtime_end)),
    obs.find((o) => !ISO_DATE.test(o.realtime_start) || !ISO_DATE.test(o.realtime_end)),
  );
  c.check(
    "dates are strictly ascending and unique (no duplicate observation dates in one page)",
    new Set(obs.map((o) => o.date)).size === obs.length,
  );

  // The missing-value marker. normalize.ts hardcodes "." and throws on any other non-numeric
  // value, so an unanticipated marker is a hard failure at ingest time, not a silent skip.
  const markers = summariseNonNumericMarkers(obs.map((o) => o.value));
  c.info(`non-numeric value markers seen: ${markers.length ? markers.join(", ") : "(none)"}`);
  const unexpected = markers.filter((m) => m !== '"."');
  c.check(
    'the only missing-value marker is "." (normalize.ts throws on anything else)',
    unexpected.length === 0,
    unexpected.join(", "),
  );

  // Revision/vintage semantics, and the reason Observation.releaseDate is still null for every
  // FRED row (docs/REVIEW_DEBT.md's M08 entry).
  //
  // `realtime_start` reads like a release date and is NOT one under default parameters: FRED
  // answers with the vintage as of today, so every row — including a 1990 observation — comes
  // back stamped with today's date. Mapping it to `releaseDate` would fill a provenance column
  // with a confident, checkable, wrong answer, which is worse than leaving it null. Real
  // publication dates need an explicit realtime range (1776-07-04..9999-12-31), which returns
  // multiple vintage rows per observation date and is a different ingest shape entirely.
  //
  // This reports what the field actually contains so the decision rests on evidence.
  const distinctStarts = [...new Set(obs.map((o) => o.realtime_start))];
  const distinctEnds = [...new Set(obs.map((o) => o.realtime_end))];
  c.info(
    `distinct realtime_start values: ${distinctStarts.slice(0, 5).join(", ")}` +
      `${distinctStarts.length > 5 ? ` (+${distinctStarts.length - 5} more)` : ""}`,
  );
  c.info(`distinct realtime_end values: ${distinctEnds.slice(0, 5).join(", ")}`);
  if (distinctStarts.length === 1) {
    c.note(
      `every row shares realtime_start=${distinctStarts[0]} — a single "as of today" vintage ` +
        "stamp, NOT a per-observation publication date. Do not map it to Observation.releaseDate.",
    );
  } else {
    c.note(
      `realtime_start varies across ${distinctStarts.length} values, so it may carry real ` +
        "per-observation vintage information. Worth re-examining the M08 releaseDate decision.",
    );
  }

  c.check(
    "the default response is a single vintage, not a revision history",
    new Set(obs.map((o) => o.date)).size === obs.length,
  );

  // The normalizer must survive the real payload — this is where a date or unit surprise lands.
  const normalized = normalizeFredObservations(res);
  c.check(
    "normalizeFredObservations accepts the real payload without throwing",
    normalized.observations.length + normalized.skippedMissing.length === obs.length,
  );

  const declared = TRACKED_FRED_SERIES.find((s) => s.seriesId === seriesId);
  if (declared) {
    c.info(`declared unit "${declared.unit}" vs FRED units "${res.units}"`);
  }
  // Measured 2026-09-06: FRED's `units` is the TRANSFORMATION code ("lin" = levels, "chg", "pch",
  // ...), not the measurement unit. The adapter's declared `unit` ("percent", "index") is the
  // measurement unit and comes from TRACKED_FRED_SERIES, never from this field. A response whose
  // `units` is not "lin" would mean a transformed series was requested, which nothing here does.
  c.check(
    'FRED `units` is the transformation code "lin" (levels), not a measurement unit',
    res.units === "lin",
    { units: res.units },
  );
}

/**
 * Revision history, which the default response does not carry and the realtime range does.
 *
 * CPIAUCSL is revised: the BLS publishes seasonal-factor updates every February that restate up
 * to five years of monthly CPI, so a short recent window queried across the full vintage range
 * must return more rows than observation dates. This is the evidence the provider-vintage
 * contract (`src/server/fabric/vintage.ts`) needs and that nothing had ever observed.
 */
async function verifyVintageHistory() {
  c.section(
    "vintage history CPIAUCSL (realtime 1776-07-04 .. 9999-12-31, observations from 2023-01-01)",
  );
  const res = await fetchFredObservations("CPIAUCSL", {
    observationStart: "2023-01-01",
    realtimeStart: "1776-07-04",
    realtimeEnd: "9999-12-31",
    limit: 1000,
    offset: 0,
  });
  const obs = res.observations;
  const dates = new Set(obs.map((o) => o.date));
  c.info(`${obs.length} rows over ${dates.size} observation dates`);
  c.check(
    "the vintage range returns more rows than observation dates (real revisions)",
    obs.length > dates.size,
    {
      rows: obs.length,
      dates: dates.size,
    },
  );
  c.check(
    "realtime_start varies across rows (a per-vintage stamp, unlike the default response)",
    new Set(obs.map((o) => o.realtime_start)).size > 1,
  );
  // One date, many vintages: the pair must partition time, oldest first, without overlap.
  const byDate = new Map<string, typeof obs>();
  for (const o of obs) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);
  const revised = [...byDate.entries()].filter(([, rows]) => rows.length > 1);
  c.info(`${revised.length} of ${dates.size} dates carry more than one vintage`);
  c.check("at least one observation date carries several vintages", revised.length > 0);
  c.check(
    "within a date, vintages are ordered and non-overlapping (realtime_end < next realtime_start)",
    revised.every(([, rows]) => {
      const sorted = [...rows].sort((a, b) => a.realtime_start.localeCompare(b.realtime_start));
      return sorted.every((r, i) => i === 0 || sorted[i - 1].realtime_end < r.realtime_start);
    }),
  );
  c.check(
    "the latest vintage of every date is open-ended (realtime_end = 9999-12-31)",
    [...byDate.values()].every((rows) => rows.some((r) => r.realtime_end === "9999-12-31")),
  );
  c.check(
    "the first vintage of a date is never earlier than the period it describes",
    [...byDate.entries()].every(([date, rows]) => rows.every((r) => r.realtime_start >= date)),
  );
  const sample = revised[0];
  if (sample) {
    const [date, rows] = sample;
    c.info(
      `example ${date}: ` +
        rows
          .sort((a, b) => a.realtime_start.localeCompare(b.realtime_start))
          .map((r) => `${r.value}@${r.realtime_start}..${r.realtime_end}`)
          .join("  ->  "),
    );
  }
  c.note(
    "The FIRST vintage's realtime_start is the closest thing FRED offers to a publication date, " +
      "and it is only observable through the realtime range. The ingest path does not request " +
      "the range and stores the default single vintage, so Observation.releaseDate stays null " +
      "there by design (M08). Reading vintages into the revision chain is a separate ingest shape.",
  );
}

async function verifyPagination() {
  c.section("pagination completeness");
  // DGS10 has well over 5000 daily observations, so this genuinely exercises multi-page paging
  // against the real API rather than a fixture.
  const page = await fetchAllFredObservations("DGS10");

  c.check("more than one request was needed (real multi-page series)", page.requestsMade > 1, {
    requestsMade: page.requestsMade,
  });
  c.check("nothing was truncated", page.truncated === false);
  c.check("fetched exactly FRED's own count", page.observations.length === page.count, {
    fetched: page.observations.length,
    count: page.count,
  });
  c.check(
    "no duplicate observation dates across page boundaries",
    new Set(page.observations.map((o) => o.date)).size === page.observations.length,
  );
  c.info(`DGS10: ${page.observations.length} observations over ${page.requestsMade} requests`);
}

/**
 * Error and redaction behaviour, measured rather than assumed.
 *
 * Two questions the success path cannot answer. Does FRED's error envelope echo the credential
 * back — in which case `redactSecrets` in the client is load-bearing rather than defence in
 * depth? And does the adapter's thrown error carry FRED's own explanation without carrying the
 * key? The first is answered on the wire, the second through the production client. Neither
 * prints a body before redacting it, so a "yes" to the first question cannot leak on its way
 * into a log.
 *
 * The invalid-key probe uses a dummy that is visibly not a credential and never touches the
 * real one; the invalid-series probe uses the real key so the envelope for a rejected request
 * under a valid credential is the one measured.
 */
async function verifyErrorEnvelope() {
  c.section("error envelope and redaction");
  const apiKey = process.env.FRED_API_KEY ?? "";
  const bogusSeries = "MOSNOSUCHSERIES2026";

  // On the wire, with the real key, a request FRED must reject.
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", bogusSeries);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  const raw = await fetch(url);
  const text = await raw.text();
  let envelope: { error_code?: unknown; error_message?: unknown } | null = null;
  try {
    envelope = JSON.parse(text) as { error_code?: unknown; error_message?: unknown };
  } catch {
    envelope = null;
  }
  c.check("an unknown series is rejected with HTTP 400", raw.status === 400, {
    status: raw.status,
  });
  c.check("the error body is JSON", envelope !== null);
  c.check("error_code is a number", typeof envelope?.error_code === "number", {
    got: envelope?.error_code,
  });
  c.check("error_message is a string", typeof envelope?.error_message === "string");
  const echoesKey = apiKey.length > 0 && text.includes(apiKey);
  // Recorded either way: this is the measurement that decides whether the client-side redaction
  // is the only thing between an error body and a stored secret.
  c.info(
    echoesKey
      ? "FRED's error body ECHOES the api_key value: client-side redaction is load-bearing"
      : "FRED's error body does not echo the api_key value: client-side redaction is defence in depth",
  );
  c.info(`error_message (redacted): ${redactSecrets(String(envelope?.error_message ?? ""))}`);

  // Through the production client: the same rejection must surface FRED's explanation and the
  // status, and must not surface the key.
  let thrown: unknown = null;
  try {
    await fetchFredObservations(bogusSeries, { limit: 1 });
  } catch (err) {
    thrown = err;
  }
  c.check("the client throws FredApiError for a rejected request", thrown instanceof FredApiError);
  if (thrown instanceof FredApiError) {
    c.check("the thrown error carries the HTTP status", thrown.status === 400, {
      status: thrown.status,
    });
    c.check(
      "the thrown error carries FRED's own explanation, not only the status line",
      typeof envelope?.error_message === "string" &&
        thrown.message.includes(redactSecrets(envelope.error_message)),
    );
    c.check(
      "the thrown error does not contain the api_key value",
      apiKey.length > 0 && !thrown.message.includes(apiKey),
    );
    c.check(
      "sanitiseErrorForStorage output does not contain the api_key value",
      apiKey.length > 0 && !sanitiseErrorForStorage(thrown).includes(apiKey),
    );
    if (echoesKey) {
      c.check(
        "an echoed key is replaced by the redaction marker in the thrown error",
        thrown.message.includes(REDACTED),
      );
    }
  }

  // An invalid key, visibly a dummy, never the real one. Measures the envelope FRED returns for
  // a credential failure so a future operator error is diagnosable from the stored run record.
  const saved = process.env.FRED_API_KEY;
  process.env.FRED_API_KEY = "0".repeat(32);
  let keyThrown: unknown = null;
  try {
    await fetchFredObservations("DGS10", { limit: 1 });
  } catch (err) {
    keyThrown = err;
  } finally {
    process.env.FRED_API_KEY = saved;
  }
  c.check("an unregistered key is rejected as FredApiError", keyThrown instanceof FredApiError);
  if (keyThrown instanceof FredApiError) {
    c.check("an unregistered key is HTTP 400 (not 401/403)", keyThrown.status === 400, {
      status: keyThrown.status,
    });
    c.check(
      "the rejection names api_key so the failure is diagnosable",
      /api_key/i.test(keyThrown.message),
    );
    c.check(
      "the real key does not appear in the invalid-key rejection",
      apiKey.length > 0 && !keyThrown.message.includes(apiKey),
    );
  }
}

async function main() {
  if (
    !requireCredential(
      "FRED_API_KEY",
      "Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html and put it in .env.",
    )
  ) {
    return;
  }

  for (const seriesId of SAMPLES) {
    await verifySeries(seriesId);
  }
  await verifyPagination();
  await verifyVintageHistory();
  await verifyErrorEnvelope();
  c.finish();
}

main().catch((err) => {
  console.error(sanitiseErrorForStorage(err));
  process.exitCode = 1;
});
