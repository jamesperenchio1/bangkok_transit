// Everything the search-facing pages share: canonical URLs, slugs, line
// names (English + Thai), the curated route pairs, and the JSON-LD builders.
// Pure data in, plain objects out - no React, no runtime-specific imports -
// so the pages, sitemap, llms.txt and tests all agree on one source of truth.
import type { Metadata } from "next";
import { shownCode, stations, stationsByCode, type LineKey, type Station } from "@/data/stations";
import lineSequences from "@/data/line-sequences.json";
import { findPath, type PathResult } from "@/lib/transit-graph";

export const SITE_URL = "https://bangkok-transit.com";
export const SITE_NAME = "Bangkok Transit";
export const SITE_TAGLINE = "Bangkok BTS & MRT Map, Route Planner and Live Train Times";
export const SITE_DESCRIPTION =
  "Free Bangkok rail map: plan BTS, MRT, Airport Rail Link and SRT Red routes with transfers, and see live BTS train arrivals. Works offline. English & ไทย.";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

export interface LineInfo {
  key: LineKey;
  slug: string;
  nameEn: string;
  nameTh: string;
  /** Taken from stations.json so the pages match the map exactly. */
  color: string;
  /** Whether the BTS live-arrivals feed covers this line. */
  live: boolean;
}

// Display names are what riders actually type into a search box ("MRT Pink
// Line"), which is why they differ from the shorter names in stations.json.
const lineColor = (key: LineKey) =>
  stations.flatMap((s) => s.lines).find((l) => l.line === key)?.color ?? "#15803d";

export const LINES: LineInfo[] = ([
  { key: "sukhumvit", slug: "bts-sukhumvit-line", nameEn: "BTS Sukhumvit Line", nameTh: "รถไฟฟ้าบีทีเอส สายสุขุมวิท", live: true },
  { key: "silom", slug: "bts-silom-line", nameEn: "BTS Silom Line", nameTh: "รถไฟฟ้าบีทีเอส สายสีลม", live: true },
  { key: "gold", slug: "bts-gold-line", nameEn: "BTS Gold Line", nameTh: "รถไฟฟ้าบีทีเอส สายสีทอง", live: false },
  { key: "blue", slug: "mrt-blue-line", nameEn: "MRT Blue Line", nameTh: "รถไฟฟ้ามหานคร สายสีน้ำเงิน", live: false },
  { key: "purple", slug: "mrt-purple-line", nameEn: "MRT Purple Line", nameTh: "รถไฟฟ้ามหานคร สายสีม่วง", live: false },
  { key: "yellow", slug: "mrt-yellow-line", nameEn: "MRT Yellow Line", nameTh: "รถไฟฟ้ามหานคร สายสีเหลือง", live: false },
  { key: "pink", slug: "mrt-pink-line", nameEn: "MRT Pink Line", nameTh: "รถไฟฟ้ามหานคร สายสีชมพู", live: false },
  { key: "arl", slug: "airport-rail-link", nameEn: "Airport Rail Link", nameTh: "แอร์พอร์ต เรล ลิงก์", live: false },
  { key: "srtDarkRed", slug: "srt-dark-red-line", nameEn: "SRT Dark Red Line", nameTh: "รถไฟสายสีแดงเข้ม (SRT)", live: false },
  { key: "srtLightRed", slug: "srt-light-red-line", nameEn: "SRT Light Red Line", nameTh: "รถไฟสายสีแดงอ่อน (SRT)", live: false },
] as Omit<LineInfo, "color">[]).map((l) => ({ ...l, color: lineColor(l.key) }));

export const linesByKey = new Map(LINES.map((l) => [l.key, l]));
export const linesBySlug = new Map(LINES.map((l) => [l.slug, l]));

const sequences = lineSequences as Record<LineKey, string[][]>;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `siam-cen`, `mo-chit-n8`: the name for keywords, the code for uniqueness. */
export function stationSlug(s: Station): string {
  return `${slugify(s.nameEn)}-${s.code.toLowerCase()}`;
}

export const stationsBySlug = new Map(stations.map((s) => [stationSlug(s), s]));

export const stationPath = (s: Station) => `/stations/${stationSlug(s)}`;
export const linePath = (l: LineInfo) => `/lines/${l.slug}`;
/** Deep link into the interactive map (the app reads ?from=&to= on load). */
export const mapLink = (from?: Station, to?: Station) => {
  const q = new URLSearchParams();
  if (from) q.set("from", from.code);
  if (to) q.set("to", to.code);
  const s = q.toString();
  return s ? `/?${s}` : "/";
};

/** A line's stations in travel order, each listed once (loops visit twice). */
export function lineStations(key: LineKey): Station[] {
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const segment of sequences[key]) {
    for (const code of segment) {
      const s = stationsByCode.get(code);
      if (s && !seen.has(code)) {
        seen.add(code);
        out.push(s);
      }
    }
  }
  return out;
}

