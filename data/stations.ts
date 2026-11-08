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
  | "srtDarkRed"
  | "srtLightRed";

export interface StationLine {
  line: LineKey;
  name: string;
  color: string;
}

export interface Station {
  /** Stable internal id: the key in the line/interchange/fare data and in
   * `?from=`/`?to=` links and page slugs, so it must never be renumbered. For
   * BTS stations it is the arrival-API code ("N1", "E5"); for the other lines
   * it is a locally assigned code ("BL07", "A03") that does NOT match the
   * operator's. Show `displayCode` to people, never this. */
  code: string;
  /**
   * The operator's official station code(s), when it differs from `code`
   * ("BL01" for Tha Phra, "RN01 / RW01" for Krung Thep Aphiwat, which carries
   * a code on each SRT Red line). Use `shownCode` / `codeAliases`.
   */
  displayCode?: string;
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

/** The code to show a rider: the official one when we hold it, else the id. */
export const shownCode = (s: Station): string => s.displayCode ?? s.code;

/** Every official code of a station ("RN01 / RW01" -> ["RN01", "RW01"]), for search. */
export const codeAliases = (s: Station): string[] => shownCode(s).split("/").map((c) => c.trim());

export const stationsByCode = new Map(stations.map((s) => [s.code, s]));

export const liveStations = stations.filter((s) => s.hasLiveArrivals);
