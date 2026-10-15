import { describe, expect, it } from "vitest";
import {
  ACTIVE_INTERVAL_MS,
  BATCH,
  failureReason,
  initialHealth,
  isQuietHours,
  MAX_BACKOFF_MS,
  MAX_INCIDENTS,
  nextHealth,
  nextIntervalMs,
  PROBE,
  QUIET_INTERVAL_MS,
  batchSize,
  stalest,
  type Health,
} from "../src/schedule";
import { arrivalsFor } from "./helpers";

// 2026-10-15 at the given Bangkok (UTC+7) wall-clock time.
const bangkok = (hh: number, mm = 0) => Date.UTC(2026, 9, 15, hh - 7, mm);

describe("quiet hours", () => {
  it("is quiet only between 01:15 and 04:45 Bangkok time", () => {
    expect(isQuietHours(bangkok(1, 14))).toBe(false);
    expect(isQuietHours(bangkok(1, 15))).toBe(true);
    expect(isQuietHours(bangkok(4, 44))).toBe(true);
    expect(isQuietHours(bangkok(4, 45))).toBe(false);
    expect(isQuietHours(bangkok(18))).toBe(false);
  });
});

describe("nextIntervalMs", () => {
  const healthy = initialHealth(0);
  const failing = (failedCycles: number): Health => ({ ...healthy, failedCycles });

  it("polls every 10s by day and every 5 min overnight", () => {
    expect(nextIntervalMs(bangkok(9), healthy)).toBe(ACTIVE_INTERVAL_MS);
    expect(nextIntervalMs(bangkok(3), healthy)).toBe(QUIET_INTERVAL_MS);
  });

  it("backs off exponentially once the upstream is down, up to a cap", () => {
    expect(nextIntervalMs(bangkok(9), failing(1))).toBe(ACTIVE_INTERVAL_MS);
    expect(nextIntervalMs(bangkok(9), failing(2))).toBe(20_000);
    expect(nextIntervalMs(bangkok(9), failing(3))).toBe(40_000);
    expect(nextIntervalMs(bangkok(9), failing(30))).toBe(MAX_BACKOFF_MS);
  });
});

describe("stalest", () => {
  it("picks never-read stations first, then the oldest readings", () => {
    const now = Date.now();
    const held = { A: arrivalsFor("A", now - 1_000), B: arrivalsFor("B", now - 60_000) };
    expect(stalest(["A", "B", "C"], held, now, 2)).toEqual(["C", "B"]);
  });
});

describe("failureReason", () => {
  const live = new AbortController().signal;
  it("classifies errors for the poll report", () => {
    expect(failureReason(new Error("upstream 503 for N8"), live)).toBe("503");
    expect(failureReason(new Error("upstream returned malformed arrivals for N8"), live)).toBe("malformed");
    expect(failureReason(new DOMException("t", "TimeoutError"), live)).toBe("timeout");
    expect(failureReason("weird", live)).toBe("error");
    expect(failureReason(new Error("x"), AbortSignal.abort())).toBe("deadline");
  });
});

describe("nextHealth", () => {
  const t0 = Date.UTC(2026, 9, 15, 12);
  const at = (s: number) => t0 + s * 1000;

  it("is ok when everything answers and degraded when some don't", () => {
    const h = nextHealth(initialHealth(t0), 31, 31, at(10));
    expect(h.status).toMatchObject({ state: "ok", lastSuccessAt: new Date(at(10)).toISOString() });
    expect(nextHealth(h, 31, 20, at(20)).status.state).toBe("degraded");
  });

  it("declares an outage after two failed cycles, dated from the first", () => {
    let h = nextHealth(initialHealth(t0), 31, 31, at(0));
    h = nextHealth(h, 31, 0, at(10));
    expect(h.status.state).toBe("degraded");
    expect(batchSize(h)).toBe(BATCH);
    h = nextHealth(h, 31, 0, at(20));
    expect(h.status.state).toBe("down");
    expect(h.status.since).toBe(new Date(at(10)).toISOString());
    expect(h.status.incidents).toEqual([{ start: new Date(at(10)).toISOString(), end: null }]);
    expect(batchSize(h)).toBe(PROBE);

    const still = nextHealth(h, 3, 0, at(60));
    expect(still.status).toEqual(h.status);
    expect(still.failedCycles).toBe(3);

    const back = nextHealth(still, 3, 3, at(120));
    expect(back.status.state).toBe("ok");
    expect(back.failedCycles).toBe(0);
    expect(back.status.incidents[0]).toEqual({ start: new Date(at(10)).toISOString(), end: new Date(at(120)).toISOString() });
  });

  it("ignores a cycle that tried nothing", () => {
    const h = initialHealth(t0);
    expect(nextHealth(h, 0, 0, at(1))).toBe(h);
  });

  it("keeps a bounded outage history", () => {
    let h = initialHealth(t0);
    for (let i = 0; i < MAX_INCIDENTS + 5; i++) {
      h = nextHealth(h, 3, 0, at(i * 100));
      h = nextHealth(h, 3, 0, at(i * 100 + 10));
      h = nextHealth(h, 3, 3, at(i * 100 + 50));
    }
    expect(h.status.incidents).toHaveLength(MAX_INCIDENTS);
    expect(h.status.incidents.every((i) => i.end !== null)).toBe(true);
  });
});
