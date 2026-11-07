import { stations, type Station } from "@/data/stations";
import { haversineMeters } from "@/lib/line-geometry";
import { useSettingsStore } from "@/lib/settings-store";
import { useLangStore } from "@/lib/i18n";

/** The station closest to a point (straight-line), with the distance in metres. */
export function nearestStation(lat: number, lon: number): { station: Station; meters: number } {
  let best = stations[0];
  let bestMeters = Infinity;
  for (const s of stations) {
    const meters = haversineMeters([lat, lon], [s.lat, s.lon]);
    if (meters < bestMeters) {
      best = s;
      bestMeters = meters;
    }
  }
  return { station: best, meters: bestMeters };
}

const UNIT_WORDS = {
  en: { m: "m", km: "km", ft: "ft", mi: "mi" },
  th: { m: "ม.", km: "กม.", ft: "ฟุต", mi: "ไมล์" },
} as const;

/** A distance in the rider's units ("350 m", "1.2 km", "1,150 ft", "0.7 mi") and language. */
export function distanceLabel(meters: number, lang: "en" | "th" = useLangStore.getState().lang): string {
  const w = UNIT_WORDS[lang];
  if (useSettingsStore.getState().settings.units === "imperial") {
    const feet = meters * 3.28084;
    return feet < 1000 ? `${Math.round(feet / 10) * 10} ${w.ft}` : `${(meters / 1609.344).toFixed(1)} ${w.mi}`;
  }
  return meters < 1000 ? `${Math.round(meters / 10) * 10} ${w.m}` : `${(meters / 1000).toFixed(1)} ${w.km}`;
}
