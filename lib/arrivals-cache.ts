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
const SNAPSHOT_VERSION_KEY = "bts:snapshot:version";
const SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Stores the snapshot only if its version is newer than the one already
 * stored, atomically (one Redis command). Nothing about timing then decides
 * which write wins: a slow write from an older poll, or a partial cold-start
 * write that lands after a fuller one, is simply refused.
 */
const WRITE_IF_NEWER = `
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if current >= tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1
`;

export async function readSnapshot(): Promise<Snapshot | null> {
  if (!redis) return null;
  const value = await redis.get<Snapshot>(SNAPSHOT_KEY);
  return value && typeof value === "object" && value.arrivals && typeof value.fetchedAt === "number"
    ? value
    : null;
}

/**
 * `seq` orders writes within one poll (progressive cold-start writes, then
 * the final one); polls are ordered by `fetchedAt`. Keep seq below 100.
 */
export async function writeSnapshot(snapshot: Snapshot, seq: number): Promise<void> {
  if (!redis) return;
  const version = snapshot.fetchedAt * 100 + seq;
  await redis.eval(
    WRITE_IF_NEWER,
    [SNAPSHOT_KEY, SNAPSHOT_VERSION_KEY],
    [JSON.stringify(snapshot), String(version), String(SNAPSHOT_TTL_SECONDS)],
  );
}

const REFRESH_LOCK_KEY = "bts:refresh-lock";

/**
 * Claims the right to poll upstream for the next `seconds`, across every
 * serverless instance - this lock is what makes "one poll for everybody"
 * true fleet-wide rather than per instance. Always succeeds when Redis
 * isn't configured (a single dev process has nobody to coordinate with).
 * If Redis errors it fails open, so an Upstash blip doesn't stop arrivals
 * entirely; overlapping polls are then possible for that moment; writeSnapshot's
 * version check keeps the newest snapshot regardless.
 */
export async function tryClaimRefresh(seconds: number): Promise<boolean> {
  if (!redis) return true;
  try {
    return (await redis.set(REFRESH_LOCK_KEY, Date.now(), { nx: true, ex: seconds })) === "OK";
  } catch {
    return true;
  }
}
