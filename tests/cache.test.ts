import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache, withCache } from "@/server/domain/cache";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined on a miss", () => {
    const cache = new TtlCache<number>(1000);
    expect(cache.get("a")).toBeUndefined();
  });

  it("returns a cached value before it expires", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 42);
    vi.setSystemTime(999);
    expect(cache.get("a")).toBe(42);
  });

  it("expires a value once its TTL has elapsed", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 42);
    vi.setSystemTime(1000);
    expect(cache.get("a")).toBeUndefined();
  });

  it("keeps separate keys independent", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("clear() removes every entry", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("rejects a non-positive TTL", () => {
    expect(() => new TtlCache<number>(0)).toThrow();
    expect(() => new TtlCache<number>(-1)).toThrow();
  });
});

describe("withCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the producer once on a miss, then serves from cache on a hit", async () => {
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return 7;
    };

    expect(await withCache(cache, "k", fn)).toBe(7);
    expect(await withCache(cache, "k", fn)).toBe(7);
    expect(calls).toBe(1);
  });

  it("calls the producer again after the TTL expires", async () => {
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls;
    };

    expect(await withCache(cache, "k", fn)).toBe(1);
    vi.setSystemTime(1000);
    expect(await withCache(cache, "k", fn)).toBe(2);
  });
});
