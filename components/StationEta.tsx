"use client";

import { useArrivals } from "@/lib/use-arrivals";
import { arrivalClockTime, minutesLabel } from "@/lib/format-eta";
import type { ArrivalPlatform } from "@/lib/bts";
import type { Station } from "@/data/stations";

function directionLabel(direction: string): string {
  // Upstream joins both languages: "เคหะฯ  | Kheha" - keep the English half.
  const parts = direction.split("|");
  return (parts.length > 1 ? parts[parts.length - 1] : direction).trim();
}

function PlatformTimes({ platform, timestamp }: { platform: ArrivalPlatform; timestamp: string }) {
  const trains = platform.trains.slice(0, 3);
  if (trains.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] font-medium text-neutral-500">
        → {directionLabel(platform.direction)}
      </p>
      <ul className="mt-0.5 flex flex-col">
        {trains.map((train, i) => {
          const clockTime = arrivalClockTime(timestamp, train.eta_minutes);
          return (
            <li
              key={`${train.train_no}-${i}`}
              className="text-xs text-neutral-700 dark:text-neutral-200"
            >
              {minutesLabel(train.eta_minutes)}
              {clockTime ? (
                <span className="text-neutral-400 dark:text-neutral-500"> · {clockTime}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Live arrivals for the station card: up to three trains per direction, each
 * on its own row. Renders from the shared store, so there is never a spinner
 * or a late pop-in.
 */
export function StationEta({ station }: { station: Station }) {
  const { data } = useArrivals(station.hasLiveArrivals ? station.code : null);

  if (!station.hasLiveArrivals) {
    return <p className="text-xs text-neutral-500">No live data for this line</p>;
  }
  if (!data) return null;

  if (!data.service_active) {
    // Upstream's next_service string already includes its own leading "~"
    // (e.g. "~05:30") - strip it before adding ours, or it doubles up.
    const nextService = data.next_service?.replace(/^~\s*/, "") ?? "?";
    return <p className="text-xs text-neutral-500">Not running — next ~{nextService}</p>;
  }

  const platforms = (data.platforms ?? []).filter((p) => p.trains.length > 0);
  if (platforms.length === 0) {
    return <p className="text-xs text-neutral-500">No live arrivals right now</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {platforms.map((platform) => (
        <PlatformTimes key={platform.platform} platform={platform} timestamp={data.timestamp} />
      ))}
    </div>
  );
}
