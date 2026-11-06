/**
 * Online place search (malls, hospitals, hotels, restaurants, streets,
 * addresses ...) through Photon, a typeahead geocoder over OpenStreetMap data.
 *
 * This is the one feature that talks to a third party from the browser, and
 * only for what the rider types into the search box: station search stays
 * local, and the whole feature can be switched off in settings. Photon's public
 * instance is free under fair use, so requests are debounced by the caller,
 * cancelled when stale, and cached here for the session.
 */

export interface Place {
  id: string;
  name: string;
  /** Street / district line under the name. */
  detail: string;
  /** Human kind ("Shopping mall", "Hospital") from the OSM tag, when known. */
  kind: string;
  lat: number;
  lon: number;
}

const ENDPOINT = "https://photon.komoot.io/api/";
/** Greater Bangkok (west, south, east, north): keeps results relevant to a rail map. */
const BBOX = "99.9,13.3,101.1,14.3";
const BIAS = { lat: 13.7563, lon: 100.5018 };
const LIMIT = 12;
export const MIN_QUERY_LENGTH = 2;

const cache = new Map<string, Place[]>();

const KIND_LABELS: Record<string, string> = {
  mall: "Shopping mall",
  supermarket: "Supermarket",
  department_store: "Department store",
  convenience: "Convenience store",
  hospital: "Hospital",
  clinic: "Clinic",
  pharmacy: "Pharmacy",
  university: "University",
  college: "College",
  school: "School",
  hotel: "Hotel",
  hostel: "Hostel",
  guest_house: "Guest house",
  restaurant: "Restaurant",
  cafe: "Cafe",
  fast_food: "Fast food",
  bar: "Bar",
  bank: "Bank",
  atm: "ATM",
  place_of_worship: "Temple / shrine",
  museum: "Museum",
  attraction: "Attraction",
  park: "Park",
  stadium: "Stadium",
  cinema: "Cinema",
  theatre: "Theatre",
  library: "Library",
  police: "Police",
  embassy: "Embassy",
  townhall: "Government office",
  aerodrome: "Airport",
  bus_station: "Bus station",
  station: "Station",
  market: "Market",
  marketplace: "Market",
  fuel: "Fuel station",
  parking: "Parking",
  residential: "Street",
  primary: "Road",
  secondary: "Road",
  tertiary: "Road",
  suburb: "Neighbourhood",
  neighbourhood: "Neighbourhood",
  city: "City",
  house: "Address",
};

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
}

export function parsePhoton(json: unknown): Place[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const name = String(p.name ?? street ?? "").trim();
    if (!name) continue;
    const area = [p.locality, p.district, p.city].filter((v, i, a) => v && a.indexOf(v) === i);
    const detail = [name === street ? "" : street, ...area].filter(Boolean).join(", ");
    const id = `${p.osm_type ?? ""}${p.osm_id ?? `${lat},${lon}`}`;
    // Photon can return the same thing twice (node + way); one row is enough.
    const dupKey = `${name}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(id) || seen.has(dupKey)) continue;
    seen.add(id);
    seen.add(dupKey);
    out.push({
      id,
      name,
      detail,
      kind: KIND_LABELS[String(p.osm_value)] ?? "",
      lat,
      lon,
    });
  }
  return out;
}

export async function searchPlaces(query: string, lang: "en" | "th", signal: AbortSignal, limit = LIMIT): Promise<Place[]> {
  const q = query.trim();
  const key = `${lang}:${limit}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    bbox: BBOX,
    lat: String(BIAS.lat),
    lon: String(BIAS.lon),
    location_bias_scale: "0.4",
  });
  // Photon has no Thai output; without `lang` it returns the local (Thai) names.
  if (lang === "en") params.set("lang", "en");
  const res = await fetch(`${ENDPOINT}?${params}`, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`place search ${res.status}`);
  const places = parsePhoton(await res.json());
  cache.set(key, places);
  return places;
}
