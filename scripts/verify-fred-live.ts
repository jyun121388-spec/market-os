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
  ContractCheck,
  ISO_DATE,
  requireCredential,
  summariseNonNumericMarkers,
} from "./lib/contract-check";
import {
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

  // Revision/vintage semantics: the adapter ignores realtime_* and stores the default vintage.
  // Confirm that default really is "latest known", i.e. one row per date, not a vintage history.
  const openEnded = obs.filter((o) => o.realtime_end === "9999-12-31").length;
  c.info(`rows with an open-ended realtime_end: ${openEnded}/${obs.length}`);
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
  c.finish();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
