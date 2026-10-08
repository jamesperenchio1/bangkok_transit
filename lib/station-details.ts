/**
 * Per-station extras for the station page (photos, exits, accessibility,
 * nearby places). Built once by scripts/fetch-station-details.ts from
 * Wikidata, Wikipedia, Wikimedia Commons and OpenStreetMap, and served as
 * one small static file per station (public/station-details/<code>.json) so
 * the page only downloads the station being looked at. Every field is
 * optional in practice - smaller stations have little or no coverage in
 * those sources, and the page hides whatever is missing.
 */

export interface StationPhoto {
  /** ~800px-wide thumbnail on upload.wikimedia.org. */
  thumb: string;
  /** The file's Commons page - where its full credit and license live. */
  page: string;
  author?: string;
  license?: string;
}

export interface StationExit {
  /** The exit's number or name as signed at the station ("3", "3A", ...). */
  label: string;
  /** Exit has a lift down to street level. */
  elevator?: boolean;
}

export type PlaceKind =
  | "mall"
  | "attraction"
  | "museum"
  | "hospital"
  | "university"
  | "market"
  | "park"
  | "temple"
  | "pier"
  | "landmark";

export interface NearbyPlace {
  nameEn: string;
  nameTh: string;
  kind: PlaceKind;
  /** Straight-line distance from the station, rounded to 10 m. */
  meters: number;
  lat: number;
  lon: number;
}

export interface StationDetails {
  code: string;
  wikidata?: string;
  /** Wikipedia article titles. */
  wikipedia?: { en?: string; th?: string };
  /** The first few sentences of each article. */
  summary?: { en?: string; th?: string };
  /** Opening date, as precise as Wikidata has it ("2004", "2004-07-03"). */
  opened?: string;
  photos: StationPhoto[];
  exits: StationExit[];
  /** Mapped entrances that have no number or name. */
  unlabeledExits: number;
  /** Street-level lifts mapped at the station. */
  elevators: number;
  /** OpenStreetMap's wheelchair tag for the station itself. */
  wheelchair?: "yes" | "limited" | "no";
  toilets?: boolean;
  accessibleToilet?: boolean;
  /** Bus stops within ~200 m. */
  busStops: number;
  nearby: NearbyPlace[];
}

const cache = new Map<string, Promise<StationDetails | null>>();

/** Fetches (once per station per page load) that station's extras, or null if there are none. */
export function fetchStationDetails(code: string): Promise<StationDetails | null> {
  let promise = cache.get(code);
  if (!promise) {
    promise = fetch(`/station-details/${encodeURIComponent(code)}.json`)
      .then((res) => (res.ok ? (res.json() as Promise<StationDetails>) : null))
      .catch(() => {
        // Offline or a blip - let the next open try again.
        cache.delete(code);
        return null;
      });
    cache.set(code, promise);
  }
  return promise;
}
