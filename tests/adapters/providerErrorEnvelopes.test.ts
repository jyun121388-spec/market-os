import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFredObservations, FredApiError } from "@/server/adapters/fred/client";
import { fetchEcosObservations, EcosApiError } from "@/server/adapters/ecos/client";
import { fetchDartDisclosures, DartApiError } from "@/server/adapters/dart/client";
import { TRACKED_ECOS_SERIES } from "@/server/adapters/ecos/types";

/**
 * Provider error envelopes, captured from the real APIs.
 *
 * These bodies are not invented. Each was recorded on 2026-08-18 by making one request per
 * provider with a deliberately invalid key — the only part of the success path reachable without
 * a real credential. That matters because the whole SEC lesson was that documentation is not the
 * provider: an error shape guessed from docs is exactly as trustworthy as the success shape that
 * turned out to be wrong about nullability.
 *
 * The most important thing the capture revealed: **ECOS and OpenDART return HTTP 200 for an
 * authentication failure.** A client that only checks `response.ok` would treat a "your key is
 * invalid" body as a successful response and try to parse observations out of it. Both clients
 * do inspect the body, and these tests pin that against the real shapes rather than against
 * shapes someone assumed.
 */

const ECOS_INVALID_KEY_BODY = {
  RESULT: {
    CODE: "INFO-100",
    MESSAGE:
      "인증키가 유효하지 않습니다. 인증키를 확인하십시오! 인증키가 없는 경우 인증키를 신청하십시오!",
  },
};

const DART_INVALID_KEY_BODY = {
  status: "010",
  message: "등록되지 않은 인증키입니다.",
};

const FRED_INVALID_KEY_BODY = {
  error_code: 400,
  error_message:
    "Bad Request.  The value for variable api_key is not registered.  " +
    "Read https://fred.stlouisfed.org/docs/api/api_key.html for more information.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("real provider error envelopes", () => {
  it("ECOS: an auth failure arrives as HTTP 200 and must still be treated as an error", async () => {
    process.env.ECOS_API_KEY = "irrelevant-for-this-test";
    vi.stubGlobal(
      "fetch",
      // HTTP 200 — this is the part a `response.ok` check alone would wave straight through.
      vi.fn(async () => new Response(JSON.stringify(ECOS_INVALID_KEY_BODY), { status: 200 })),
    );

    await expect(
      fetchEcosObservations(TRACKED_ECOS_SERIES[0], { start: "202401", end: "202412" }),
    ).rejects.toBeInstanceOf(EcosApiError);
  });

  it("ECOS: the thrown error carries the provider's own code and message", async () => {
    process.env.ECOS_API_KEY = "irrelevant-for-this-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ECOS_INVALID_KEY_BODY), { status: 200 })),
    );

    await expect(
      fetchEcosObservations(TRACKED_ECOS_SERIES[0], { start: "202401", end: "202412" }),
    ).rejects.toMatchObject({ code: "INFO-100" });
  });

  it("OpenDART: an auth failure also arrives as HTTP 200, with a non-000 status", async () => {
    process.env.DART_API_KEY = "irrelevant-for-this-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(DART_INVALID_KEY_BODY), { status: 200 })),
    );

    await expect(
      fetchDartDisclosures("00126380", { beginDate: "20250101", endDate: "20250131" }),
    ).rejects.toMatchObject({ status: "010" });
  });

  it("OpenDART: status 013 is no-data, NOT an error — the distinction the client branches on", async () => {
    // "010" and "013" differ by one character and mean completely different things. Getting this
    // backwards would either throw on an empty result or silently swallow a real auth failure.
    process.env.DART_API_KEY = "irrelevant-for-this-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "013", message: "조회된 데이타가 없습니다." }), {
            status: 200,
          }),
      ),
    );

    const result = await fetchDartDisclosures("00126380", {
      beginDate: "19900101",
      endDate: "19900102",
    });
    expect(result.status).toBe("000");
    expect("list" in result && result.list).toEqual([]);
  });

  it("FRED: the provider's explanation is surfaced, not discarded", async () => {
    // FRED answers 400 with a structured reason. Throwing on `!response.ok` alone left an
    // operator holding "400 Bad Request" when the provider had already said exactly what was
    // wrong.
    process.env.FRED_API_KEY = "irrelevant-for-this-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(FRED_INVALID_KEY_BODY), {
            status: 400,
            statusText: "Bad Request",
          }),
      ),
    );

    await expect(fetchFredObservations("DGS10")).rejects.toThrow(/api_key is not registered/i);
    await expect(fetchFredObservations("DGS10")).rejects.toBeInstanceOf(FredApiError);
  });

  it("FRED: an unparseable error body degrades to the plain HTTP failure", async () => {
    // Reading the body is best-effort — a non-JSON error page must not turn a clear HTTP
    // failure into a confusing parse error.
    process.env.FRED_API_KEY = "irrelevant-for-this-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>502 Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }),
      ),
    );

    await expect(fetchFredObservations("DGS10")).rejects.toThrow(/502 Bad Gateway/);
  });

  it("FRED: a key echoed back in the provider's message is redacted before it is thrown", async () => {
    process.env.FRED_API_KEY = "fredsecretkey1234567890";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error_code: 400,
              error_message: "api_key fredsecretkey1234567890 is not registered.",
            }),
            { status: 400, statusText: "Bad Request" },
          ),
      ),
    );

    await expect(fetchFredObservations("DGS10")).rejects.toThrow(/\[REDACTED\]/);
    await expect(fetchFredObservations("DGS10")).rejects.not.toThrow(/fredsecretkey1234567890/);
  });
});
