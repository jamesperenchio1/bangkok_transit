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

function PlatformTimes({
  platform,
  timestamp,
  now,
}: {
  platform: ArrivalPlatform;
  timestamp: string;
  now: number;
}) {
  const trains = platform.trains
    .map((train) => ({ train, countdown: trainCountdown(timestamp, train, now) }))
    .filter(({ countdown }) => !countdown?.departed)
    .map(({ train, countdown }) => ({ train, left: countdown?.minutes ?? null }))
    .slice(0, 3);
  if (trains.length === 0) return null;

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
 * against the live clock between polls. Renders from the shared store, so
 * there is never a spinner or a late pop-in.
 */
export function StationEta({ station }: { station: Station }) {
  const { data, settled, now } = useArrivals(station.hasLiveArrivals ? station.code : null);

  if (!station.hasLiveArrivals) {
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">No live data for this line</p>;
  }
  if (!data) {
    // Before the first response: still loading. After it: there is nothing
    // fresh for this station (cold start still filling in, upstream trouble,
    // or this device offline) - and old times are never shown instead.
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

  const platforms = (data.platforms ?? []).filter((p) => p.trains.length > 0);
  if (platforms.length === 0) {
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">No live arrivals right now</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-3">
        {platforms.map((platform) => (
          <PlatformTimes
            key={platform.platform}
            platform={platform}
            timestamp={data.timestamp}
            now={now}
          />
        ))}
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        Updated {updatedAgoLabel(data.timestamp, now)}
      </p>
    </div>
  );
}
