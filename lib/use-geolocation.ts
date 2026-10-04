"use client";

import { useEffect, useState } from "react";
import { haversineMeters } from "@/lib/line-geometry";

/**
 * Fixes closer than this to the last one (with similar accuracy) are GPS
 * jitter, not movement. Skipping them avoids re-rendering the whole page -
 * map sources, route sheet, nearest-station lookup - several times a second
 * while the user is standing still.
 */
const MIN_MOVE_METERS = 5;

export interface GeoPosition {
  lat: number;
  lon: number;
  accuracy: number;
}

export type GeoError = "denied" | "unsupported" | "timeout" | null;

export interface UseGeolocationResult {
  position: GeoPosition | null;
  error: GeoError;
}

/**
 * Tracks the user's live position (not one-shot - the whole point of showing
 * this on the map is that it moves with them). Errors are surfaced distinctly
 * so the UI can tell "you said no" apart from "your browser can't do this"
 * apart from "still waiting on a fix".
 */
export function useGeolocation(): UseGeolocationResult {
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<GeoError>(supported ? null : "unsupported");

  useEffect(() => {
    if (!supported) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        const next = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setPosition((prev) =>
          prev &&
          haversineMeters([prev.lat, prev.lon], [next.lat, next.lon]) < MIN_MOVE_METERS &&
          Math.abs(prev.accuracy - next.accuracy) < MIN_MOVE_METERS
            ? prev
            : next,
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setError("denied");
        else if (err.code === err.TIMEOUT) setError("timeout");
        else setError("timeout");
      },
      // maximumAge: 0 forces a fresh GPS fix on every update instead of ever
      // handing back a cached one - with a cache allowed, the browser can
      // keep reporting the same stale fix for its whole maximumAge window
      // while the user is actually walking, which is the opposite of "real
      // time" tracking.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [supported]);

  return { position, error };
}
