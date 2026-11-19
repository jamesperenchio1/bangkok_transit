"use client";

import { googleMapsKey } from "@/lib/google-maps";

/** Same shape the map, search box and place card already use. */
export interface Place {
  id: string;
  name: string;
  detail: string;
  kind: string;
  lat: number;
  lon: number;
}

export const MIN_QUERY_LENGTH = 2;

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryTypeDisplayName",
].join(",");

/** Google returns machine types; these are the useful ones for a rider. */
const KIND_BY_TYPE: Record<string, string> = {
  shopping_mall: "Shopping mall",
  department_store: "Department store",
  hospital: "Hospital",
  hotel: "Hotel",
  restaurant: "Restaurant",
  cafe: "Cafe",
  bank: "Bank",
  tourist_attraction: "Attraction",
  park: "Park",
  museum: "Museum",
  temple: "Temple",
  airport: "Airport",
  train_station: "Station",
  subway_station: "Station",
  transit_station: "Station",
  university: "University",
  school: "School",
  market: "Market",
  pharmacy: "Pharmacy",
};

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
}

/** Kept in memory only: Google's terms do not allow a persistent place cache. */
const cache = new Map<string, Place[]>();

export function parseGooglePlace(raw: GooglePlace): Place | null {
  const name = raw.displayName?.text?.trim();
  const lat = raw.location?.latitude;
  const lon = raw.location?.longitude;
  if (!raw.id || !name || typeof lat !== "number" || typeof lon !== "number") return null;
  const kind =
    raw.primaryTypeDisplayName?.text?.trim() ||
    KIND_BY_TYPE[raw.types?.[0] ?? ""] ||
    "";
  return {
    id: raw.id,
    name,
    detail: raw.formattedAddress?.trim() ?? "",
    kind,
    lat,
    lon,
  };
}

/**
 * Places API (New) Text Search. One request per debounced query, not per
 * keystroke: a search costs one billed call, and the free monthly allowance is
 * shared by every rider on the key.
 */
export async function searchPlaces(
  query: string,
  lang: string,
  signal: AbortSignal,
  limit = 12,
): Promise<Place[]> {
  const textQuery = query.trim();
  if (textQuery.length < MIN_QUERY_LENGTH) return [];

  const cacheKey = `${lang}:${limit}:${textQuery.toLocaleLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const key = googleMapsKey();
  // An empty key still reaches the endpoint: e2e mocks intercept it, and a
  // real deployment without a key gets Google's 403 and the error UI.
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal,
    credentials: "omit",
    referrerPolicy: "strict-origin-when-cross-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: lang === "th" ? "th" : "en",
      regionCode: "TH",
      maxResultCount: limit,
      locationBias: {
        circle: {
          center: { latitude: 13.7563, longitude: 100.5018 },
          radius: 50000,
        },
      },
    }),
  });

  if (!response.ok) throw new Error(`Google Places ${response.status}`);

  const json = (await response.json()) as { places?: GooglePlace[] };
  const places = (json.places ?? [])
    .map(parseGooglePlace)
    .filter((place): place is Place => place !== null)
    .slice(0, limit);

  cache.set(cacheKey, places);
  if (cache.size > 50) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return places;
}
