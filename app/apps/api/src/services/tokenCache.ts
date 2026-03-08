interface CacheEntry {
  user: Record<string, unknown>;
  cachedAt: number;
  validAfter: number; // tokens issued before this timestamp (seconds) are rejected
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

class TokenCache {
  private cache = new Map<number, CacheEntry>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(userId: number, tokenIssuedAt?: number): Record<string, unknown> | null {
    const entry = this.cache.get(userId);
    if (!entry) return null;

    // TTL expired — force a fresh DB lookup
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(userId);
      return null;
    }

    // Token was issued before invalidation — reject
    if (tokenIssuedAt !== undefined && tokenIssuedAt < entry.validAfter) {
      return null;
    }

    return entry.user;
  }

  set(userId: number, user: Record<string, unknown>): void {
    const existing = this.cache.get(userId);
    this.cache.set(userId, {
      user,
      cachedAt: Date.now(),
      // Preserve validAfter if entry already exists (e.g. re-cached after TTL expiry)
      validAfter: existing?.validAfter ?? 0,
    });
  }

  invalidate(userId: number): void {
    const existing = this.cache.get(userId);
    if (existing) {
      existing.validAfter = Math.floor(Date.now() / 1000);
      existing.cachedAt = Date.now(); // reset TTL so this entry persists
    } else {
      // Create a tombstone entry so the invalidation is effective even
      // before the user's next DB-lookup-and-cache cycle
      this.cache.set(userId, {
        user: {},
        cachedAt: Date.now(),
        validAfter: Math.floor(Date.now() / 1000),
      });
    }
  }

  clear(userId: number): void {
    this.cache.delete(userId);
  }
}

export const tokenCache = new TokenCache();
