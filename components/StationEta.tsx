"use client";

import { isFresh } from "@/lib/bts";
import { useArrivals } from "@/lib/use-arrivals";
import { minutesLabel } from "@/lib/format-eta";
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
    return <p className="text-xs text-neutral-500">Not running - next ~{data.next_service}</p>;
  }

  const next = data.platforms?.[0]?.trains?.[0];
  if (!next) return <p className="text-xs text-neutral-500">No live arrivals right now</p>;

  const stale = !isFresh(data.timestamp);

  return (
    <p className="text-xs text-neutral-500">
      Next {stale ? "updating…" : `~${minutesLabel(next.eta_minutes)}`}
    </p>
  );
}
