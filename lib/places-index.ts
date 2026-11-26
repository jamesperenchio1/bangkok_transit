import placesFile from "@/data/places.json";
import { stationsByCode } from "@/data/stations";
import type { Place } from "@/lib/google-places";

/**
 * A place from the bundled `data/places.json` (OpenStreetMap-derived). The
 * file is generated offline, so searching it costs nothing: no request, no
 * Google billing, and it answers on the first keystroke even offline. Google
 * is only the fallback for what this list does not know (see
 * components/StationSearch.tsx).
 */
interface LocalPlace {
  id: string;
  name: string;
  nameTh?: string;
  kind: string;
  lat: number;
  lon: number;
  /** Internal station id of the station this place is nearest to. */
  stationCode: string;
  /** Walking-ish distance to that station, in metres. */
  meters: number;
}

const rawPlaces = (placesFile as { places?: LocalPlace[] }).places ?? [];

/** Lowercase and drop spaces, dots, hyphens and apostrophes: "Icon Siam" and
 * "ไอคอนสยาม" both normalise predictably, and (toLowerCase is a no-op on Thai). */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s.\-'’]+/g, "");
}

/**
 * Names riders type that do not appear verbatim in OSM names: airport codes,
 * and the English habit of "icon siam" vs "ICONSIAM". Keys and values are
 * already normalised; matching either side adds the other as a search term.
 */
const ALIASES: Record<string, string[]> = {
  bkk: ["suvarnabhumi", "สุวรรณภูมิ"],
  suvarnabhumi: ["bkk"],
  dmk: ["donmueang", "ดอนเมือง"],
  donmueang: ["dmk"],
  chatuchak: ["จตุจักร"],
  iconsiam: ["ไอคอนสยาม"],
  khaosan: ["ข้าวสาร"],
};

interface IndexedPlace {
  place: LocalPlace;
  /** Every normalised name to match against, plus whether it came from an alias. */
  names: { text: string; alias: boolean }[];
}

// Normalised once at module load: the file is static and search runs on every
// keystroke, so nothing here should be recomputed per character.
const index: IndexedPlace[] = rawPlaces
  .filter(
    (p) =>
      typeof p?.id === "string" &&
      typeof p?.name === "string" &&
      p.name.trim().length > 0 &&
      typeof p.lat === "number" &&
      typeof p.lon === "number",
  )
  .map((place) => {
    const direct = [place.name, place.nameTh].filter((n): n is string => typeof n === "string" && n.length > 0);
    return {
      place,
      names: direct.map((text) => ({ text: normalize(text), alias: false })),
    };
  });

/** The query itself plus any alias expansions, normalised, tagged by source. */
function queryTerms(query: string): { text: string; alias: boolean }[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[.\-'’]+/g, ""))
    .filter(Boolean);
  const whole = tokens.join("");
  const terms = new Map<string, boolean>();
  if (whole) terms.set(whole, false);
  for (const token of tokens) {
    if (token) terms.set(token, false);
    for (const alias of ALIASES[token] ?? []) terms.set(normalize(alias), true);
  }
  // "icon siam" normalises to "iconsiam", which is an alias key of its own.
  if (whole) {
    for (const alias of ALIASES[whole] ?? []) terms.set(normalize(alias), true);
  }
  return [...terms].map(([text, alias]) => ({ text, alias }));
}

/** Lower is better: exact name, then prefix, then anywhere in the name. */
function matchScore(names: IndexedPlace["names"], terms: { text: string; alias: boolean }[]): number | null {
  let best: number | null = null;
  for (const name of names) {
    for (const term of terms) {
      let score: number;
      if (name.text === term.text) score = 0;
      else if (name.text.startsWith(term.text)) score = 1;
      else if (name.text.includes(term.text)) score = 2;
      else continue;
      // An alias hit still ranks below a direct hit of the same quality.
      if (term.alias) score += 2;
      if (best === null || score < best) best = score;
    }
  }
  return best;
}

/** Human labels for the OSM tags the fetch script keeps. */
const KIND_LABELS: Record<string, { en: string; th: string }> = {
  airport: { en: "Airport", th: "สนามบิน" },
  attraction: { en: "Attraction", th: "สถานที่ท่องเที่ยว" },
  hospital: { en: "Hospital", th: "โรงพยาบาล" },
  mall: { en: "Shopping mall", th: "ห้างสรรพสินค้า" },
  market: { en: "Market", th: "ตลาด" },
  park: { en: "Park", th: "สวนสาธารณะ" },
  university: { en: "University", th: "มหาวิทยาลัย" },
};

/** OSM tags are lowercase machine values ("mall"); people should not see them raw. */
export function placeKindLabel(kind: string, lang: "en" | "th" = "en"): string {
  return KIND_LABELS[kind]?.[lang] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The shape the map, results list and routing already speak. */
function toPlace(place: LocalPlace, lang: "en" | "th" = "en"): Place {
  const station = stationsByCode.get(place.stationCode);
  const kind = typeof place.kind === "string" ? placeKindLabel(place.kind, lang) : "";
  return {
    // The prefix keeps bundled ids apart from Google's, both in recents and
    // when the two result groups are merged.
    id: `local:${place.id}`,
    name: place.name,
    detail: station ? `Near ${station.nameEn}` : kind,
    kind,
    lat: place.lat,
    lon: place.lon,
  };
}

/**
 * Bundled places matching `query`, synchronously. Exact and prefix matches
 * come first, then substring matches, then sorted by distance to their
 * station so the most useful one is the one nearest the top.
 */
export function searchLocalPlaces(query: string, limit = 8, lang: "en" | "th" = "en"): Place[] {
  const trimmed = query.trim();
  if (!trimmed || limit <= 0) return [];
  const terms = queryTerms(trimmed);
  const matches: { place: LocalPlace; score: number }[] = [];
  for (const entry of index) {
    const score = matchScore(entry.names, terms);
    if (score !== null) matches.push({ place: entry.place, score });
  }
  matches.sort(
    (a, b) =>
      a.score - b.score ||
      (a.place.meters ?? Infinity) - (b.place.meters ?? Infinity) ||
      a.place.name.localeCompare(b.place.name),
  );
  return matches.slice(0, limit).map(({ place }) => toPlace(place, lang));
}

/** Places nearest one station, closest first (station pages show the top few). */
export function placesNearStation(
  stationCode: string,
  limit = 6,
  lang: "en" | "th" = "en",
): { place: Place; meters: number }[] {
  return rawPlaces
    .filter((p) => p.stationCode === stationCode && typeof p.meters === "number")
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit)
    .map((place) => ({ place: toPlace(place, lang), meters: place.meters }));
}
