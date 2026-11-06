"use client";

import { create } from "zustand";
import type { LineKey } from "@/data/stations";

/**
 * Display and behaviour preferences, remembered per device. A zustand store
 * (like the language store) rather than context, because the map's station
 * cards are separate React roots. Everything here is client-side: nothing is
 * sent anywhere, so it costs nothing per user.
 *
 * Defaults reproduce the app exactly as it was before there were settings.
 */
export interface Settings {
  /** Station names (and codes at high zoom) on the map. */
  showLabels: boolean;
  /** Estimated live train markers (BTS). */
  showTrains: boolean;
  /** The blue "you are here" dot and accuracy circle. */
  showLocation: boolean;
  /** Lines hidden from the map. Routing still uses them. */
  hiddenLines: LineKey[];
  /** Move the camera to a station picked from search / the list. Off: just open its card. */
  autoZoom: boolean;
  /** Route planning: charge more for changing lines, so fewer changes win over a faster trip. */
  fewerChanges: boolean;
  /** Route planning: avoid walking transfers between stations where a ride-only route exists. */
  avoidWalking: boolean;
  /** Search places (malls, hospitals, addresses...) online as you type. Sends the typed text to Photon. */
  onlinePlaces: boolean;
  /** 112.5% root text size. */
  largeText: boolean;
  /** Never animate the camera or the UI, regardless of the OS setting. */
  reduceMotion: boolean;
  /** Skip the one-off background download of map tiles for offline use. */
  dataSaver: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showLabels: true,
  showTrains: true,
  showLocation: true,
  hiddenLines: [],
  autoZoom: true,
  fewerChanges: false,
  avoidWalking: false,
  onlinePlaces: true,
  largeText: false,
  reduceMotion: false,
  dataSaver: false,
};

export const SETTINGS_STORAGE_KEY = "bts:settings:v1";

/** Reads saved settings, ignoring anything missing, malformed or of the wrong type. */
export function parseSettings(raw: string | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!saved || typeof saved !== "object") return out;
  const record = saved as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === "hiddenLines") {
      if (Array.isArray(record.hiddenLines)) {
        out.hiddenLines = record.hiddenLines.filter((l): l is LineKey => typeof l === "string");
      }
    } else if (typeof record[key] === "boolean") {
      (out as unknown as Record<string, boolean>)[key] = record[key];
    }
  }
  return out;
}

function persist(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode etc.) - the choice still applies this visit.
  }
}

export const useSettingsStore = create<{
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  toggleLine: (line: LineKey) => void;
  reset: () => void;
}>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    persist(settings);
  },
  toggleLine: (line) => {
    const hidden = get().settings.hiddenLines;
    get().update({ hiddenLines: hidden.includes(line) ? hidden.filter((l) => l !== line) : [...hidden, line] });
  },
  reset: () => {
    set({ settings: DEFAULT_SETTINGS });
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // non-fatal
    }
  },
}));

/**
 * Restore saved settings. Called once on mount, not at module load: the page
 * is prerendered with defaults, and reading storage before hydration would
 * mismatch it.
 */
export function restoreSettings() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return;
  }
  if (raw) useSettingsStore.setState({ settings: parseSettings(raw) });
}

/** Camera animation length: instant when the OS or this app asks for less motion. */
export function motionDuration(ms: number): number {
  if (typeof window === "undefined") return ms;
  if (useSettingsStore.getState().settings.reduceMotion) return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}
