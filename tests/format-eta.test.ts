import { describe, expect, it } from "vitest";
import { arrivalClockTime, minutesLabel, trainCountdown, upcomingTrains, updatedAgoLabel } from "@/lib/format-eta";
import { strings } from "@/lib/i18n";

const t = strings.en;
// The upstream stamps payloads in UTC without a "Z".
const naive = (ms: number) => new Date(ms).toISOString().replace("Z", "");
const T0 = Date.UTC(2026, 9, 15, 10, 0, 0); // 17:00 in Bangkok

describe("trainCountdown", () => {
  it("parses the naive timestamp as UTC, not local time", () => {
    // If it were parsed as local time on a UTC+7 machine, this would be 7 hours off.
    expect(trainCountdown(naive(T0), { eta_minutes: 5 }, T0)).toEqual({ minutes: 5, departed: false });
  });

  it("counts down against the clock and prefers eta_precise", () => {
    expect(trainCountdown(naive(T0), { eta_minutes: 5, eta_precise: 4.5 }, T0 + 60_000)).toEqual({
      minutes: 3,
      departed: false,
    });
  });

  it("keeps a train 'arriving' for a minute past its ETA, then drops it", () => {
    expect(trainCountdown(naive(T0), { eta_minutes: 1 }, T0 + 90_000)).toEqual({ minutes: 0, departed: false });
    expect(trainCountdown(naive(T0), { eta_minutes: 1 }, T0 + 121_000)).toEqual({ minutes: 0, departed: true });
  });

  it("returns null when there's nothing to count", () => {
    expect(trainCountdown(naive(T0), {}, T0)).toBeNull();
    expect(trainCountdown("garbage", { eta_minutes: 1 }, T0)).toBeNull();
  });
});

describe("upcomingTrains", () => {
  it("drops departed trains and keeps untimed ones", () => {
    const trains = [{ eta_minutes: 0 }, { eta_minutes: 4 }, {}];
    expect(upcomingTrains(trains, naive(T0), T0 + 3 * 60_000).map((x) => x.left)).toEqual([1, null]);
  });
});

describe("labels", () => {
  it("formats minutes", () => {
    expect(minutesLabel(0, t)).toBe("Arriving");
    expect(minutesLabel(3, t)).toBe("3 min");
    expect(minutesLabel(null, t)).toBe("—");
  });

  it("shows the arrival as Bangkok wall-clock time", () => {
    expect(arrivalClockTime(naive(T0), 5, "en")).toBe("5:05 PM");
    expect(arrivalClockTime(naive(T0), 5, "th")).toBe("17:05");
    expect(arrivalClockTime(naive(T0), undefined, "en")).toBeNull();
  });

  it("says how old the data is", () => {
    expect(updatedAgoLabel(naive(T0), T0 + 5_000, t)).toBe("just now");
    expect(updatedAgoLabel(naive(T0), T0 + 40_000, t)).toBe("40s ago");
    expect(updatedAgoLabel(naive(T0), T0 + 190_000, t)).toBe("3 min ago");
  });
});
