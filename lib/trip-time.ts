import type { Arrivals } from "./bts";
import { upcomingTrains } from "./format-eta";
import { getService, scheduledWaitMinutes, serviceStatus, type ServiceStatus } from "./service-hours";
import type { PathResult } from "./transit-graph";

/**
 * The route sheet's total used to exclude the wait for the first train while
 * showing the next train beside it: two different answers in one panel. This
 * is the one place that adds them together, so the header, the sheet and the
 * service warning can never disagree.
 */
export interface TripTiming {
  /** Door-to-door minutes, including the expected wait for the first train. */
  minutes: number;
  /** Expected wait that was added, or null when it could not be estimated. */
  waitMinutes: number | null;
  /** True when the wait came from a live arrival rather than a timetable. */
  waitLive: boolean;
  service: ServiceStatus | null;
  firstTrain: string | null;
}

/** The first ride leg is the one whose wait matters: changes already carry the router's change penalty. */
export function firstRideLeg(path: PathResult) {
  return path.legs.find((leg) => leg.mode === "ride" && leg.line) ?? null;
}

/**
 * Live wait when the station has a fresh arrival in the route's direction,
 * otherwise half the line's headway at this hour. Returns null only when the
 * path has no ride at all (a pure walk) or the line has no timetable entry.
 */
export function tripTiming(
  path: PathResult,
  arrivals: Arrivals | null,
  now: number | Date = Date.now(),
): TripTiming {
  const leg = firstRideLeg(path);
  if (!leg || !leg.line) {
    return { minutes: path.minutes, waitMinutes: null, waitLive: false, service: null, firstTrain: null };
  }

  const service = serviceStatus(leg.line, now);
  let waitMinutes: number | null = null;
  let waitLive = false;

  if (arrivals && arrivals.service_active && leg.boardToward) {
    const platform = arrivals.platforms.find((p) => p.direction_key === leg.boardToward?.code);
    if (platform) {
      const next = upcomingTrains(platform.trains, arrivals.timestamp, typeof now === "number" ? now : now.getTime())[0];
      if (next?.left !== null && next?.left !== undefined) {
        waitMinutes = Math.max(0, next.left);
        waitLive = true;
      }
    }
  }

  if (waitMinutes === null && service === "running") waitMinutes = scheduledWaitMinutes(leg.line, now);

  return {
    minutes: path.minutes + (waitMinutes ?? 0),
    waitMinutes,
    waitLive,
    service,
    firstTrain: getService(leg.line)?.first ?? null,
  };
}