/**
 * A line's stations as runs a train can actually follow. A line with branches
 * (Pink's Muang Thong Thani spur, SRT Red out of Bang Sue) returns one run per
 * branch, each starting at the shared junction, so the junction appears in
 * every branch that uses it. A single-segment line returns one run, with a
 * loop's repeated stop listed once (as `lineStations` does).
 */
export function lineBranches(key: LineKey): Station[][] {
  if (sequences[key].length === 1) return [lineStations(key)];
  return sequences[key].map((segment) =>
    segment.map((code) => stationsByCode.get(code)).filter((s): s is Station => !!s),
  );
}

/** The ends of each segment: the "toward X" names riders see on platforms. */
export function lineTermini(key: LineKey): Station[] {
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const segment of sequences[key]) {
    for (const code of [segment[0], segment[segment.length - 1]]) {
      const s = stationsByCode.get(code);
      if (s && !seen.has(code)) {
        seen.add(code);
        out.push(s);
      }
    }
  }
  return out;
}

/** Stations directly before/after `code` on any line it sits on. */
export function neighbours(code: string): { line: LineInfo; station: Station }[] {
  const out: { line: LineInfo; station: Station }[] = [];
  const seen = new Set<string>();
  for (const info of LINES) {
    for (const segment of sequences[info.key]) {
      segment.forEach((c, i) => {
        if (c !== code) return;
        for (const n of [segment[i - 1], segment[i + 1]]) {
          const s = n ? stationsByCode.get(n) : undefined;
          if (s && !seen.has(`${info.key}:${n}`)) {
            seen.add(`${info.key}:${n}`);
            out.push({ line: info, station: s });
          }
        }
      });
    }
  }
  return out;
}

export function stationLines(s: Station): LineInfo[] {
  return s.lines.map((l) => linesByKey.get(l.line)).filter((l): l is LineInfo => !!l);
}

// ---------------------------------------------------------------------------
// Curated route pages. Every pair of 193 stations would be ~18k near-duplicate
// pages; the hubs below are where riders actually go (airports, interchanges,
// shopping, rail terminals), which keeps each page distinct and useful.
// ---------------------------------------------------------------------------
const HUB_CODES = [
  "CEN", // Siam
  "N8", // Mo Chit
  "E4", // Asok
  "E1", // Chit Lom
  "E5", // Phrom Phong
  "E6", // Thong Lo
  "N3", // Victory Monument
  "S2", // Sala Daeng
  "S6", // Saphan Taksin
  "W1", // National Stadium
  "A08", // Suvarnabhumi Airport
  "A01", // Phaya Thai (ARL)
  "A03", // Makkasan (ARL)
  "RD11", // Don Mueang
  "RD04", // Krung Thep Aphiwat (Bang Sue Grand)
  "BL13", // Hua Lamphong
  "BL14", // Sam Yan
  "BL10", // Sanam Chai
  "BL21", // Phra Ram 9
  "BL28", // Chatuchak Park
  "BL31", // Tao Poon
  "BL26", // Lat Phrao
];

export interface RoutePair {
  slug: string;
  from: Station;
  to: Station;
}

export const routeSlug = (a: Station, b: Station) => `${stationSlug(a)}-to-${stationSlug(b)}`;

function buildRoutePairs(): RoutePair[] {
  const hubs = HUB_CODES.map((c) => stationsByCode.get(c)).filter((s): s is Station => !!s);
  const pairs: RoutePair[] = [];
  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      const from = hubs[i];
      const to = hubs[j];
      // The same physical stop can carry two codes (Siam vs. the interchange
      // twin of a station on another line); skip pairs that aren't a trip.
      if (from.nameEn === to.nameEn) continue;
      if (!findPath(from.code, to.code)) continue;
      pairs.push({ slug: routeSlug(from, to), from, to });
    }
  }
  return pairs;
}

export const routePairs: RoutePair[] = buildRoutePairs();
export const routePairsBySlug = new Map(routePairs.map((p) => [p.slug, p]));

