import { useSettingsStore } from "@/lib/settings-store";

/**
 * Which OpenFreeMap basemap is drawn under our own network, and the handful of
 * colours we pick to sit on top of it.
 *
 * Two styles, one per theme. They share the same vector tile source and the
 * same sprite, so tiles cached for one work for the other - only the style
 * JSON and its paint differ (see lib/offline-warm.ts). Both are
 * tiles.openfreemap.org, the one origin the CSP already allows.
 */

/** The light basemap. app/layout.tsx preloads this URL - keep the two identical. */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** The dark basemap: same tiles, night palette. */
export const MAP_STYLE_DARK_URL = "https://tiles.openfreemap.org/styles/dark";

export type ThemeChoice = "system" | "light" | "dark";

/** The theme the saved setting asks for, resolved against the OS. Pure: no DOM. */
export function resolveDarkTheme(theme: ThemeChoice, systemDark: boolean): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return systemDark;
}

/** The basemap style to draw for a theme. */
export function mapStyleUrl(dark: boolean): string {
  return dark ? MAP_STYLE_DARK_URL : MAP_STYLE_URL;
}

/** What the OS says, where there is one (a server render has no window). */
export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * The theme the app is showing right now: the saved setting, or the OS when it
 * is "system". Reads the store at call time, so it is right even before the map
 * has subscribed to anything.
 */
export function isDarkTheme(): boolean {
  return resolveDarkTheme(useSettingsStore.getState().settings.theme, systemPrefersDark());
}

/**
 * Colours for what the app draws itself, chosen for the basemap underneath.
 * Line and station fills keep their official brand colours in both themes;
 * what changes is the neutral scaffolding around them - the label halo that
 * assumed white paper, the "not on this route" grey, the walking dashes.
 */
export interface MapPalette {
  /** Station names. */
  labelText: string;
  /** The halo that separates a name from the basemap's own labels and roads. */
  labelHalo: string;
  /** Track that is not part of the highlighted route (the `dimLines` setting). */
  dimmedLine: string;
  /** Stations off the highlighted route. */
  dimmedStationFill: string;
  dimmedStationStroke: string;
  /** The dotted walking transfer, the walk to a place, and its endpoint. */
  routeWalk: string;
  /** The fallback style's ground, when the basemap itself cannot be fetched. */
  background: string;
}

/** The light palette is exactly what the map drew before there was a dark one. */
const LIGHT_PALETTE: MapPalette = {
  labelText: "#1f2937",
  labelHalo: "#ffffff",
  dimmedLine: "#ccc",
  dimmedStationFill: "#ddd",
  dimmedStationStroke: "#ccc",
  routeWalk: "#0f766e",
  background: "#f2efe9",
};

const DARK_PALETTE: MapPalette = {
  labelText: "#f4f4f5",
  // The dark style's ground is rgb(12,12,12); a dark halo keeps names legible
  // over it and over the paler roads without the bright fringe a white halo
  // would leave.
  labelHalo: "#0c0c0c",
  dimmedLine: "#3f3f46",
  dimmedStationFill: "#3f3f46",
  dimmedStationStroke: "#52525b",
  routeWalk: "#5eead4",
  background: "#0c0c0c",
};

export function mapPalette(dark: boolean): MapPalette {
  return dark ? DARK_PALETTE : LIGHT_PALETTE;
}
