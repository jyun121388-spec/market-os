/**
 * Generic TTL-based in-memory cache (M25) for expensive on-demand read paths (e.g.
 * computeSystemHealth, computeRegimeSnapshot). Deliberately process-local, not a shared cache
 * (Redis/etc.) — a shared cache is infrastructure that implies a deployment topology decision
 * (single instance vs. multiple) this project hasn't made yet. See docs/DECISIONS.md.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {
    if (ttlMs <= 0) {
      throw new Error("ttlMs must be positive");
    }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Wraps an async producer with a TTL cache: on a miss/expiry, calls `fn`, caches the result, and
 * returns it. Concurrent calls during a miss are not de-duplicated (no in-flight promise
 * sharing) — acceptable at current traffic; revisit if request-coalescing becomes necessary.
 */
export function withCache<T>(cache: TtlCache<T>, key: string, fn: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  return fn().then((value) => {
    cache.set(key, value);
    return value;
  });
}
