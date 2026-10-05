import { after } from "next/server";
import { fetchUpstream, isFresh, type Arrivals } from "./bts";
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
 * A poll is cut off at this point, whatever is still in flight. It stays
 * below the lock's lifetime (REFRESH_EVERY_MS) so polls normally don't
 * overlap; if they ever do (a slow Redis write, a Redis blip that fails the
 * lock open), writeSnapshot's version check still stops an older poll from
 * overwriting a newer snapshot.
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
 * Poll every station once and publish the result. A station whose call fails
 * (or is cut off by the deadline) keeps its entry from the previous snapshot
 * only while that entry is still fresh, so one dropped call doesn't blank a
 * station - but nothing old is ever carried forward. The starting station
 * rotates every poll, so when upstream is slow the deadline doesn't always
 * cut off the same tail of the list.
 *
 * Normally that is one Redis write at the end. During a cold start - nothing
 * fresh anywhere, so every instance is serving an empty snapshot - partial
 * results are also published every couple of seconds (marked `partial`) so
 * users everywhere see stations as they land.
 */
async function pollUpstream(codes: string[], coldStart: boolean): Promise<void> {
  const fetchedAt = Date.now();
  const deadline = AbortSignal.timeout(POLL_DEADLINE_MS);

  // The previous shared snapshot, to carry still-fresh entries over from.
  // Normally the request that triggered this poll just read it into memory.
  // If memory isn't current and Redis can't be read either, this poll can't
  // see what everyone is being served, so it must not publish over it: a
  // station that fails this time would vanish for everybody even though the
  // shared snapshot still had a fresh reading. It then only updates this
  // instance's own memory.
  let previous: Snapshot | null = null;
  let canPublish = true;
  if (memory && (!cacheEnabled || Date.now() - memory.at < MEMORY_MS)) {
    previous = memory.snapshot;
  } else {
    try {
      previous = await readSnapshot();
    } catch {
      previous = memory?.snapshot ?? null;
      canPublish = false;
    }
  }

  const arrivals: Record<string, Arrivals> = {};
  for (const [code, data] of Object.entries(previous?.arrivals ?? {})) {
    if (isFresh(data.timestamp)) arrivals[code] = data;
  }

  const start = Math.floor(Math.random() * codes.length);
  const order = [...codes.slice(start), ...codes.slice(0, start)];
  let lastPublish = 0;
  // Orders this poll's own writes (see writeSnapshot): ~8 progressive writes
  // at most within the deadline, then the final one.
  let seq = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < order.length && !deadline.aborted) {
      const code = order[cursor++];
      try {
        arrivals[code] = await fetchUpstream(code, deadline);
      } catch {
        continue; // keeps a still-fresh previous entry, if any; next poll retries
      }
      if (coldStart && canPublish) {
        const partial: Snapshot = { arrivals: { ...arrivals }, fetchedAt, partial: true };
        remember(partial);
        if (Date.now() - lastPublish >= COLD_START_PUBLISH_MS) {
          lastPublish = Date.now();
          await writeSnapshot(partial, ++seq).catch(() => {});
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POLL_CONCURRENCY, order.length) }, () => worker()));

  const snapshot: Snapshot = { arrivals, fetchedAt };
  remember(snapshot);
  if (canPublish) await writeSnapshot(snapshot, 99);
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
