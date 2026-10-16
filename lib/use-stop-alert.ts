"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stationName, useLangStore, strings } from "./i18n";
import { DEFAULT_ALERT_SETTINGS, alertTargets, dueTarget, routeKey, type AlertSettings, type AlertTarget } from "./stop-alert";
import { holdScreenAwake, notify, playDing, requestNotifications, unlockAudio, vibrate } from "./alert-output";
import type { PathResult } from "./transit-graph";
import type { GeoPosition } from "./use-geolocation";

const STORAGE_KEY = "bts:stop-alert:v1";

function loadSettings(): AlertSettings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<AlertSettings> | null;
    if (saved && typeof saved === "object") {
      return {
        ...DEFAULT_ALERT_SETTINGS,
        ...saved,
        // A fresh page load starts with alerts off: they hold the screen
        // awake and use the GPS, so turning them on is always deliberate.
        enabled: false,
      };
    }
  } catch {
    // unreadable: defaults
  }
  return DEFAULT_ALERT_SETTINGS;
}

export interface StopAlert {
  settings: AlertSettings;
  update: (patch: Partial<AlertSettings>) => void;
  /** The alert currently on screen, if any. */
  active: AlertTarget | null;
  /** Message for the on-screen alert, in the current language. */
  message: string | null;
  dismiss: () => void;
  /** Rings the chime and vibration once, so the rider can check their volume. */
  test: () => void;
  hasPosition: boolean;
}

/**
 * Watches the rider's GPS against the planned route and rings (chime,
 * vibration, on-screen alert, notification) as each target station is
 * reached. Entirely on-device: no network, so it works offline.
 */
export function useStopAlert(path: PathResult | null, position: GeoPosition | null): StopAlert {
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [active, setActive] = useState<AlertTarget | null>(null);
  const rung = useRef(new Set<number>());
  const key = useRef("");
  const lang = useLangStore((s) => s.lang);

  useEffect(() => {
    // Loaded after mount (not in the initial state) so the prerendered
    // page and the first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
  }, []);

  const update = useCallback((patch: Partial<AlertSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // non-fatal
      }
      return next;
    });
    if (patch.enabled) {
      // Inside the tap that enabled it, where browsers allow audio and prompts.
      unlockAudio();
      void requestNotifications();
    }
  }, []);

  const watching = settings.enabled && path !== null;

  // A different route starts over; so does turning alerts off and on.
  const pathKey = path ? routeKey(path) : "";
  useEffect(() => {
    if (key.current !== pathKey) {
      key.current = pathKey;
      rung.current = new Set();
      setActive(null);
    }
  }, [pathKey]);
  useEffect(() => {
    if (!settings.enabled) rung.current = new Set();
  }, [settings.enabled]);

  useEffect(() => {
    if (!watching) return;
    return holdScreenAwake();
  }, [watching]);

  useEffect(() => {
    if (!watching || !path || !position) return;
    const targets = alertTargets(path, settings);
    const due = dueTarget(targets, position, rung.current);
    if (!due) return;
    // Reaching a station also settles every earlier one on the route.
    for (const t of targets) if (t.legIndex <= due.legIndex) rung.current.add(t.legIndex);
    setActive(due);
    if (settings.sound) playDing();
    if (settings.vibrate) vibrate();
    const text = describe(due, path, lang);
    void notify(strings[lang].appTitle, text);
  }, [watching, path, position, settings, lang]);

  const test = useCallback(() => {
    unlockAudio();
    playDing();
    vibrate();
  }, []);

  const message = active && path ? describe(active, path, lang) : null;

  return {
    settings,
    update,
    active,
    message,
    dismiss: () => setActive(null),
    test,
    hasPosition: position !== null,
  };
}

function describe(target: AlertTarget, path: PathResult, lang: "en" | "th"): string {
  const t = strings[lang];
  const destination = stationName(path.legs[path.legs.length - 1].station, lang);
  const here = stationName(target.station, lang);
  if (target.kind === "arrive") return t.alertArrive(here);
  if (target.kind === "change") return t.alertChange(here);
  return t.alertApproach(destination, target.stopsLeft);
}
