"use client";

import { useEffect, useState } from "react";

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
        setPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setError("denied");
        else if (err.code === err.TIMEOUT) setError("timeout");
        else setError("timeout");
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [supported]);

  return { position, error };
}
