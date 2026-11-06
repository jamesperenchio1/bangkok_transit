"use client";

import { create } from "zustand";
import type { LineKey } from "@/data/stations";

/**
 * Display and behaviour preferences, remembered per device. A zustand store
 * (like the language store) rather than context, because the map's station
 * cards are separate React roots. Everything here is client-side: nothing is
 * sent anywhere, so it costs nothing per user.
 *
 * This file is deliberately small and UI-free: the map, the search box and
 * the arrivals code read it on first load. The menu that edits it (labels,
 * hints, sections - a lot of text) is a separate lazy chunk, see
 * components/settings/.
 *
 * Defaults reproduce the app exactly as it was before there were settings
 * (the one deliberate exception is `otherTrains`).
 */
export interface Settings {
  // --- Map
  /** Station names on the map. */
  showLabels: boolean;
  /** Add the station code under the name. */
  labelCodes: boolean;
  /** Language of the labels: follow the app, or always one / both. */
  labelLanguage: "ui" | "en" | "th" | "both";
  /** Zoom level from which station names appear. */
  labelMinZoom: number;
  /** Station dot size. */
  markerSize: "small" | "medium" | "large";
  /** Thickness of the line track in px, and of the highlighted route. */
  lineWidth: number;
  routeWidth: number;
  /** The basemap's own place / road names. */
  basemapLabels: boolean;
  /** The + / - buttons and the locate button. */
  zoomButtons: boolean;
  locateButton: boolean;
  /** Two-finger rotate / tilt gestures. */
  rotateGestures: boolean;
  /** Keep the map centred on you as you move. */
  followMe: boolean;
  /** Move the camera to a station picked from search / the list. Off: just open its card. */
  autoZoom: boolean;
  /** Grey out lines that are not part of the route while one is shown. */
  dimLines: boolean;
  /** The blue "you are here" dot and accuracy circle. */
  showLocation: boolean;

  // --- Lines
  /** Lines hidden from the map. Routing still uses them. */
  hiddenLines: LineKey[];
  /** While a route is shown, draw only the lines it uses. */
  onlyRouteLines: boolean;

  // --- Trains
  /** Estimated live train markers (BTS). */
  showTrains: boolean;
  /** Trains that are not on the route being shown: hide them, grey them out, or leave them. */
  otherTrains: "hide" | "dim" | "show";
  trainSize: "small" | "medium" | "large";
  /** Text next to each train once zoomed in. */
  trainLabels: boolean;
  /** Smooth (4 fps) or battery saver (one update every 2 s). */
  trainRate: "smooth" | "saver";

  // --- Live times
  /** Show live arrival times in cards, search and the route sheet. */
  showLiveTimes: boolean;
  /** How many upcoming trains per platform. */
  upcomingCount: number;
  /** Clock style for arrival times. */
  clock: "auto" | "12h" | "24h";
  /** Stop fetching live times (saves data and battery; times go stale and say so). */
  pauseLive: boolean;

  // --- Route planning
  /** Charge more for changing lines, so fewer changes beat a slightly faster trip. */
  fewerChanges: boolean;
  /** Charge more for walking transfers. */
  avoidWalking: boolean;
  /** Lines the planner should avoid (still used when there is no other way). */
  avoidLines: LineKey[];
  /** Walking speed for transfers, metres per minute. */
  walkSpeed: number;
  /** Minutes allowed for a change of platform / line. */
  changeMinutes: number;
  /** Show the fare in the header and the route sheet. */
  showFare: boolean;

  // --- Alerts (the on/off and "how many stops before" live in the route sheet)
  /** Chime loudness (0-1) and repeats. */
  alertVolume: number;
  alertRepeats: number;
  /** Keep the screen on while an alert is watching the trip. */
  alertKeepAwake: boolean;
  /** Also show a system notification when an alert rings (where the browser allows). */
  alertNotify: boolean;

  // --- Places
  /** Search places (malls, hospitals, addresses...) online as you type. Sends the typed text to Photon. */
  onlinePlaces: boolean;
  placeResults: number;

