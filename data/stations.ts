import raw from "./stations.json";

export type LineKey =
  | "sukhumvit"
  | "silom"
  | "gold"
  | "yellow"
  | "pink"
  | "blue"
  | "purple"
  | "arl"
  | "srtRed";

export interface StationLine {
  line: LineKey;
  name: string;
  color: string;
}

export interface Station {
  /** BTS arrival-API code (e.g. "N1", "E5") for BTS stations; for every other
   * line this is a locally-assigned code (e.g. "BL07", "A03") since those
   * lines have no live arrivals API. */
  code: string;
  nameEn: string;
  nameTh: string;
  lines: StationLine[];
  hasLiveArrivals: boolean;
  /** Real-world GPS coordinates - every station has these now (backfilled
   * from BMA's public GIS data, see scripts/build-stations.ts), used both for
   * rendering on the interactive map and the "Open in Google Maps" link. */
  lat: number;
  lon: number;
}

export const stations: Station[] = raw as Station[];

export const stationsByCode = new Map(stations.map((s) => [s.code, s]));

export const liveStations = stations.filter((s) => s.hasLiveArrivals);