export function describeRoute(path: PathResult): string[] {
  // One sentence per boarded line, e.g. "Ride BTS Sukhumvit Line 5 stops to Asok".
  const steps: string[] = [];
  let i = 1;
  while (i < path.legs.length) {
    const leg = path.legs[i];
    if (leg.mode === "walk") {
      steps.push(`Walk about ${Math.round((leg.walkMeters ?? 0) / 10) * 10} m to ${leg.station.nameEn}.`);
      i++;
      continue;
    }
    const line = leg.line;
    let j = i;
    while (j + 1 < path.legs.length && path.legs[j + 1].mode === "ride" && path.legs[j + 1].service === leg.service) j++;
    const stops = j - i + 1;
    const info = line ? linesByKey.get(line) : undefined;
    const boarding = path.legs[i - 1].boardToward ? path.legs[i - 1] : leg;
    const towards = boarding.boardToward;
    const via = boarding.boardVia;
    steps.push(
      `Take the ${info?.nameEn ?? "train"}${towards ? ` toward ${towards.nameEn}${via ? ` (first stop ${via.nameEn})` : ""}` : ""} for ${stops} ${stops === 1 ? "stop" : "stops"} to ${path.legs[j].station.nameEn}.`,
    );
    i = j + 1;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------
type Json = Record<string, unknown>;

export function breadcrumbLd(items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  };
}

export function siteLd(): Json[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: ["Bangkok Transit Map", "แผนที่รถไฟฟ้ากรุงเทพ"],
      description: SITE_DESCRIPTION,
      inLanguage: ["en", "th"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      applicationCategory: "TravelApplication",
      operatingSystem: "Any (web browser, installable PWA)",
      browserRequirements: "Requires a modern browser with WebGL",
      inLanguage: ["en", "th"],
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "THB" },
      featureList: [
        "Interactive map of BTS, MRT, Airport Rail Link and SRT Red lines",
        "Route planner with line changes and walking transfers",
        "Live BTS train arrivals",
        "Offline-capable installable app",
        "English and Thai",
      ],
      areaServed: { "@type": "City", name: "Bangkok" },
    },
  ];
}

export function stationLd(s: Station): Json {
  return {
    "@context": "https://schema.org",
    "@type": "TrainStation",
    "@id": `${absoluteUrl(stationPath(s))}#station`,
    url: absoluteUrl(stationPath(s)),
    name: s.nameEn,
    alternateName: s.nameTh,
    identifier: shownCode(s),
    geo: { "@type": "GeoCoordinates", latitude: s.lat, longitude: s.lon },
    address: { "@type": "PostalAddress", addressLocality: "Bangkok", addressCountry: "TH" },
    isAccessibleForFree: false,
  };
}

export function lineLd(line: LineInfo, list: Station[], branched = false): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${line.nameEn} stations`,
    numberOfItems: list.length,
    // Positions in a branched line's flat list don't mean "the next stop".
    itemListOrder: branched ? "https://schema.org/ItemListUnordered" : "https://schema.org/ItemListOrderAscending",
    itemListElement: list.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.nameEn,
      url: absoluteUrl(stationPath(s)),
    })),
  };
}

export function routeLd(pair: RoutePair, path: PathResult): Json {
  const steps = describeRoute(path);
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to get from ${pair.from.nameEn} to ${pair.to.nameEn} by BTS, MRT and rail`,
    totalTime: `PT${Math.max(1, Math.round(path.minutes))}M`,
    step: steps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })),
  };
}

export const HOME_FAQ: { q: string; a: string }[] = [
  {
    q: "Which Bangkok rail lines does Bangkok Transit cover?",
    a: `All ${LINES.length} operating rail lines: BTS Sukhumvit, BTS Silom, BTS Gold, MRT Blue, MRT Purple, MRT Yellow, MRT Pink, the Airport Rail Link and the SRT Red Line, ${stations.length} stations in total.`,
  },
  {
    q: "How do I plan a route between two Bangkok stations?",
    a: "Tap a station on the map, choose Start, then tap another and choose Destination. The route shows each line, where to change, the direction to board and an estimated travel time, including walking transfers between stations such as Mo Chit and Chatuchak Park.",
  },
  {
    q: "Does it show live BTS train arrivals?",
    a: "Yes. BTS Sukhumvit and Silom stations show live arrival times. Old readings are labelled as last-known with their age and dropped after 30 minutes. Other lines show the map and routing but not live times.",
  },
  {
    q: "Is Bangkok Transit free, and does it work offline?",
    a: "It is free, needs no account and no download. Install it to your home screen as a web app and the map and route planner keep working without a connection; live arrivals need internet.",
  },
  {
    q: "Is there a Thai version?",
    a: "Yes. Switch between English and Thai (ไทย) with the language button; station names appear in both languages.",
  },
];

export function faqLd(items: { q: string; a: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

const OG_IMAGE = "/og/og-default.png";

/**
 * Metadata for a content page: canonical, Open Graph and Twitter in one place
 * (a page's own `openGraph` replaces the root one wholesale, so the image has
 * to be repeated). The brand suffix is dropped when it would push the title
 * past the ~60 characters search results show.
 */
export function pageMeta(opts: { title: string; description: string; path: string; type?: "website" | "article" }): Metadata {
  const url = absoluteUrl(opts.path);
  const title = opts.title.length + ` | ${SITE_NAME}`.length > 60 ? { absolute: opts.title } : opts.title;
  return {
    title,
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      type: opts.type ?? "website",
      siteName: SITE_NAME,
      url,
      title: opts.title,
      description: opts.description,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME}: BTS, MRT and rail map` }],
    },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description, images: [OG_IMAGE] },
  };
}
