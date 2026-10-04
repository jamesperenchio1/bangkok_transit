import { Redis } from "@upstash/redis";
import type { Arrivals } from "./bts";

/**
 * Standalone Upstash account (not the Vercel Marketplace integration, to
 * keep billing off Vercel). If env vars are missing, caching is a no-op —
 * the app still works, just always pays the upstream cost.
 */
/** Exported so lib/rate-limit.ts can reuse this same Redis instance instead of opening a second connection. */
export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

export const cacheEnabled = redis !== null;

const TTL_SECONDS = 24 * 60 * 60;

function key(code: string) {
  return `bts:arr:${code}`;
}

export async function readCached(code: string): Promise<Arrivals | null> {
  if (!redis) return null;
  return (await redis.get<Arrivals>(key(code))) ?? null;
}

export async function writeCached(code: string, data: Arrivals): Promise<void> {
  if (!redis) return;
  await redis.set(key(code), data, { ex: TTL_SECONDS });
}

/**
 * Writes a whole refresh batch in one MSET. Upstash bills per command, so
 * this is one command per background refresh instead of one per station
 * (~61) - the difference between fitting the free tier and blowing through
 * it in days. MSET can't carry a TTL, which is fine: it's a fixed set of ~61
 * keys overwritten on every refresh, and freshness is judged from each
 * payload's own timestamp, never from key expiry.
 */
export async function writeCachedMany(entries: Record<string, Arrivals>): Promise<void> {
  const codes = Object.keys(entries);
  if (!redis || codes.length === 0) return;
  await redis.mset(Object.fromEntries(codes.map((code) => [key(code), entries[code]])));
}

/** Bulk read for priming the client cache in one round trip instead of one request per station. */
export async function readCachedMany(codes: string[]): Promise<Record<string, Arrivals>> {
  if (!redis || codes.length === 0) return {};
  const keys = codes.map(key);
  const values = await redis.mget<(Arrivals | null)[]>(...keys);
  const out: Record<string, Arrivals> = {};
  values.forEach((v, i) => {
    if (v) out[codes[i]] = v;
  });
  return out;
}

const REFRESH_LOCK_KEY = "bts:refresh-lock";

/**
 * Claims the right to run the background refresh for the next `seconds`,
 * across every serverless instance. Without this each warm instance has its
 * own in-memory view of what's fresh and re-fetches all ~61 stations on its
 * own schedule - N instances, N times the upstream calls and Redis writes.
 * Always succeeds when Redis isn't configured (single dev process).
 */
export async function tryClaimRefresh(seconds: number): Promise<boolean> {
  if (!redis) return true;
  try {
    return (await redis.set(REFRESH_LOCK_KEY, Date.now(), { nx: true, ex: seconds })) === "OK";
  } catch {
    return true;
  }
}
