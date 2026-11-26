import { describe, expect, it } from "vitest";
import {
  MAP_STYLE_DARK_URL,
  MAP_STYLE_URL,
  isDarkTheme,
  mapPalette,
  mapStyleUrl,
  resolveDarkTheme,
} from "@/lib/map-style";
import { useSettingsStore } from "@/lib/settings-store";

describe("basemap style", () => {
  it("draws OpenFreeMap's dark style in dark mode and Liberty otherwise", () => {
    expect(MAP_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(MAP_STYLE_DARK_URL).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(mapStyleUrl(false)).toBe(MAP_STYLE_URL);
    expect(mapStyleUrl(true)).toBe(MAP_STYLE_DARK_URL);
  });

  it("resolves the theme setting against the OS, and takes an explicit choice as given", () => {
    expect(resolveDarkTheme("system", false)).toBe(false);
    expect(resolveDarkTheme("system", true)).toBe(true);
    expect(resolveDarkTheme("light", true)).toBe(false);
    expect(resolveDarkTheme("dark", false)).toBe(true);
  });

  it("reads the saved theme, not only the OS preference", () => {
    const before = useSettingsStore.getState().settings.theme;
    try {
      // No window in the unit tests, so "system" can only resolve to light:
      // an explicit dark must still switch the map.
      useSettingsStore.getState().update({ theme: "dark" });
      expect(isDarkTheme()).toBe(true);
      useSettingsStore.getState().update({ theme: "light" });
      expect(isDarkTheme()).toBe(false);
    } finally {
      useSettingsStore.getState().update({ theme: before });
    }
  });
});

describe("mapPalette", () => {
  it("keeps the light basemap's existing colours", () => {
    expect(mapPalette(false)).toEqual({
      labelText: "#1f2937",
      labelHalo: "#ffffff",
      dimmedLine: "#ccc",
      dimmedStationFill: "#ddd",
      dimmedStationStroke: "#ccc",
      routeWalk: "#525252",
      background: "#f2efe9",
    });
  });

  it("moves labels, the muted grey and the fallback ground to the night basemap", () => {
    const light = mapPalette(false);
    const dark = mapPalette(true);
    // Light text on a dark halo, rather than the other way round: the halo
    // must not be the brightest thing on a night map.
    expect(dark.labelText).not.toBe(light.labelText);
    expect(dark.labelHalo).not.toBe(light.labelHalo);
    expect(dark.labelHalo).not.toBe(light.labelHalo.toUpperCase());
    for (const key of ["dimmedLine", "dimmedStationFill", "dimmedStationStroke", "routeWalk", "background"] as const) {
      expect(dark[key]).not.toBe(light[key]);
    }
  });
});
