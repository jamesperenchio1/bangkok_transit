"use client";

import { useEffect, useState } from "react";
import type { FinalWalk } from "@/lib/place-station";
import { walkingRoute, type WalkingRoute } from "@/lib/walking-route";

/**
 * The real footpath to the place, once Google has answered. Null while the
 * request is in flight, when there is no key, or when it failed - callers
 * keep drawing the honest straight estimate until this arrives.
 *
 * Keyed by the coordinates rather than the object: a re-render with the same
 * walk must not refetch, and a new destination must not show the previous
 * walk's geometry.
 */
export function useWalkingRoute(finalWalk: FinalWalk | null): WalkingRoute | null {
  const fromLat = finalWalk?.from.lat;
  const fromLon = finalWalk?.from.lon;
  const toLat = finalWalk?.to.lat;
  const toLon = finalWalk?.to.lon;
  const key = `${fromLat},${fromLon},${toLat},${toLon}`;
  // The result is stored with the key it was fetched for; a mismatched key
  // (a new destination) reads as null without a synchronous reset in the
  // effect, which the react-hooks lint rule rightly forbids.
  const [result, setResult] = useState<{ key: string; route: WalkingRoute | null } | null>(null);

  useEffect(() => {
    if (fromLat === undefined || fromLon === undefined || toLat === undefined || toLon === undefined) return;
    const requestKey = `${fromLat},${fromLon},${toLat},${toLon}`;
    const controller = new AbortController();
    let alive = true;
    walkingRoute({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }, controller.signal).then((route) => {
      if (alive) setResult({ key: requestKey, route });
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [fromLat, fromLon, toLat, toLon]);

  return result?.key === key ? result.route : null;
}
