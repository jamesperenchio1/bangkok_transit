"use client";

import { useArrivals } from "@/lib/use-arrivals";
import {
  arrivalClockTime,
  minutesLabel,
  trainCountdown,
  updatedAgoLabel,
} from "@/lib/format-eta";
import type { ArrivalPlatform } from "@/lib/bts";
import type { Station } from "@/data/stations";

function directionLabel(direction: string): string {
  // Upstream joins both languages: "เคหะฯ  | Kheha" - keep the English half.
  const parts = direction.split("|");
  return (parts.length > 1 ? parts[parts.length - 1] : direction).trim();
}

type UpcomingTrain = { train: ArrivalPlatform["trains"][number]; left: number | null };

/** Up to three trains per platform that haven't left yet, per the live countdown. */
function upcomingTrains(platform: ArrivalPlatform, timestamp: string, now: number): UpcomingTrain[] {
  return platform.trains
    .map((train) => ({ train, countdown: trainCountdown(timestamp, train, now) }))
    .filter(({ countdown }) => !countdown?.departed)
    .map(({ train, countdown }) => ({ train, left: countdown?.minutes ?? null }))
    .slice(0, 3);
}

function PlatformTimes({
  platform,
  trains,
  timestamp,
}: {
  platform: ArrivalPlatform;
  trains: UpcomingTrain[];
  timestamp: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-neutral-600 dark:text-neutral-300">
        → {directionLabel(platform.direction)}
      </p>
      <ul className="mt-0.5 flex flex-col">
        {trains.map(({ train, left }, i) => {
          const clockTime = arrivalClockTime(timestamp, train.eta_precise ?? train.eta_minutes);
          const soon = left !== null && left <= 1;
          return (
            <li key={`${train.train_no}-${i}`} className="flex items-baseline gap-1.5 leading-snug">
              <span
                className={`text-sm font-semibold tabular-nums ${
                  soon ? "text-green-600 dark:text-green-400" : "text-neutral-900 dark:text-white"
                }`}
              >
                {minutesLabel(left)}
              </span>
              {clockTime ? (
                <span className="text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
                  {clockTime}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Live arrivals for the station card: up to three trains per direction, the
 * two directions side by side so the card stays short. Minutes count down
 * against the live clock between polls; if updates stall, the last-known
 * times stay up with their age flagged. Renders from the shared store, so
 * there is never a spinner or a late pop-in.
 */
export function StationEta({ station }: { station: Station }) {
  const { data, live, settled, now } = useArrivals(station.hasLiveArrivals ? station.code : null);

  if (!station.hasLiveArrivals) {
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">No live data for this line</p>;
  }
  if (!data) {
    // Before the first response: still loading. After it: nothing recent
    // enough to show for this station at all (cold start still filling in,
    // or upstream/device offline for longer than MAX_SHOW_AGE_MS).
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {settled ? "Live times unavailable right now — retrying…" : "Checking times…"}
      </p>
    );
  }

  if (!data.service_active) {
    // Upstream's next_service string already includes its own leading "~"
    // (e.g. "~05:30") - strip it before adding ours, or it doubles up.
    const nextService = data.next_service?.replace(/^~\s*/, "") ?? "?";
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">Not running — next ~{nextService}</p>;
  }

  const platforms = (data.platforms ?? [])
    .map((platform) => ({ platform, trains: upcomingTrains(platform, data.timestamp, now) }))
    .filter(({ trains }) => trains.length > 0);

  // Last-known times stay up (counted down) when updates stall; the line
  // below says how old they are rather than hiding them.
  const updated = (
    <p
      className={`text-[11px] ${
        live ? "text-neutral-500 dark:text-neutral-400" : "text-amber-600 dark:text-amber-400"
      }`}
    >
      Updated {updatedAgoLabel(data.timestamp, now)}
      {live ? "" : " · reconnecting…"}
    </p>
  );

  if (platforms.length === 0) {
    // Every listed train has already left by the countdown (or none were
    // listed): nothing useful to show until the next update lands.
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {live ? "No live arrivals right now" : "Waiting for new times…"}
        </p>
        {updated}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-3">
        {platforms.map(({ platform, trains }) => (
          <PlatformTimes
            key={platform.platform}
            platform={platform}
            trains={trains}
            timestamp={data.timestamp}
          />
        ))}
      </div>
      {updated}
    </div>
  );
}
