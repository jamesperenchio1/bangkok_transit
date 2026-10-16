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

/** Heading changes within this many degrees are sensor noise, not turning. */
const MIN_HEADING_CHANGE_DEGREES = 5;

function headingsClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  const diff = Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);
  return diff < MIN_HEADING_CHANGE_DEGREES;
}

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
        const rawHeading = pos.coords.heading;
        const next = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: typeof rawHeading === "number" && !Number.isNaN(rawHeading) ? rawHeading : null,
        };
        setPosition((prev) =>
          prev &&
          haversineMeters([prev.lat, prev.lon], [next.lat, next.lon]) < MIN_MOVE_METERS &&
          Math.abs(prev.accuracy - next.accuracy) < MIN_MOVE_METERS &&
          headingsClose(prev.heading, next.heading)
            ? prev
            : next,
        );
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
