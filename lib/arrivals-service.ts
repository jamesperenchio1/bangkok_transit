import { after } from "next/server";
import { fetchUpstream, type Arrivals } from "./bts";
import { cacheEnabled, readSnapshot, tryClaimRefresh, writeSnapshot, type Snapshot } from "./arrivals-cache";

/**
 * One poll, shared by everybody.
 *
 *   upstream BTS API --(at most one poll per REFRESH_EVERY_MS, fleet-wide)-->
 *   one Redis snapshot --> /api/arrivals --> CDN --> every user
 *
 * Users never trigger upstream calls of their own. The bulk route only reads
 * the shared snapshot, and the CDN in front of it answers almost every user
 * request (see the route's Cache-Control). When a request that does reach
 * the server finds the snapshot older than REFRESH_EVERY_MS, it tries to take
 * a fleet-wide lock; only the winner polls upstream, in the background, and
 * writes the result back as one document. With nobody using the app, nothing
 * polls at all.
 */

/** How often the shared snapshot is re-polled from upstream, at most. */
export const REFRESH_EVERY_MS = 20_000;
/**
 * A poll is cut off at this point, whatever is still in flight. It must stay
 * below the lock's lifetime (REFRESH_EVERY_MS): that is what guarantees two
 * polls never overlap, so an older poll can never finish last and overwrite
 * a newer snapshot.
 */
const POLL_DEADLINE_MS = 15_000;
/** How long an instance trusts its own memory before re-reading Redis. */
const MEMORY_MS = 5_000;
/** Upstream calls a poll keeps in flight at once. */
const POLL_CONCURRENCY = 16;
/** During a cold start, how often partial results are published to Redis. */
const COLD_START_PUBLISH_MS = 2_000;

let memory: { snapshot: Snapshot; at: number } | null = null;
let polling: Promise<void> | null = null;

function remember(snapshot: Snapshot) {
  memory = { snapshot, at: Date.now() };
}

/**
 * The shared snapshot: module memory if recent, else one Redis GET. Without
 * Redis (local dev) memory is the only tier, kept current by the poll itself.
 */
export async function getSnapshot(): Promise<Snapshot | null> {
  if (memory && (!cacheEnabled || Date.now() - memory.at < MEMORY_MS)) {
    return memory.snapshot;
  }
  const stored = await readSnapshot();
  if (stored) {
    remember(stored);
    return stored;
  }
  return memory?.snapshot ?? null;
}

/**
 * Poll every station once and publish the result as a fresh snapshot. Nothing
 * is carried over from the previous poll: a station whose call fails this
 * time is simply absent (readers never show old times anyway). Normally that
 * is one Redis write at the end; during a cold start - no snapshot yet, so
 * every other instance is serving an empty one - partial results are also
 * published every couple of seconds so users everywhere see stations as
 * they land, not only those routed to this instance.
 */
async function pollUpstream(codes: string[], coldStart: boolean): Promise<void> {
  const fetchedAt = Date.now();
  const deadline = AbortSignal.timeout(POLL_DEADLINE_MS);
  const arrivals: Record<string, Arrivals> = {};
  let lastPublish = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < codes.length && !deadline.aborted) {
      const code = codes[cursor++];
      try {
        arrivals[code] = await fetchUpstream(code, deadline);
      } catch {
        continue; // left out of this snapshot; the next poll retries it
      }
      const partial: Snapshot = { arrivals: { ...arrivals }, fetchedAt };
      remember(partial);
      if (coldStart && Date.now() - lastPublish >= COLD_START_PUBLISH_MS) {
        lastPublish = Date.now();
        await writeSnapshot(partial).catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POLL_CONCURRENCY, codes.length) }, () => worker()));

  const snapshot: Snapshot = { arrivals, fetchedAt };
  remember(snapshot);
  await writeSnapshot(snapshot);
}

/**
 * Starts a shared upstream poll if this instance wins the fleet-wide lock.
 * Never delays the response: the work is registered with `after()`, which
 * keeps it alive on Vercel once the response is sent. It is also started
 * directly because `after()` does not reliably fire under `next dev`; both
 * share one promise, so nothing runs twice.
 */
export function pollInBackground(codes: string[], coldStart: boolean): void {
  let current = polling;
  if (!current) {
    current = polling = (async () => {
      if (await tryClaimRefresh(Math.round(REFRESH_EVERY_MS / 1000))) {
        await pollUpstream(codes, coldStart);
      }
    })()
      .catch(() => {})
      .finally(() => {
        polling = null;
      });
  }
  after(current);
}
