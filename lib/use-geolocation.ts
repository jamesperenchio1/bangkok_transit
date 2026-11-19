"use client";

import { useEffect, useRef, useState } from "react";
import { haversineMeters } from "@/lib/line-geometry";

/**
 * Fixes this poor are not worth drawing: a 300 m circle centred nowhere in
 * particular reads as "you are here", which is worse than no dot. Phones
 * deliver one of these while they are still acquiring satellites, or indoors.
 */
const MAX_ACCURACY_METERS = 100;

/**
 * A fix this far from the settled one is real movement, not GPS jitter, and
 * moves everything that depends on the position (the nearest-station pill, the
 * stop alert).
 */
const SETTLE_METERS = 10;
/** Closer fixes still settle after this long, so a slow walker is not frozen. */
const SETTLE_MS = 2_000;
const SETTLE_MIN_METERS = 3;

const WATCH_OPTIONS: PositionOptions = {
  // maximumAge: 0 forces a fresh fix on every update instead of ever handing
  // back a cached one - with a cache allowed, the browser can keep reporting
  // the same stale fix for its whole maximumAge window while the user is
  // actually walking, which is the opposite of "real time" tracking.
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
};

export interface GeoPosition {
  lat: number;
  lon: number;
  accuracy: number;
}

export type GeoError = "denied" | "unsupported" | "timeout" | null;

export interface UseGeolocationResult {
  /**
   * The latest fix, for the dot on the map: it must move whenever the rider
   * does, so it takes every fix and is never held back.
   */
  position: GeoPosition | null;
  /**
   * The position the rest of the UI may act on: the same fix once it has been
   * confirmed by movement (or a couple of seconds), so a jittery fix cannot
   * flip the nearest station, or ring the stop alert, on its own.
   */
  settled: GeoPosition | null;
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
  const [settled, setSettled] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<GeoError>(supported ? null : "unsupported");
  const settledRef = useRef<{ position: GeoPosition; at: number } | null>(null);

  useEffect(() => {
    if (!supported) return;
    let watchId: number | null = null;

    const onFix = (pos: GeolocationPosition) => {
      const next = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      if (!Number.isFinite(next.accuracy) || next.accuracy > MAX_ACCURACY_METERS) return;
      setError(null);
      // Every good fix reaches the dot; nothing is gated here, because a dot
      // that waits for 5 m of movement looks frozen while the rider walks.
      setPosition(next);

      const prev = settledRef.current;
      const moved = prev ? haversineMeters([prev.position.lat, prev.position.lon], [next.lat, next.lon]) : Infinity;
      const stale = prev ? Date.now() - prev.at >= SETTLE_MS : true;
      if (!prev || moved >= SETTLE_METERS || (stale && moved >= SETTLE_MIN_METERS)) {
        settledRef.current = { position: next, at: Date.now() };
        setSettled(next);
      }
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) setError("denied");
      else if (err.code === err.TIMEOUT) setError("timeout");
      else setError("timeout");
    };

    const start = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(onFix, onError, WATCH_OPTIONS);
    };
    const stop = () => {
      if (watchId === null) return;
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };

    // Browsers throttle or drop a watch while the tab is hidden, and it does
    // not always resume on its own: re-arm it when the rider comes back, so
    // the dot is not stuck at where they left.
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [supported]);

  return { position, settled, error };
}
