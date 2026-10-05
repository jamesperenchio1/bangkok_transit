import { DurableObject } from "cloudflare:workers";
import { fetchUpstream, type Arrivals } from "../../../lib/bts";
import { buildArrivalsDocument, mergeArrivals, type ArrivalsDocument } from "../../../lib/arrivals-document";
import { liveStations } from "../../../data/stations";

/**
 * One poll of the BTS arrivals API, shared by every user, published as one
 * file that Cloudflare's CDN serves to everybody:
 *
 *   cron (1/min, watchdog) -> ArrivalsPoller DO -- alarm every 10s -->
 *   upstream (half the stations) -> R2 arrivals.json -> CDN -> every client
 *
 * There is exactly one ArrivalsPoller instance worldwide, so "one poller"
 * holds by construction - no lock. User traffic only ever hits the CDN copy
 * of arrivals.json (live.<domain>), never this Worker, so nothing here grows
 * with the number of users.
 *
 * Free-plan fit: an invocation may make at most 50 outside fetches, 6 at a
 * time. So each alarm polls half of the ~61 stations and they alternate -
 * every station is refreshed every 2 x ACTIVE_INTERVAL_MS = 20s.
 */

const OBJECT_NAME = "bts";
const DOCUMENT_KEY = "arrivals.json";

/** Alarm cadence while trains run (each alarm = half the stations). */
const ACTIVE_INTERVAL_MS = 10_000;
/** Overnight the only news is "Not running - next ~05:15"; check rarely. */
const QUIET_INTERVAL_MS = 5 * 60_000;
/**
 * BTS runs roughly 05:15-00:30 Bangkok time; poll fast with margin either
 * side (minutes after local midnight).
 */
const QUIET_START_MIN = 1 * 60 + 15;
const QUIET_END_MIN = 4 * 60 + 45;
/** Simultaneous open connections a Worker invocation may hold. */
const CONCURRENCY = 6;

// Interleaved, so each half covers both lines and both ends of them.
const CODES = liveStations.map((s) => s.code);
const HALVES = [CODES.filter((_, i) => i % 2 === 0), CODES.filter((_, i) => i % 2 === 1)];

function intervalAt(now: number): number {
  const bangkokMinutes = (new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes() + 7 * 60) % (24 * 60);
  return bangkokMinutes >= QUIET_START_MIN && bangkokMinutes < QUIET_END_MIN ? QUIET_INTERVAL_MS : ACTIVE_INTERVAL_MS;
}

export class ArrivalsPoller extends DurableObject<Env> {
  /** Latest readings, kept in memory; reloaded from the published file after an eviction. */
  private arrivals: Record<string, Arrivals> | null = null;
  private nextHalf = 0;
  /** Halves polled since this instance loaded: the document is "complete" once both have. */
  private polledHalves = new Set<number>();

  /** Called by the cron every minute: restarts the alarm chain if it ever stopped. */
  async ensureRunning(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  async alarm(): Promise<void> {
    const started = Date.now();
    try {
      await this.pollHalf();
    } catch (err) {
      // Logged, not rethrown: a thrown alarm is retried by the runtime on
      // top of the next one scheduled below.
      console.error("poll failed", err);
    }
    // Re-armed even when a poll fails, so one bad cycle never stops the chain.
    await this.ctx.storage.setAlarm(started + intervalAt(started));
  }

  private async previous(): Promise<Record<string, Arrivals>> {
    if (this.arrivals) return this.arrivals;
    try {
      const stored = await this.env.LIVE.get(DOCUMENT_KEY);
      const doc = stored ? await stored.json<ArrivalsDocument>() : null;
      return doc?.arrivals ?? {};
    } catch {
      return {};
    }
  }

  private async pollHalf(): Promise<void> {
    const half = this.nextHalf;
    this.nextHalf = (half + 1) % HALVES.length;
    const codes = HALVES[half];

    const fresh: Record<string, Arrivals> = {};
    let cursor = 0;
    const worker = async () => {
      while (cursor < codes.length) {
        const code = codes[cursor++];
        try {
          fresh[code] = await fetchUpstream(code);
        } catch {
          // Keeps its previous reading (shown with its age); retried next cycle.
        }
      }
    };
    const [previous] = await Promise.all([
      this.previous(),
      ...Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker),
    ]);

    const now = Date.now();
    this.arrivals = mergeArrivals(previous, fresh, now);
    this.polledHalves.add(half);
    const { document, cacheControl } = buildArrivalsDocument(
      this.arrivals,
      CODES,
      this.polledHalves.size === HALVES.length,
      now,
    );
    await this.env.LIVE.put(DOCUMENT_KEY, JSON.stringify(document), {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl },
    });
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    // locationHint only matters when the object is first created: put it
    // near Bangkok, where both the upstream API and the riders are.
    const stub = env.POLLER.get(env.POLLER.idFromName(OBJECT_NAME), { locationHint: "apac" });
    ctx.waitUntil(stub.ensureRunning());
  },
} satisfies ExportedHandler<Env>;
