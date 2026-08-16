import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { redactSecrets, REDACTED } from "@/server/adapters/redactSecrets";

/**
 * Credential redaction for anything that might be logged, stored, or rendered.
 *
 * The concrete hazard, found on 2026-08-17: `HttpTimeoutError` embeds the request URL in its
 * message, provider credentials live in those URLs, and ingest-run errors are now persisted to
 * `ingest_runs.error` and rendered on the authenticated /admin page. Without this, a single
 * upstream timeout would have written an API key into the database.
 */
describe("redactSecrets", () => {
  const original = {
    FRED_API_KEY: process.env.FRED_API_KEY,
    ECOS_API_KEY: process.env.ECOS_API_KEY,
    DART_API_KEY: process.env.DART_API_KEY,
  };

  beforeEach(() => {
    process.env.FRED_API_KEY = "fredsecretkey1234567890";
    process.env.ECOS_API_KEY = "ecossecretkey1234567890";
    process.env.DART_API_KEY = "dartsecretkey1234567890";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("redacts an ECOS key embedded in a URL path segment", () => {
    // ECOS is the awkward one: the key is a path segment, so query-parameter redaction alone
    // would miss it entirely.
    const url =
      "https://ecos.bok.or.kr/api/StatisticSearch/ecossecretkey1234567890/json/kr/1/1000/722Y001/M/200001/202612/0101000";
    const out = redactSecrets(`Request to ${url} timed out after 30000ms`);

    expect(out).not.toContain("ecossecretkey1234567890");
    expect(out).toContain(REDACTED);
    // The rest of the URL is diagnostic and must survive, or the error stops being useful.
    expect(out).toContain("722Y001");
    expect(out).toContain("timed out after 30000ms");
  });

  it("redacts a FRED key in a query parameter", () => {
    const out = redactSecrets(
      "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=fredsecretkey1234567890&file_type=json",
    );
    expect(out).not.toContain("fredsecretkey1234567890");
    expect(out).toContain("series_id=DGS10");
    expect(out).toContain("file_type=json");
  });

  it("redacts an OpenDART key in its crtfc_key parameter", () => {
    const out = redactSecrets(
      "https://opendart.fss.or.kr/api/list.json?crtfc_key=dartsecretkey1234567890&corp_code=00126380",
    );
    expect(out).not.toContain("dartsecretkey1234567890");
    expect(out).toContain("corp_code=00126380");
  });

  it("redacts a credential-shaped query parameter even when it is not a configured key", () => {
    // Second layer: a stale value, or a second account's key, still should not be stored.
    const out = redactSecrets("https://example.com/x?api_key=some-other-key-entirely&z=1");
    expect(out).not.toContain("some-other-key-entirely");
    expect(out).toContain("z=1");
  });

  it("leaves text alone when no credential is present", () => {
    const clean = "SEC EDGAR request failed for CIK 320193: 503 Service Unavailable";
    expect(redactSecrets(clean)).toBe(clean);
  });

  it("does not turn every string into redaction soup when a key is implausibly short", () => {
    // A one- or two-character value would otherwise match all over the place, destroying the
    // diagnostic value of every message.
    process.env.FRED_API_KEY = "ab";
    const text = "a stable and readable error about DGS10";
    expect(redactSecrets(text)).toBe(text);
  });
});
