"use client";

import { useEffect, useState } from "react";
import { haversineMeters } from "@/lib/line-geometry";

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

    let watchId: number | null = null;
    let stopped = false;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    let tweenTimer: ReturnType<typeof setInterval> | undefined;
    // Where the dot is drawn now, and the latest real fix it is gliding to.
    let shown: GeoPosition | null = null;
    let tween: { from: GeoPosition; to: GeoPosition; start: number } | null = null;
    let lastFixAt = 0;
    let wakeLock: { release: () => Promise<void> } | null = null;

    const stopTween = () => {
      if (tweenTimer) clearInterval(tweenTimer);
      tweenTimer = undefined;
      tween = null;
    };

    // Glide the dot to each new fix over about the time between fixes instead
    // of jumping, at ~12 Hz so the page isn't re-rendered every frame.
    const onFix = (next: GeoPosition) => {
      const now = performance.now();
      const interval = Math.min(Math.max(now - lastFixAt, 400), 2000);
      lastFixAt = now;
      if (!shown) {
        shown = next;
        setPosition(next);
        return;
      }
      const dist = haversineMeters([shown.lat, shown.lon], [next.lat, next.lon]);
      if (dist > 200) {
        // A jump (resumed from background, first good fix): don't fly across the city.
        stopTween();
        shown = next;
        setPosition(next);
        return;
      }
      const from = shown;
      tween = { from, to: next, start: now };
      if (!tweenTimer) {
        tweenTimer = setInterval(() => {
          if (!tween) return stopTween();
          const t = Math.min((performance.now() - tween.start) / interval, 1);
          const { from: a, to: b } = tween;
          shown = {
            lat: a.lat + (b.lat - a.lat) * t,
            lon: a.lon + (b.lon - a.lon) * t,
            accuracy: a.accuracy + (b.accuracy - a.accuracy) * t,
          };
          setPosition(shown);
          if (t >= 1) stopTween();
        }, 80);
      } else {
        tween.start = now;
      }
    };

    const start = () => {
      if (stopped || watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setError(null);
          onFix({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setError("denied");
            return;
          }
          setError("timeout");
          // Some browsers (Safari) stop the watch after an error; restart it so
          // tracking never just quietly ends.
          restart(1000);
        },
        // maximumAge: 0 forces a fresh fix every update, never a cached one.
        // A long timeout so a slow fix isn't reported as a failure.
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    };

    const stop = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };

    const restart = (delay: number) => {
      stop();
      clearTimeout(restartTimer);
      restartTimer = setTimeout(start, delay);
    };

    // Keep the screen on so the OS doesn't suspend tracking (battery is not a
    // concern here). The lock is released by the browser when the tab hides.
    const requestWake = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        if (!nav.wakeLock || wakeLock) return;
        wakeLock = await nav.wakeLock.request("screen");
        const lock = wakeLock as unknown as EventTarget;
        lock.addEventListener?.("release", () => (wakeLock = null));
      } catch {
        wakeLock = null;
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      restart(0); // a fresh watch picks up immediately after returning
      void requestWake();
    };

    start();
    void requestWake();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(restartTimer);
      stopTween();
      stop();
      void wakeLock?.release().catch(() => {});
    };
  }, [supported]);

  return { position, error };
}
