import { DurableObject } from "cloudflare:workers";
import { deadlineAfter, fetchUpstream, type Arrivals } from "../../../lib/bts";
import {
  buildArrivalsDocument,
  mergeArrivals,
  type ArrivalsDocument,
  type PollReport,
} from "../../../lib/arrivals-document";
import { liveStations } from "../../../data/stations";
import {
  batchSize,
  failureReason,
  initialHealth,
  nextHealth,
  nextIntervalMs,
  stalest,
  DOCUMENT_KEY,
  type Health,
} from "./schedule";

/**
 * One poll of the BTS arrivals API, shared by every user, published as one
 * file that Cloudflare's CDN serves to everybody:
 *
 *   cron (1/min, watchdog) -> ArrivalsPoller DO -- alarm every 10s -->
 *   upstream (the stalest half) -> R2 arrivals.json -> CDN -> every client
 *
 * There is exactly one ArrivalsPoller instance worldwide, so "one poller"
 * holds by construction - no lock. User traffic only ever hits the CDN copy
 * of arrivals.json (live.<domain>), never this Worker, so nothing here grows
 * with the number of users.
 *
 * Free-plan fit: an invocation may make at most 50 outside fetches, 6 at a
 * time. So each alarm polls the BATCH stations whose readings are oldest -
 * normally the other half from last time, so every station refreshes about
 * every 2 x ACTIVE_INTERVAL_MS = 20s. A station whose call failed (or didn't
 * fit before the deadline) is simply oldest next time, so it is retried
 * first instead of waiting on a fixed half that keeps failing the same way.
 *
 * When whole cycles fail (the upstream is down), it backs off to probing a
 * few stations on a growing interval, publishes `status.state = "down"` with
 * an outage history, and stops rewriting a document that isn't changing.
 * Scheduling decisions live in ./schedule.ts.
 *
 * Only the Durable Object class and the default handler may be exported from
 * this module: workerd treats every named export of the entry point as an
 * entrypoint and refuses to start if one isn't a class or handler object.
 */

const OBJECT_NAME = "bts";
const HEALTH_KEY = "health";

/** Simultaneous open connections a Worker invocation may hold. */
const CONCURRENCY = 6;
/**
 * One slow batch mustn't push the alarm past its slot: no new upstream call
 * starts after START_BUDGET_MS, and calls still running at ALARM_BUDGET_MS
 * are abandoned. Whatever didn't fit is polled first next time.
 */
const START_BUDGET_MS = 6_500;
const ALARM_BUDGET_MS = 9_500;

const CODES = liveStations.map((s) => s.code);

export class ArrivalsPoller extends DurableObject<Env> {
  /** Latest readings, kept in memory; reloaded from the published file after an eviction. */
  private arrivals: Record<string, Arrivals> | null = null;
  /** Upstream health; persisted so an eviction doesn't reset the backoff or the outage history. */
  private health: Health | null = null;
  /** The last body written to R2 (minus poll timings), to skip identical writes. */
  private lastWritten: string | null = null;
  /**
   * Codes tried since this instance loaded: the document is "complete" once
   * every code has had a turn - not once every one has answered, so a
   * station upstream never answers for can't keep every client fast-polling.
   * (Codes already holding a reading in the published file also count - see
   * poll() - so an eviction doesn't make the document look unfinished.)
   */
  private tried = new Set<string>();

