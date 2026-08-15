// Sliding-window rate limiter ([2026] VJS-CC-WAYMARK 1 D9).
// In-memory: single-node dev/prod posture; swap for a shared store if the
// deployment ever fans out — the interface stays.

interface Window {
  hits: number[];
}

const buckets = new Map<string, Window>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const w = buckets.get(key) ?? { hits: [] };
  w.hits = w.hits.filter((t) => now - t < windowMs);
  if (w.hits.length >= limit) {
    buckets.set(key, w);
    const retryAfterSec = Math.ceil((w.hits[0]! + windowMs - now) / 1000);
    return { ok: false, retryAfterSec };
  }
  w.hits.push(now);
  buckets.set(key, w);
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
