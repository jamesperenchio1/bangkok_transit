"use client";

import { useEffect, useState } from "react";

export interface GeoPosition {
  lat: number;
  lon: number;
  accuracy: number;
  /** Compass bearing in degrees clockwise from true north, or null when the
   * device isn't moving or doesn't report one. */
  heading: number | null;
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
        // heading is null when stationary or unsupported, and some browsers
        // report NaN instead of null in the same cases - normalize both.
        const heading = pos.coords.heading;
        setPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: typeof heading === "number" && !Number.isNaN(heading) ? heading : null,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setError("denied");
        else if (err.code === err.TIMEOUT) setError("timeout");
        else setError("timeout");
      },
      // maximumAge: 0 looks like it would force the freshest possible fix,
      // but for watchPosition it does the opposite: it tells the browser to
      // discard the GPS chip's already-continuous stream and negotiate a
      // brand new, independent fix on every single callback. That's slower
      // than just reading the latest fix off the stream, and on mobile it
      // regularly blows past the timeout while walking - the error callback
      // fires, `position` is never updated, and the marker freezes at the
      // last successful fix. A small maximumAge lets each callback reuse the
      // most recent fix already sitting in the stream (still effectively
      // real time - well under a second old) instead of stalling on a fresh
      // acquisition every time.
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [supported]);

  return { position, error };
}