  // --- Display
  theme: "system" | "light" | "dark";
  /** Root text size, percent. */
  textSize: number;
  /** Never animate the camera or the UI, regardless of the OS setting. */
  reduceMotion: boolean;
  /** Hide the hint line under the title for a shorter header. */
  compactHeader: boolean;
  units: "metric" | "imperial";

  // --- Data
  /** Skip the one-off background download of map tiles for offline use. */
  dataSaver: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showLabels: true,
  labelCodes: true,
  labelLanguage: "ui",
  labelMinZoom: 11,
  markerSize: "medium",
  lineWidth: 4,
  routeWidth: 5,
  basemapLabels: true,
  zoomButtons: true,
  locateButton: true,
  rotateGestures: true,
  followMe: false,
  autoZoom: true,
  dimLines: true,
  showLocation: true,

  hiddenLines: [],
  onlyRouteLines: false,

  showTrains: true,
  otherTrains: "hide",
  trainSize: "medium",
  trainLabels: true,
  trainRate: "smooth",

  showLiveTimes: true,
  upcomingCount: 3,
  clock: "auto",
  pauseLive: false,

  fewerChanges: false,
  avoidWalking: false,
  avoidLines: [],
  walkSpeed: 75,
  changeMinutes: 5,
  showFare: true,

  alertVolume: 0.6,
  alertRepeats: 2,
  alertKeepAwake: true,
  alertNotify: true,

  onlinePlaces: true,
  placeResults: 12,

  theme: "system",
  textSize: 100,
  reduceMotion: false,
  compactHeader: false,
  units: "metric",

  dataSaver: false,
};

/** Allowed values of the choice settings (anything else in storage is ignored). */
export const CHOICES: { [K in keyof Settings]?: readonly string[] } = {
  labelLanguage: ["ui", "en", "th", "both"],
  markerSize: ["small", "medium", "large"],
  otherTrains: ["hide", "dim", "show"],
  trainSize: ["small", "medium", "large"],
  trainRate: ["smooth", "saver"],
  clock: ["auto", "12h", "24h"],
  theme: ["system", "light", "dark"],
  units: ["metric", "imperial"],
};

/** Allowed [min, max] of the numeric settings; saved values are clamped into it. */
export const RANGES: { [K in keyof Settings]?: readonly [number, number] } = {
  labelMinZoom: [8, 15],
  lineWidth: [2, 8],
  routeWidth: [3, 10],
  upcomingCount: [1, 5],
  walkSpeed: [40, 120],
  changeMinutes: [1, 15],
  alertVolume: [0.1, 1],
  alertRepeats: [1, 5],
  placeResults: [3, 12],
  textSize: [90, 150],
};

export const SETTINGS_STORAGE_KEY = "bts:settings:v1";

const LINE_LISTS = ["hiddenLines", "avoidLines"] as const;

/** Reads saved settings, ignoring anything missing, malformed, out of range or of the wrong type. */
export function parseSettings(raw: string | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, hiddenLines: [], avoidLines: [] };
  if (!raw) return out;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!saved || typeof saved !== "object") return out;
  const record = saved as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = record[key];
    const fallback = DEFAULT_SETTINGS[key];
    if ((LINE_LISTS as readonly string[]).includes(key)) {
      if (Array.isArray(value)) target[key] = value.filter((l): l is LineKey => typeof l === "string");
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") target[key] = value;
    } else if (typeof fallback === "number") {
      const range = RANGES[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        target[key] = range ? Math.min(range[1], Math.max(range[0], value)) : value;
      }
    } else if (typeof value === "string" && CHOICES[key]?.includes(value)) {
      target[key] = value;
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
  toggleLine: (key: "hiddenLines" | "avoidLines", line: LineKey) => void;
  /** Replace everything (import / reset); unknown or invalid parts fall back to defaults. */
  replace: (raw: string | null) => void;
  reset: () => void;
}>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    persist(settings);
  },
  toggleLine: (key, line) => {
    const list = get().settings[key];
    get().update({ [key]: list.includes(line) ? list.filter((l) => l !== line) : [...list, line] });
  },
  replace: (raw) => {
    const settings = parseSettings(raw);
    set({ settings });
    persist(settings);
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