  /** Called by the cron every minute: restarts the alarm chain if it ever stopped. */
  async ensureRunning(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  async alarm(): Promise<void> {
    const started = Date.now();
    try {
      await this.poll();
    } catch (err) {
      // Logged, not rethrown: a thrown alarm is retried by the runtime on
      // top of the next one scheduled below.
      console.error("poll failed", err);
    }
    // Re-armed even when a poll fails, so one bad cycle never stops the chain.
    const health = this.health ?? initialHealth(started);
    await this.ctx.storage.setAlarm(started + nextIntervalMs(started, health));
  }

  private async loadHealth(now: number): Promise<Health> {
    if (!this.health) this.health = (await this.ctx.storage.get<Health>(HEALTH_KEY)) ?? initialHealth(now);
    return this.health;
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

  private async poll(): Promise<void> {
    const startedAt = Date.now();
    const health = await this.loadHealth(startedAt);
    const previous = await this.previous();
    const codes = stalest(CODES, previous, startedAt, batchSize(health));
    const budget = deadlineAfter(ALARM_BUDGET_MS);
    const deadline = budget.signal;

    const fresh: Record<string, Arrivals> = {};
    const failed: Record<string, string> = {};
    let cursor = 0;
    // Upstream rate-limits (429). Once it says so, stop sending more this
    // cycle rather than hammering it: whatever is left is stalest next time.
    let throttled = false;
    const worker = async () => {
      while (cursor < codes.length && !throttled && Date.now() - startedAt < START_BUDGET_MS) {
        const code = codes[cursor++];
        try {
          fresh[code] = await fetchUpstream(code, deadline);
        } catch (err) {
          // Keeps its previous reading (shown with its age); it is among the
          // stalest next cycle, so it is retried first.
          failed[code] = failureReason(err, deadline);
          if (failed[code] === "429") throttled = true;
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker));
    } finally {
      budget.clear();
    }
    const attempted = codes.slice(0, cursor);
    for (const code of attempted) this.tried.add(code);
    for (const code of codes.slice(cursor)) failed[code] = "skipped";

    const now = Date.now();
    const ok = Object.keys(fresh).length;
    this.health = nextHealth(health, attempted.length, ok, now);
    // Persisted only when something other than lastSuccessAt changed: a
    // storage write per alarm would be ~8,600 rows a day for nothing.
    if (durable(this.health) !== durable(health)) await this.ctx.storage.put(HEALTH_KEY, this.health);
    if (this.health.status.state !== health.status.state) {
      console.log(`upstream ${health.status.state} -> ${this.health.status.state}`);
    }

    this.arrivals = mergeArrivals(previous, fresh, now);
    const report: PollReport = {
      at: new Date(now).toISOString(),
      ms: now - startedAt,
      polled: codes.length,
      ok,
      failed,
    };
    if (Object.keys(failed).length > 0) console.warn("upstream failures", report);
    // A code with a reading already in hand has had its turn, even if this
    // instance was just (re)created. Without this, an eviction would drop
    // the document back to "filling" (2 s edge cache, clients fast-polling)
    // until two alarms had passed - extra origin reads for every user.
    const covered = (code: string) => this.tried.has(code) || code in this.arrivals!;
    const { document, cacheControl } = buildArrivalsDocument(
      this.arrivals,
      CODES,
      CODES.every(covered),
      now,
      report,
      this.health.status,
    );

    // Skip the write (an R2 Class A operation) when nothing a client reads
    // has changed - typical overnight and during an outage. Poll timings
    // alone don't count as a change.
    const fingerprint = JSON.stringify([{ ...document, poll: undefined }, cacheControl]);
    if (fingerprint === this.lastWritten) return;
    await this.env.LIVE.put(DOCUMENT_KEY, JSON.stringify(document), {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl },
    });
    this.lastWritten = fingerprint;
  }
}

/** The parts of Health worth a storage write. */
function durable({ failedCycles, failingSince, status }: Health): string {
  return JSON.stringify([failedCycles, failingSince, status.state, status.since, status.incidents]);
}

export default {
  async scheduled(_controller, env, ctx) {
    // locationHint only matters when the object is first created: put it
    // near Bangkok, where both the upstream API and the riders are.
    const stub = env.POLLER.get(env.POLLER.idFromName(OBJECT_NAME), { locationHint: "apac" });
    ctx.waitUntil(stub.ensureRunning());
  },
} satisfies ExportedHandler<Env>;
