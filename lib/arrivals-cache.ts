import { Redis } from "@upstash/redis";
import type { Arrivals } from "./bts";

/**
 * Standalone Upstash account (not the Vercel Marketplace integration, to
 * keep billing off Vercel). If env vars are missing, caching is a no-op —
 * the app still works, just always pays the upstream cost.
 */
const redis =
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
