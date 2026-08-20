import raw from "./stations.json";

export type LineKey = "sukhumvit" | "silom" | "gold" | "yellow" | "pink";

export interface StationLine {
  line: LineKey;
  name: string;
  color: string;
}

export interface Station {
  /** BTS arrival-API code (e.g. "N1", "E5") for BTS stations; for non-BTS
   * lines this is a locally-assigned key since those lines have no live API. */
  code: string;
  nameEn: string;
  nameTh: string;
  lines: StationLine[];
  hasLiveArrivals: boolean;
  /** Pixel coordinates on public/bts-map.png. Null until measured. */
  x: number | null;
  y: number | null;
  /** Hitbox shape/size, matching the marker as drawn on the map image. */
  shape?: "circle" | "interchange";
  radius?: number;
  /** Real-world GPS coordinates, from the arrivals API's /stations endpoint
   * (N6 sourced from OpenStreetMap since it's absent there). Used for the
   * "Open in Google Maps" link - not related to x/y map-image position. */
  lat?: number;
  lon?: number;
}

export const stations: Station[] = raw as Station[];

export const stationsByCode = new Map(stations.map((s) => [s.code, s]));

export const liveStations = stations.filter((s) => s.hasLiveArrivals);
