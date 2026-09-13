"use client";

import { isFresh } from "@/lib/bts";
import { useArrivals } from "@/lib/use-arrivals";
import { arrivalClockTime, minutesLabel } from "@/lib/format-eta";
import type { Station } from "@/data/stations";

/**
 * Compact live-arrival readout for the map popup. Renders from cache
 * instantly (no spinner) and refreshes silently as useArrivals polls -
 * there's just no room in a popup for loading states or error copy.
 */
export function StationEta({ station }: { station: Station }) {
  const { data } = useArrivals(station.hasLiveArrivals ? station.code : null);
  if (!station.hasLiveArrivals || !data) return null;

  if (!data.service_active) {
    // Upstream's next_service string already includes its own leading "~"
    // (e.g. "~05:30") - strip it before adding ours, or it doubles up.
    const nextService = data.next_service?.replace(/^~\s*/, "") ?? "?";
    return <p className="text-xs text-neutral-500">Not running - next ~{nextService}</p>;
  }

  const trains = data.platforms?.[0]?.trains ?? [];
  const [next, ...upcoming] = trains;
  if (!next) return <p className="text-xs text-neutral-500">No live arrivals right now</p>;

  const stale = !isFresh(data.timestamp);
  const clockTime = arrivalClockTime(data.timestamp, next.eta_minutes);
  const laterMinutes = upcoming
    .slice(0, 2)
    .map((t) => minutesLabel(t.eta_minutes))
    .join(", ");

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-neutral-500">
        Next{" "}
        {stale
          ? "updating…"
          : `~${minutesLabel(next.eta_minutes)}${clockTime ? ` · ${clockTime}` : ""}`}
      </p>
      {!stale && laterMinutes && (
        <p className="text-xs text-neutral-400">Then ~{laterMinutes}</p>
      )}
    </div>
  );
}
