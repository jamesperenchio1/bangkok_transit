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
