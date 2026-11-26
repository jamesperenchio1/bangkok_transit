import { describe, expect, it } from "vitest";
import { stationsByCode } from "@/data/stations";
import { getService, serviceStatus, scheduledWaitMinutes } from "@/lib/service-hours";
import { tripTiming } from "@/lib/trip-time";
import type { PathResult } from "@/lib/transit-graph";

// 2026-01-15 12:00 Bangkok = 05:00Z.
const NOON = Date.UTC(2026, 0, 15, 5, 0);
// 2026-01-15 03:00 Bangkok = 2026-01-14T20:00Z.
const NIGHT = Date.UTC(2026, 0, 14, 20, 0);

function path(overrides: Partial<PathResult> = {}): PathResult {
  const start = stationsByCode.get("N15")!;
  const end = stationsByCode.get("CEN")!;
  return {
    legs: [
      { station: start, mode: "ride", line: "sukhumvit", service: "0", boardToward: end, isChange: false },
    ],
    stops: 8,
    changes: 0,
    walkMeters: 0,
    minutes: 20,
    ...overrides,
  };
}

describe("trip timing", () => {
  it("adds the scheduled half-headway when no live data is available", () => {
    const service = getService("sukhumvit")!;
    const expectedWait = Math.max(1, Math.round(service.offPeak / 2));
    expect(scheduledWaitMinutes("sukhumvit", NOON)).toBe(expectedWait);
    const timing = tripTiming(path(), null, NOON);
    expect(timing.waitMinutes).toBe(expectedWait);
    expect(timing.waitLive).toBe(false);
    expect(timing.minutes).toBe(20 + expectedWait);
  });

  it("uses a live arrival in the boarding direction when one is fresh", () => {
    const toward = stationsByCode.get("CEN")!;
    const arrivals = {
      station: { code: "N15", name_en: "", name_th: "", line_color: "" },
      platforms: [
        {
          platform: "1",
          line_color: "",
          line_id: "sukhumvit",
          direction: "CEN",
          direction_key: toward.code,
          trains: [{ train_no: "1", destination: "CEN", destination_key: toward.code, eta_minutes: 2, status: "running" }],
        },
      ],
      service_active: true,
      near_end_of_service: false,
      next_service: null,
      server_time: new Date(NOON).toISOString(),
      timestamp: new Date(NOON).toISOString(),
    } as never;
    const timing = tripTiming(path(), arrivals, NOON);
    expect(timing.waitLive).toBe(true);
    expect(timing.waitMinutes).toBe(2);
    expect(timing.minutes).toBe(22);
  });

  it("reports service outside the timetable at 3am and running service at noon", () => {
    const service = getService("sukhumvit")!;
    // 03:00 is after the 00:05 last train and before the 05:15 first.
    expect(serviceStatus("sukhumvit", NIGHT)).toBe("ended");
    expect(serviceStatus("sukhumvit", NOON)).toBe("running");
    expect(tripTiming(path(), null, NIGHT).service).toBe("ended");
    expect(tripTiming(path(), null, NIGHT).firstTrain).toBe(service.first);
  });
});
