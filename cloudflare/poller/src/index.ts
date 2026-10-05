import { DurableObject } from "cloudflare:workers";
import { ageMs, fetchUpstream, type Arrivals } from "../../../lib/bts";
import {
  buildArrivalsDocument,
  mergeArrivals,
  type ArrivalsDocument,
  type PollReport,
} from "../../../lib/arrivals-document";
import { liveStations } from "../../../data/stations";

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
/** Stations polled per alarm: about half, well under the 50-fetch limit. */
const BATCH = 31;
/**
 * One slow batch mustn't push the alarm past its slot: no new upstream call
 * starts after START_BUDGET_MS, and calls still running at ALARM_BUDGET_MS
 * are abandoned. Whatever didn't fit is polled first next time.
 */
const START_BUDGET_MS = 6_500;
const ALARM_BUDGET_MS = 9_500;

const CODES = liveStations.map((s) => s.code);

function intervalAt(now: number): number {
  const bangkokMinutes = (new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes() + 7 * 60) % (24 * 60);
  return bangkokMinutes >= QUIET_START_MIN && bangkokMinutes < QUIET_END_MIN ? QUIET_INTERVAL_MS : ACTIVE_INTERVAL_MS;
}

export class ArrivalsPoller extends DurableObject<Env> {
  /** Latest readings, kept in memory; reloaded from the published file after an eviction. */
  private arrivals: Record<string, Arrivals> | null = null;
  /**
   * Codes tried since this instance loaded: the document is "complete" once
   * every code has had a turn - not once every one has answered, so a
   * station upstream never answers for can't keep every client fast-polling.
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

  /** The BATCH codes with the oldest readings (never-read ones first). */
  private stalest(held: Record<string, Arrivals>, now: number): string[] {
    const age = (code: string) => (held[code] ? ageMs(held[code].timestamp, now) : Number.MAX_SAFE_INTEGER);
    return [...CODES].sort((a, b) => age(b) - age(a)).slice(0, BATCH);
  }

  private async poll(): Promise<void> {
    const startedAt = Date.now();
    const previous = await this.previous();
    const codes = this.stalest(previous, startedAt);
    const deadline = AbortSignal.timeout(ALARM_BUDGET_MS);

    const fresh: Record<string, Arrivals> = {};
    const failed: Record<string, string> = {};
    let cursor = 0;
    const worker = async () => {
      while (cursor < codes.length && Date.now() - startedAt < START_BUDGET_MS) {
        const code = codes[cursor++];
        try {
          fresh[code] = await fetchUpstream(code, deadline);
        } catch (err) {
          // Keeps its previous reading (shown with its age); it is among the
          // stalest next cycle, so it is retried first.
          failed[code] = failureReason(err, deadline);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker));
    for (const code of codes.slice(0, cursor)) this.tried.add(code);
    for (const code of codes.slice(cursor)) failed[code] = "skipped";

    const now = Date.now();
    this.arrivals = mergeArrivals(previous, fresh, now);
    const report: PollReport = {
      at: new Date(now).toISOString(),
      ms: now - startedAt,
      polled: codes.length,
      ok: Object.keys(fresh).length,
      failed,
    };
    if (Object.keys(failed).length > 0) console.warn("upstream failures", report);
    const { document, cacheControl } = buildArrivalsDocument(
      this.arrivals,
      CODES,
      this.tried.size === CODES.length,
      now,
      report,
    );
    await this.env.LIVE.put(DOCUMENT_KEY, JSON.stringify(document), {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl },
    });
  }
}

/** Short reason for the published poll report: an HTTP status, "timeout", "deadline" or "error". */
function failureReason(err: unknown, deadline: AbortSignal): string {
  if (deadline.aborted) return "deadline";
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "timeout";
    const status = /upstream (\d{3})/.exec(err.message);
    if (status) return status[1];
    if (err.message.includes("malformed")) return "malformed";
  }
  return "error";
}

export default {
  async scheduled(_controller, env, ctx) {
    // locationHint only matters when the object is first created: put it
    // near Bangkok, where both the upstream API and the riders are.
    const stub = env.POLLER.get(env.POLLER.idFromName(OBJECT_NAME), { locationHint: "apac" });
    ctx.waitUntil(stub.ensureRunning());
  },
} satisfies ExportedHandler<Env>;
