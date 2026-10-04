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
export const REFRESH_EVERY_MS = 30_000;
/** How long an instance trusts its own memory before re-reading Redis. */
const MEMORY_MS = 5_000;
/** Upstream calls a poll keeps in flight at once. */
const POLL_CONCURRENCY = 12;

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
 * Poll every station once and publish the merged snapshot. New results are
 * laid over the previous snapshot, so a station whose call fails this time
 * keeps its last value (readers judge its age from its own timestamp). Memory
 * is updated as each station lands, so during a cold start this instance's
 * own responses fill in progressively; Redis gets one write at the end.
 */
async function pollUpstream(codes: string[]): Promise<void> {
  const startedAt = Date.now();
  const previous = (cacheEnabled ? await readSnapshot().catch(() => null) : null) ?? memory?.snapshot;
  const arrivals: Record<string, Arrivals> = { ...previous?.arrivals };

  let cursor = 0;
  async function worker() {
    while (cursor < codes.length) {
      const code = codes[cursor++];
      try {
        arrivals[code] = await fetchUpstream(code);
        remember({ arrivals: { ...arrivals }, fetchedAt: previous?.fetchedAt ?? startedAt });
      } catch {
        // keep this station's previous value; the next poll retries it
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POLL_CONCURRENCY, codes.length) }, () => worker()));

  const snapshot: Snapshot = { arrivals, fetchedAt: startedAt };
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
export function pollInBackground(codes: string[]): void {
  let current = polling;
  if (!current) {
    current = polling = (async () => {
      if (await tryClaimRefresh(Math.round(REFRESH_EVERY_MS / 1000))) {
        await pollUpstream(codes);
      }
    })()
      .catch(() => {})
      .finally(() => {
        polling = null;
      });
  }
  after(current);
}
