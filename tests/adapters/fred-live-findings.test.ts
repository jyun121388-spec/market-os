import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFredObservations } from "@/server/adapters/fred/client";
import { normalizeFredObservations } from "@/server/adapters/fred/normalize";
import { TRACKED_FRED_SERIES } from "@/server/adapters/fred/types";
import fixture from "@/server/adapters/fred/__fixtures__/dgs10.json";
import type { FredObservationsResponse } from "@/server/adapters/fred/types";

/**
 * Regression controls for what the FIRST live contact with FRED taught (HG-002, 2026-09-06).
 *
 * The 46-check live run found zero schema drift, so there was no parser to repair. What it did
 * find were two semantics the documentation would not have given and the code must not forget:
 *
 *   1. `realtime_start` / `realtime_end` under DEFAULT parameters are the query date on every row
 *      (one distinct value across 954 CPIAUCSL rows, including 1947-01-01). Revision history is
 *      real — 2023-01-01 CPI carries four vintages — but only when the realtime range is sent.
 *      The client now passes that range through; these controls pin that it is sent exactly when
 *      asked for and never otherwise, because a default request that accidentally carried the
 *      range would return several rows per date into an ingest that expects one.
 *
 *   2. `units` on the response is the TRANSFORMATION code ("lin" = levels), not a measurement
 *      unit. The stored `Series.unit` ("percent", "index") comes from TRACKED_FRED_SERIES and the
 *      normalizer never reads `units`. A future "improvement" that mapped `units` into
 *      `Series.unit` would record every FRED series as measured in "lin".
 *
 * DB-free and network-free: the client's URL is the observable, the fixture is the real shape.
 */

const response = fixture as FredObservationsResponse;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FRED_API_KEY;
});

/** Captures the URL the client builds and answers with the fixture. */
function captureUrl(): { urls: URL[] } {
  process.env.FRED_API_KEY = "test-key";
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify(response), { status: 200 });
    }),
  );
  return { urls };
}

describe("the realtime range is sent exactly when asked for", () => {
  it("omits both realtime parameters on a default request, so one vintage per date comes back", async () => {
    const { urls } = captureUrl();
    await fetchFredObservations("DGS10", { limit: 1000, offset: 0 });
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.has("realtime_start")).toBe(false);
    expect(urls[0].searchParams.has("realtime_end")).toBe(false);
  });

  it("passes the range through verbatim when given", async () => {
    const { urls } = captureUrl();
    await fetchFredObservations("CPIAUCSL", {
      observationStart: "2023-01-01",
      realtimeStart: "1776-07-04",
      realtimeEnd: "9999-12-31",
    });
    const q = urls[0].searchParams;
    expect(q.get("observation_start")).toBe("2023-01-01");
    expect(q.get("realtime_start")).toBe("1776-07-04");
    expect(q.get("realtime_end")).toBe("9999-12-31");
  });

  it("never lets the key into the URL string it logs or throws (unchanged by the new parameters)", async () => {
    const { urls } = captureUrl();
    await fetchFredObservations("DGS10", { realtimeStart: "1776-07-04" });
    // The key is a query parameter by FRED's design; the assertion is that nothing else in the
    // request carries it, so a redacted URL is a safe URL.
    const withoutKey = new URL(urls[0].toString());
    withoutKey.searchParams.delete("api_key");
    expect(withoutKey.toString()).not.toContain("test-key");
  });
});

describe("FRED's `units` is a transformation code, not a measurement unit", () => {
  it("the real fixture says lin while the declared unit says percent, and both are right", () => {
    expect(response.units).toBe("lin");
    const declared = TRACKED_FRED_SERIES.find((s) => s.seriesId === "DGS10");
    expect(declared?.unit).toBe("percent");
  });

  it("the normalizer does not read units at all, so no value or unit can be derived from it", () => {
    const withNonsense = { ...response, units: "not-a-real-transformation" };
    const a = normalizeFredObservations(response);
    const b = normalizeFredObservations(withNonsense);
    expect(b.observations.map((o) => o.value)).toEqual(a.observations.map((o) => o.value));
    expect(b.skippedMissing).toHaveLength(a.skippedMissing.length);
  });
});

/**
 * IR-130: the release date is stored only when the shape that gives one was actually requested.
 *
 * The HG-002 finding above is the whole reason this needs a control rather than a default. Under
 * the default query `realtime_start` is the day the request was made — 954 CPIAUCSL rows reaching
 * back to 1947 all carried 2026-09-06 — so a normalizer that mapped it into `releaseDate`
 * unconditionally would stamp seventy years of observations with today and call it provenance.
 * The realtime range gives a genuine per-vintage boundary. Same field, two meanings, decided by
 * how it was asked for, so only the caller who asked may say.
 */
describe("realtime_start becomes a release date only under the range that makes it one", () => {
  const response = fixture as unknown as FredObservationsResponse;

  it("stores no release date by default, which is what every existing caller gets", () => {
    const { observations } = normalizeFredObservations(response);
    expect(observations.length).toBeGreaterThan(0);
    for (const obs of observations) expect(obs.releaseDate).toBeNull();
  });

  it("stores one per row when the caller declares the response vintage-aware", () => {
    const { observations } = normalizeFredObservations(response, { vintageAware: true });
    for (const obs of observations) {
      expect(obs.releaseDate).toBeInstanceOf(Date);
      // The row's own realtime_start, parsed as UTC like every other date in this adapter — not
      // the retrieval clock, which is the substitution IR-021 was about.
      expect(obs.releaseDate!.toISOString().slice(0, 10)).toBe(obs.raw.realtime_start);
    }
  });

  it("is explicit rather than inferred, so a default response can never acquire one by accident", () => {
    // `vintageAware: false` and an omitted option must be the same thing. If a future edit tries to
    // detect the range from the payload instead, this is what should stop it: the default response
    // is indistinguishable from a single-vintage range response, which is exactly why detection
    // cannot work and the caller has to declare it.
    const declaredOff = normalizeFredObservations(response, { vintageAware: false });
    const omitted = normalizeFredObservations(response);
    expect(declaredOff.observations.map((o) => o.releaseDate)).toEqual(
      omitted.observations.map((o) => o.releaseDate),
    );
  });
});
