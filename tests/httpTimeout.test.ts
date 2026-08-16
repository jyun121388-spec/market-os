import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, HttpTimeoutError } from "@/server/adapters/httpTimeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves normally when the request finishes before the timeout", async () => {
    const response = new Response("ok", { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    const result = await fetchWithTimeout("https://example.test/fast", undefined, 1000);
    expect(result).toBe(response);
  });

  it("P1: throws a distinguishable HttpTimeoutError instead of hanging when the request stalls past the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            err.name = "TimeoutError";
            reject(err);
          });
        });
      }),
    );

    await expect(fetchWithTimeout("https://example.test/slow", undefined, 20)).rejects.toThrow(
      HttpTimeoutError,
    );
  });

  it("propagates a non-timeout error unchanged", async () => {
    const networkError = new Error("network down");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw networkError;
      }),
    );

    await expect(fetchWithTimeout("https://example.test/broken")).rejects.toBe(networkError);
  });
});
