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
  // Long, so a slow fix is not reported as a failure.
  timeout: 30_000,
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
    let stopped = false;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    let tweenTimer: ReturnType<typeof setInterval> | undefined;
    // Where the dot is drawn now, and the latest real fix it is gliding to.
    let shown: GeoPosition | null = null;
    let tween: { from: GeoPosition; to: GeoPosition; start: number; length: number } | null = null;
    let lastFixAt = 0;
    let wakeLock: WakeLockSentinel | null = null;

    const stopTween = () => {
      if (tweenTimer) clearInterval(tweenTimer);
      tweenTimer = undefined;
      tween = null;
    };

    // Glide the dot to each new fix over about the time between fixes instead
    // of jumping, at ~12 Hz so the page is not re-rendered every frame.
    const moveDot = (next: GeoPosition) => {
      const now = performance.now();
      const length = Math.min(Math.max(now - lastFixAt, 400), 2000);
      lastFixAt = now;
      // First fix, or a jump (resumed from background): do not fly across the city.
      if (!shown || haversineMeters([shown.lat, shown.lon], [next.lat, next.lon]) > 200) {
        stopTween();
        shown = next;
        setPosition(next);
        return;
      }
      tween = { from: shown, to: next, start: now, length };
      tweenTimer ??= setInterval(() => {
        if (!tween) return stopTween();
        const t = Math.min((performance.now() - tween.start) / tween.length, 1);
        const { from: a, to: b } = tween;
        shown = {
          lat: a.lat + (b.lat - a.lat) * t,
          lon: a.lon + (b.lon - a.lon) * t,
          accuracy: a.accuracy + (b.accuracy - a.accuracy) * t,
        };
        setPosition(shown);
        if (t >= 1) stopTween();
      }, 80);
    };

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
      moveDot(next);

      const prev = settledRef.current;
      const moved = prev ? haversineMeters([prev.position.lat, prev.position.lon], [next.lat, next.lon]) : Infinity;
      const stale = prev ? Date.now() - prev.at >= SETTLE_MS : true;
      if (!prev || moved >= SETTLE_METERS || (stale && moved >= SETTLE_MIN_METERS)) {
        settledRef.current = { position: next, at: Date.now() };
        setSettled(next);
      }
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setError("denied");
        return;
      }
      setError("timeout");
      // Some browsers (Safari) stop the watch after an error; re-arm it so
      // tracking never just quietly ends.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(start, 1_000);
    };

    const start = () => {
      if (stopped) return;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(onFix, onError, WATCH_OPTIONS);
    };
    const stop = () => {
      clearTimeout(restartTimer);
      if (watchId === null) return;
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };

    // Keep the screen on so the OS does not suspend tracking (battery is not a
    // concern here). The browser drops the lock when the tab hides.
    const requestWake = async () => {
      try {
        if (!navigator.wakeLock || wakeLock) return;
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      } catch {
        wakeLock = null;
      }
    };

    // Browsers throttle or drop a watch while the tab is hidden, and it does
    // not always resume on its own: re-arm it when the rider comes back, so
    // the dot is not stuck at where they left.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
        void requestWake();
      } else {
        stop();
      }
    };

    start();
    void requestWake();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stopTween();
      stop();
      void wakeLock?.release().catch(() => {});
    };
  }, [supported]);

  return { position, settled, error };
}
