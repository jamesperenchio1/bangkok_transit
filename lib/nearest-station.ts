import { stations, type Station } from "@/data/stations";
import { haversineMeters } from "@/lib/line-geometry";
import { useSettingsStore } from "@/lib/settings-store";
import { useLangStore } from "@/lib/i18n";

export interface StationDistance {
  station: Station;
  meters: number;
}

/** The station closest to a point (straight-line), with the distance in metres. */
export function nearestStation(lat: number, lon: number): StationDistance {
  return nearestStations(lat, lon, { limit: 1 })[0];
}

/**
 * The few stations closest to a point, nearest first. A place pin can be a few
 * metres from the boundary between two stations, so the caller needs the
 * runners-up: the closest station is not always the quickest way there.
 */
export function nearestStations(
  lat: number,
  lon: number,
  { limit = 3, withinMeters = Infinity }: { limit?: number; withinMeters?: number } = {},
): StationDistance[] {
  return stations
    .map((station) => ({ station, meters: haversineMeters([lat, lon], [station.lat, station.lon]) }))
    .filter((s) => s.meters <= withinMeters)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
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
