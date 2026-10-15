import { ageMs, type Arrivals } from "../../../lib/bts";
import type { Incident, UpstreamStatus } from "../../../lib/arrivals-document";

/**
 * The poller's decisions, as pure functions of time and what happened last:
 * when to poll next, which stations to poll, and how healthy the upstream
 * looks. Kept apart from the Durable Object so they are unit-tested without
 * a runtime (test/schedule.test.ts).
 */

/** Alarm cadence while trains run (each alarm = half the stations). */
export const ACTIVE_INTERVAL_MS = 10_000;
/** Overnight the only news is "Not running - next ~05:15"; check rarely. */
export const QUIET_INTERVAL_MS = 5 * 60_000;
/**
 * BTS runs roughly 05:15-00:30 Bangkok time; poll fast with margin either
 * side (minutes after local midnight).
 */
export const QUIET_START_MIN = 1 * 60 + 15;
export const QUIET_END_MIN = 4 * 60 + 45;
/** Stations polled per alarm: about half, well under the 50-fetch limit. */
export const BATCH = 31;
/** Stations polled per alarm while the upstream is down: just enough to notice it's back. */
export const PROBE = 3;
/** Whole failed cycles in a row before the upstream counts as down. */
export const DOWN_AFTER_CYCLES = 2;
/** Longest wait between probes while down. */
export const MAX_BACKOFF_MS = 5 * 60_000;
/** Outages kept in the published history. */
export const MAX_INCIDENTS = 10;

const BANGKOK_UTC_OFFSET_MIN = 7 * 60;

export function isQuietHours(now: number): boolean {
  const d = new Date(now);
  const bangkokMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + BANGKOK_UTC_OFFSET_MIN) % (24 * 60);
  return bangkokMinutes >= QUIET_START_MIN && bangkokMinutes < QUIET_END_MIN;
}

/**
 * Delay until the next alarm. Normal cadence, or the overnight one; while
 * the upstream is down, an exponential backoff (20s, 40s, 80s, ... capped at
 * MAX_BACKOFF_MS) so a broken upstream isn't hammered and the Durable
 * Object isn't kept awake for nothing.
 */
export function nextIntervalMs(now: number, health: Health): number {
  const base = isQuietHours(now) ? QUIET_INTERVAL_MS : ACTIVE_INTERVAL_MS;
  if (health.failedCycles < DOWN_AFTER_CYCLES) return base;
  const backoff = Math.min(MAX_BACKOFF_MS, ACTIVE_INTERVAL_MS * 2 ** (health.failedCycles - 1));
  return Math.max(base, backoff);
}

/** How many stations to poll this alarm. */
export function batchSize(health: Health): number {
  return health.status.state === "down" ? PROBE : BATCH;
}

/** The `count` codes with the oldest readings (never-read ones first). */
export function stalest(codes: string[], held: Record<string, Arrivals>, now: number, count: number): string[] {
  const age = (code: string) => (held[code] ? ageMs(held[code].timestamp, now) : Number.MAX_SAFE_INTEGER);
  return [...codes].sort((a, b) => age(b) - age(a)).slice(0, count);
}

/** Short reason for the published poll report: an HTTP status, "timeout", "deadline" or "error". */
export function failureReason(err: unknown, deadline: AbortSignal): string {
  if (deadline.aborted) return "deadline";
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "timeout";
    const status = /upstream (\d{3})/.exec(err.message);
    if (status) return status[1];
    if (err.message.includes("malformed")) return "malformed";
  }
  return "error";
}

/** What the poller remembers about upstream health between alarms (persisted). */
export interface Health {
  /** Whole cycles in a row where no station answered. */
  failedCycles: number;
  /** When the current run of failed cycles began (ISO), or null. */
  failingSince: string | null;
  status: UpstreamStatus;
}

export function initialHealth(now: number): Health {
  return {
    failedCycles: 0,
    failingSince: null,
    status: { state: "ok", since: new Date(now).toISOString(), lastSuccessAt: null, incidents: [] },
  };
}

/**
 * Health after a poll that tried `polled` stations and heard back from `ok`.
 * An incident opens when the upstream goes down (dated from the first failed
 * cycle, not the moment it was declared down) and closes on the first answer.
 */
export function nextHealth(prev: Health, polled: number, ok: number, now: number): Health {
  if (polled === 0) return prev;
  const at = new Date(now).toISOString();
  const { status } = prev;

  if (ok > 0) {
    const state = ok === polled ? "ok" : "degraded";
    const incidents: Incident[] =
      status.state === "down" && status.incidents[0]?.end === null
        ? [{ ...status.incidents[0], end: at }, ...status.incidents.slice(1)]
        : status.incidents;
    return {
      failedCycles: 0,
      failingSince: null,
      status: {
        state,
        since: state === status.state ? status.since : at,
        lastSuccessAt: at,
        incidents,
      },
    };
  }

  const failedCycles = prev.failedCycles + 1;
  const failingSince = prev.failingSince ?? at;
  if (failedCycles < DOWN_AFTER_CYCLES) {
    return {
      failedCycles,
      failingSince,
      status: { ...status, state: "degraded", since: status.state === "degraded" ? status.since : at },
    };
  }
  if (status.state === "down") return { failedCycles, failingSince, status };
  return {
    failedCycles,
    failingSince,
    status: {
      ...status,
      state: "down",
      since: failingSince,
      incidents: [{ start: failingSince, end: null }, ...status.incidents].slice(0, MAX_INCIDENTS),
    },
  };
}
