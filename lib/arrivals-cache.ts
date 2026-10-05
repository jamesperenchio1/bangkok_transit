import { Redis } from "@upstash/redis";
import type { Arrivals } from "./bts";

/**
 * Standalone Upstash account (not the Vercel Marketplace integration, to
 * keep billing off Vercel). If env vars are missing, caching is a no-op —
 * the app still works, with module memory as its only cache tier.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

export const cacheEnabled = redis !== null;

/**
 * Every live station's arrivals as one document, written by whichever single
 * instance ran the latest upstream poll and read by everyone else. One key
 * means one Redis command per read and per write, however many stations.
 */
export interface Snapshot {
  arrivals: Record<string, Arrivals>;
  /** When the poll that produced this snapshot started (epoch ms). */
  fetchedAt: number;
  /** True while a cold-start poll is still publishing results as they land. */
  partial?: boolean;
}

const SNAPSHOT_KEY = "bts:snapshot";
const SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;

export async function readSnapshot(): Promise<Snapshot | null> {
  if (!redis) return null;
  const value = await redis.get<Snapshot>(SNAPSHOT_KEY);
  return value && typeof value === "object" && value.arrivals && typeof value.fetchedAt === "number"
    ? value
    : null;
}

export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  if (!redis) return;
  await redis.set(SNAPSHOT_KEY, snapshot, { ex: SNAPSHOT_TTL_SECONDS });
}

const REFRESH_LOCK_KEY = "bts:refresh-lock";

/**
 * Claims the right to poll upstream for the next `seconds`, across every
 * serverless instance - this lock is what makes "one poll for everybody"
 * true fleet-wide rather than per instance. Always succeeds when Redis
 * isn't configured (a single dev process has nobody to coordinate with).
 * If Redis errors it fails open, so an Upstash blip doesn't stop arrivals
 * entirely; overlapping polls are then possible for that moment, which is
 * why polls never publish partial results unless they know the shared
 * snapshot is genuinely empty (see pollInBackground's `coldStart`).
 */
export async function tryClaimRefresh(seconds: number): Promise<boolean> {
  if (!redis) return true;
  try {
    return (await redis.set(REFRESH_LOCK_KEY, Date.now(), { nx: true, ex: seconds })) === "OK";
  } catch {
    return true;
  }
}
