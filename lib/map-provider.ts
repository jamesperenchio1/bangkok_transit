/**
 * Which map to show. MapLibre ("standard") is the default and what the app is
 * built around: saved on the device, so it works offline. Google is an opt-in
 * extra, and is used only when the rider chose it, this build has a key for it,
 * the page did not start offline and Google has not already failed this visit.
 * In every other case the rider gets the standard map - never a broken one.
 */
export type MapProvider = "standard" | "google";

export interface MapChoice {
  /** The map to mount. */
  provider: MapProvider;
  /** The rider asked for Google but cannot have it right now: say so. */
  fellBack: boolean;
}

export function chooseMap(opts: {
  chosen: MapProvider;
  hasGoogleKey: boolean;
  startedOffline: boolean;
  googleFailed: boolean;
}): MapChoice {
  const wantsGoogle = opts.chosen === "google" && opts.hasGoogleKey;
  const usable = wantsGoogle && !opts.startedOffline && !opts.googleFailed;
  return { provider: usable ? "google" : "standard", fellBack: wantsGoogle && !usable };
}
