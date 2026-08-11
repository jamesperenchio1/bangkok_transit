/**
 * Last-known-good store for live arrivals (server-side only).
 *
 * Why this exists: a CDN cache only stays warm under steady traffic, and module
 * memory dies with every lambda recycle. On a low-traffic site that means almost
 * every station tap would pay the full ~6s upstream fetch. Keeping the last good
 * payload somewhere shared means there is always something to paint immediately.
 *
 * The stored value is not assumed to still be *correct* — 20-second-old ETAs
 * aren't. Freshness is judged from the payload's own `dataAt` (see FRESH_FOR_MS);
 * this store only guarantees there is something to show while the live value
 * arrives.
 *
 * Configured with UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. With either
 * missing, every call here is a no-op so local dev, CI and `next build` work
 * unconfigured — just colder. Redis errors are swallowed for the same reason: a
 * cache outage must degrade latency, never take down the route.
 */
import { Redis } from "@upstash/redis";
import type { Arrivals } from "@/lib/bts";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

export const cacheEnabled = redis !== null;

/**
 * Deliberately far longer than the data stays useful. TTL is not the freshness
 * gate — expiring at ~20s would evict the fallback at exactly the moment it is
 * needed, which is the whole point of having one.
 */
const TTL_SECONDS = 60 * 60 * 24;

const key = (code: string) => `bts:arr:${code.toUpperCase()}`;

export async function readCached(code: string): Promise<Arrivals | null> {
  if (!redis) return null;
  try {
    // Upstash deserialises JSON values on the way out.
    return await redis.get<Arrivals>(key(code));
  } catch (err) {
    console.error("arrivals-cache read failed", err);
    return null;
  }
}

export async function writeCached(code: string, data: Arrivals): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key(code), data, { ex: TTL_SECONDS });
  } catch (err) {
    console.error("arrivals-cache write failed", err);
  }
}
