/**
 * One-off build of the station page extras (public/station-details/<code>.json,
 * typed in lib/station-details.ts): photos, exits, accessibility and nearby
 * places for every station. Like scripts/fetch-transit-network.ts this is run
 * by hand when the data needs refreshing, never at build time or runtime.
 *
 * Sources, all free and unauthenticated:
 * - OpenStreetMap via Overpass: the station objects themselves (their
 *   wheelchair/toilets tags and - usefully - their `wikidata` tag, which is
 *   how most stations get matched to Wikidata), entrances/exits, lifts, bus
 *   stops and named places nearby. ODbL - credited on the station page.
 * - Wikidata: Commons category, lead image, Wikipedia article titles,
 *   opening date. For stations whose OSM object has no `wikidata` tag, the
 *   nearest railway-station item with a matching name is used instead.
 * - Wikimedia Commons: photos (from the station's category), with author and
 *   license, which the page shows - CC licenses require the credit.
 * - Wikipedia (EN + TH): the first few sentences of each article.
 *
 * Every response is cached under data/raw/station-details-cache/ (gitignored),
 * so a rerun after a timeout or a 429 only fetches what's missing - Overpass
 * and Wikipedia both rate-limit hard. Delete the cache to refresh everything.
 *
 * Known gaps (check the output by hand, don't trust it blindly):
 * - Exits are assigned to the nearest station, so at walking interchanges
 *   (Asok/Sukhumvit, Mo Chit/Chatuchak Park, ...) a few may land on the
 *   other station. Unnumbered entrances are only counted.
 * - Newer lines (Pink, Yellow, SRT Red) are thinly mapped and photographed.
 *
 * Usage: NODE_USE_ENV_PROXY=1 node --experimental-strip-types scripts/fetch-station-details.ts
 * (NODE_USE_ENV_PROXY only matters behind an HTTPS proxy.)
 */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = path.join(import.meta.dirname, "..");
const CACHE_DIR = path.join(ROOT, "data", "raw", "station-details-cache");
const OUT_DIR = path.join(ROOT, "public", "station-details");
const USER_AGENT = "BangkokTransitApp/0.1 (https://bangkok-transit.com; one-off station data build)";
// Public Overpass instances, tried in turn - any one of them is often busy.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const BBOX = "13.55,100.30,14.10,100.95"; // S,W,N,E - the whole network with margin

const EXIT_RADIUS_M = 300;
const ELEVATOR_RADIUS_M = 200;
const OSM_STATION_RADIUS_M = 400;
const BUS_STOP_RADIUS_M = 200;
const NEARBY_RADIUS_M = 600;
const MAX_NEARBY = 8;
const MAX_PHOTOS = 6;

interface Station {
  code: string;
  nameEn: string;
  nameTh: string;
  lat: number;
  lon: number;
}

type Tags = Record<string, string>;
interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Tags;
}

// ---------------------------------------------------------------- fetching

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8")) as T;
  const value = await fetcher();
  await writeFile(file, JSON.stringify(value));
  return value;
}

/** fetch + JSON with retries; 429s and gateway errors back off and retry. */
async function getJson(url: string, init: RequestInit = {}, attempts = 6): Promise<unknown> {
  let delay = 5_000;
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
        signal: AbortSignal.timeout(240_000),
      });
      if (res.ok) return await res.json();
      if (![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`${res.status} ${url}`);
      if (i >= attempts) throw new Error(`${res.status} after ${attempts} tries: ${url}`);
      console.warn(`  ${res.status}, retrying in ${delay / 1000}s`);
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`  ${(err as Error).message.slice(0, 120)}, retrying in ${delay / 1000}s`);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 120_000);
  }
}

async function overpass(key: string, body: string): Promise<OsmElement[]> {
  const data = await cached(key, async () => {
    console.log(`Overpass: ${key}`);
    const query = `[out:json][timeout:180][bbox:${BBOX}];${body}`;
    let lastError: unknown;
    for (let round = 0; round < 8; round++) {
      for (const endpoint of OVERPASS) {
        try {
          return await getJson(`${endpoint}?${new URLSearchParams({ data: query })}`, {}, 2);
        } catch (err) {
          lastError = err;
          console.warn(`  ${endpoint} failed, trying the next one`);
        }
      }
    }
    throw lastError;
  });
  return (data as { elements: OsmElement[] }).elements;
}

function hashKey(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** MediaWiki action API (Wikipedia, Commons, Wikidata), cached per request. */
async function mediawiki(host: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const url = `https://${host}/w/api.php?${query}`;
  return cached(`mw-${host}-${hashKey(url)}`, async () => {
    // API errors come back as HTTP 200 - retry them (maxlag means "busy,
    // come back shortly") rather than caching an error as the answer.
    for (let attempt = 1; ; attempt++) {
      await sleep(400); // stay well under every Wikimedia rate limit
      const res = (await getJson(url)) as { error?: { code: string; info: string } };
      if (!res.error) return res;
      if (attempt >= 6) throw new Error(`${host}: ${res.error.code} ${res.error.info}`);
      console.warn(`  ${host}: ${res.error.code}, retrying`);
      await sleep(5_000 * attempt);
    }
  });
}

// ---------------------------------------------------------------- geometry

function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function point(el: OsmElement): { lat: number; lon: number } | null {
  if (el.lat !== undefined && el.lon !== undefined) return { lat: el.lat, lon: el.lon };
  return el.center ?? null;
}

/** The station nearest to `p`, if within `radius`. */
function nearestStation(stations: Station[], p: { lat: number; lon: number }, radius: number) {
  let best: Station | null = null;
  let bestM = radius;
  for (const s of stations) {
    const m = meters(s, p);
    if (m <= bestM) {
      best = s;
      bestM = m;
    }
  }
  return best;
}

// ---------------------------------------------------------------- matching

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/^สถานี/, "")
    .replace(/\b(bts|mrt|srt|arl|station|skytrain|metro|line|airport rail link)\b/g, "")
    .replace(/[\s.\-()'’]+/g, "");
}

function namesMatch(station: Station, ...names: (string | undefined)[]): boolean {
  const ours = [normalizeName(station.nameEn), normalizeName(station.nameTh)].filter(Boolean);
  return names.some((n) => {
    if (!n) return false;
    const theirs = normalizeName(n);
    return theirs.length > 0 && ours.some((o) => o === theirs || o.includes(theirs) || theirs.includes(o));
  });
}

// ---------------------------------------------------------------- places

function placeKind(tags: Tags): string | null {
  if (tags.shop === "mall" || tags.shop === "department_store") return "mall";
  if (tags.amenity === "ferry_terminal") return "pier";
  if (tags.amenity === "hospital") return "hospital";
  if (tags.amenity === "university") return "university";
  if (tags.amenity === "marketplace") return "market";
  if (tags.tourism === "museum") return "museum";
  // Temples (wat) only - not every roadside shrine.
  if (tags.amenity === "place_of_worship") return /^วัด/.test(tags.name ?? "") || /^Wat /.test(tags["name:en"] ?? "") ? "temple" : null;
  if (tags.leisure === "park") return "park";
  if (tags.historic) return "landmark";
  if (tags.tourism) return "attraction";
  return null;
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 80) : undefined;
}

/**
 * Wikipedia leads open with a parenthetical of other scripts and
 * pronunciation - "(Thai: สถานีสยาม, RTGS: Sathani Sayam, pronounced [...])"
 * or "(อังกฤษ: Siam station; รหัส: CEN)" - noise on a phone screen.
 */
function cleanSummary(text: string): string {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s*\((?:Thai|อังกฤษ)[^()]*(?:\([^()]*\)[^()]*)*\)/, "")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function sortExitLabel(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "en", { numeric: true });
}

// ---------------------------------------------------------------- main

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const stations = JSON.parse(await readFile(path.join(ROOT, "data", "stations.json"), "utf8")) as Station[];

  // --- OpenStreetMap --------------------------------------------------
  const transit = await overpass(
    "osm-transit",
    `(nwr[railway=station];nwr[public_transport=station];node[railway=subway_entrance];` +
      `node[railway=train_station_entrance];node[highway=elevator];);out center tags;`,
  );
  const busStops = await overpass("osm-bus-stops", `node[highway=bus_stop];out skel;`);
  // One query per kind of place: a single combined query is too heavy for
  // the public instances and times out.
  const placeQueries: Record<string, string> = {
    malls: `nwr[shop~"^(mall|department_store)$"][name];`,
    tourism: `nwr[tourism~"^(attraction|museum|zoo|theme_park)$"][name];`,
    amenities: `nwr[amenity~"^(hospital|university|marketplace|ferry_terminal)$"][name];`,
    parks: `nwr[leisure=park][name];`,
    temples: `nwr[amenity=place_of_worship][religion=buddhist][name];`,
    historic: `nwr[historic~"^(monument|palace|castle|memorial)$"][name];`,
  };
  const places: OsmElement[] = [];
  for (const [key, body] of Object.entries(placeQueries)) {
    places.push(...(await overpass(`osm-places-${key}`, `(${body});out center tags;`)));
  }

  const osmStation = new Map<string, OsmElement>();
  const exits = new Map<string, Map<string, StationExitOut>>();
  const unlabeled = new Map<string, number>();
  const elevators = new Map<string, number>();
  type StationExitOut = { label: string; elevator?: boolean };

  // The station's own OSM object: nearest one whose name or ref matches.
  for (const s of stations) {
    let best: OsmElement | null = null;
    let bestM = OSM_STATION_RADIUS_M;
    for (const el of transit) {
      const t = el.tags ?? {};
      if (t.railway !== "station" && t.public_transport !== "station") continue;
      const p = point(el);
      if (!p) continue;
      const m = meters(s, p);
      const refMatch = t.ref?.split(";").includes(s.code);
      if (m <= bestM && (refMatch || namesMatch(s, t.name, t["name:en"], t["name:th"]))) {
        // A real ref match always beats a name match a bit closer.
        best = el;
        bestM = refMatch ? 0 : m;
      }
    }
    if (best) osmStation.set(s.code, best);
  }

  for (const el of transit) {
    const t = el.tags ?? {};
    const p = point(el);
    if (!p) continue;
    const isEntrance = t.railway === "subway_entrance" || t.railway === "train_station_entrance";
    const isLift =
      t.highway === "elevator" || /elevator|lift|ลิฟต์/i.test(t.name ?? "") ||
      (isEntrance && (t.wheelchair === "yes" || t.wheelchair === "designated"));
    if (isEntrance) {
      const s = nearestStation(stations, p, EXIT_RADIUS_M);
      if (!s) continue;
      const raw = (t.ref ?? (t.name && t.name.length <= 4 ? t.name : undefined))?.trim();
      if (raw) {
        const byLabel = exits.get(s.code) ?? new Map();
        const prev = byLabel.get(raw);
        byLabel.set(raw, { label: raw, elevator: prev?.elevator || (isLift ? true : undefined) });
        exits.set(s.code, byLabel);
      } else if (!isLift) {
        unlabeled.set(s.code, (unlabeled.get(s.code) ?? 0) + 1);
      }
    }
    if (isLift) {
      const s = nearestStation(stations, p, ELEVATOR_RADIUS_M);
      if (s) elevators.set(s.code, (elevators.get(s.code) ?? 0) + 1);
    }
  }

  const busCount = new Map<string, number>();
  for (const el of busStops) {
    const p = point(el);
    if (!p) continue;
    for (const s of stations) {
      if (meters(s, p) <= BUS_STOP_RADIUS_M) busCount.set(s.code, (busCount.get(s.code) ?? 0) + 1);
    }
  }

  // --- Wikidata -------------------------------------------------------
  // Fallback matches for stations whose OSM object has no wikidata tag.
  const sparql = (await cached("wikidata-stations", async () => {
    console.log("Wikidata: stations in the area");
    const query = `SELECT DISTINCT ?item ?label ?thLabel ?coord WHERE {
      SERVICE wikibase:box { ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerSouthWest "Point(100.30 13.55)"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerNorthEast "Point(100.95 14.10)"^^geo:wktLiteral . }
      ?item wdt:P31/wdt:P279* wd:Q55488 .
      OPTIONAL { ?item rdfs:label ?label FILTER(lang(?label)="en") }
      OPTIONAL { ?item rdfs:label ?thLabel FILTER(lang(?thLabel)="th") }
    }`;
    return getJson(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json" },
    });
  })) as { results: { bindings: Record<string, { value: string }>[] } };
  const wdCandidates = sparql.results.bindings.map((b) => {
    const [lon, lat] = b.coord.value.replace(/^Point\(|\)$/g, "").split(" ").map(Number);
    return { id: b.item.value.split("/").pop()!, label: b.label?.value, th: b.thLabel?.value, lat, lon };
  });

  const wikidataId = new Map<string, string>();
  for (const s of stations) {
    const tagged = osmStation.get(s.code)?.tags?.wikidata;
    if (tagged && /^Q\d+$/.test(tagged)) {
      wikidataId.set(s.code, tagged);
      continue;
    }
    let best: { id: string; m: number } | null = null;
    for (const c of wdCandidates) {
      const m = meters(s, c);
      if (m <= 500 && namesMatch(s, c.label, c.th) && (!best || m < best.m)) best = { id: c.id, m };
    }
    if (best) wikidataId.set(s.code, best.id);
  }

  const entities = new Map<string, any>();
  const ids = [...new Set(wikidataId.values())];
  for (let i = 0; i < ids.length; i += 50) {
    const res = await mediawiki("www.wikidata.org", {
      action: "wbgetentities",
      ids: ids.slice(i, i + 50).join("|"),
      props: "claims|sitelinks",
      sitefilter: "enwiki|thwiki",
    });
    for (const [id, e] of Object.entries(res.entities ?? {})) entities.set(id, e);
  }
  const claim = (e: any, prop: string) => e?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;

  // --- Wikipedia summaries -------------------------------------------
  const summaries = { en: new Map<string, string>(), th: new Map<string, string>() };
  for (const lang of ["en", "th"] as const) {
    const titles = [...new Set([...entities.values()].map((e) => e.sitelinks?.[`${lang}wiki`]?.title).filter(Boolean))];
    for (let i = 0; i < titles.length; i += 20) {
      try {
        const res = await mediawiki(`${lang}.wikipedia.org`, {
          action: "query",
          prop: "extracts",
          exintro: "1",
          explaintext: "1",
          exsentences: "3",
          exlimit: "20",
          redirects: "1",
          titles: titles.slice(i, i + 20).join("|"),
        });
        const redirects = new Map<string, string>(
          [...(res.query?.normalized ?? []), ...(res.query?.redirects ?? [])].map((r: any) => [r.to, r.from]),
        );
        for (const page of res.query?.pages ?? []) {
          if (!page.extract) continue;
          const original = redirects.get(page.title) ?? page.title;
          summaries[lang].set(original, cleanSummary(page.extract));
        }
      } catch (err) {
        console.warn(`Wikipedia ${lang} summaries skipped for a batch: ${(err as Error).message}`);
      }
    }
  }

  // --- Commons photos -------------------------------------------------
  async function photosFor(e: any) {
    const files: string[] = [];
    const lead = claim(e, "P18");
    if (typeof lead === "string") files.push(`File:${lead}`);
    const category = claim(e, "P373");
    if (typeof category === "string") {
      const res = await mediawiki("commons.wikimedia.org", {
        action: "query",
        list: "categorymembers",
        cmtitle: `Category:${category}`,
        cmtype: "file",
        cmlimit: "25",
      });
      for (const m of res.query?.categorymembers ?? []) {
        if (/\.(jpe?g|png|webp)$/i.test(m.title) && !files.includes(m.title.replace(/_/g, " "))) {
          files.push(m.title);
        }
      }
    }
    const picked = files.slice(0, MAX_PHOTOS);
    if (!picked.length) return [];
    const res = await mediawiki("commons.wikimedia.org", {
      action: "query",
      prop: "imageinfo",
      iiprop: "url|extmetadata|mime",
      iiurlwidth: "800",
      iiextmetadatafilter: "Artist|LicenseShortName",
      titles: picked.join("|"),
    });
    const pages = (res.query?.pages ?? []) as any[];
    const normalized = new Map<string, string>((res.query?.normalized ?? []).map((n: any) => [n.to, n.from]));
    // Keep the lead image first, as Wikidata chose it.
    const order = (title: string) => picked.indexOf(normalized.get(title) ?? title);
    return pages
      .filter((p) => p.imageinfo?.[0]?.thumburl && /^image\/(jpeg|png|webp)$/.test(p.imageinfo[0].mime))
      .sort((a, b) => order(a.title) - order(b.title))
      .map((p) => {
        const info = p.imageinfo[0];
        return {
          thumb: info.thumburl as string,
          page: info.descriptionurl as string,
          author: stripHtml(info.extmetadata?.Artist?.value),
          license: stripHtml(info.extmetadata?.LicenseShortName?.value),
        };
      });
  }

  // --- Assemble -------------------------------------------------------
  // Everything is gathered first and only written at the end, so a run that
  // dies halfway leaves the previous output intact.
  const outputs: { code: string; details: unknown }[] = [];
  let withPhotos = 0;
  let withExits = 0;
  let withSummary = 0;
  for (const s of stations) {
    const qid = wikidataId.get(s.code);
    const e = qid ? entities.get(qid) : undefined;
    const enTitle = e?.sitelinks?.enwiki?.title as string | undefined;
    const thTitle = e?.sitelinks?.thwiki?.title as string | undefined;
    const opened = claim(e, "P1619")?.time as string | undefined;
    const tags = osmStation.get(s.code)?.tags ?? {};

    const nearby = places
      .flatMap((el) => {
        const t = el.tags ?? {};
        const p = point(el);
        const kind = placeKind(t);
        if (!p || !kind) return [];
        // Loosely-tagged kinds are full of noise (individual shops, private
        // joke "attractions"); keep only the ones notable enough to have a
        // Wikidata/Wikipedia entry.
        const notable = Boolean(t.wikidata || t.wikipedia);
        if ((t.tourism === "attraction" || t.shop === "department_store") && !notable) return [];
        // Skip the station itself and other stations' buildings.
        if (t.building === "train_station" || t.railway || t.public_transport) return [];
        const m = meters(s, p);
        if (m > NEARBY_RADIUS_M) return [];
        const nameTh = t["name:th"] ?? t.name;
        const nameEn = t["name:en"] ?? (/[฀-๿]/.test(t.name) ? undefined : t.name);
        if (!nameTh && !nameEn) return [];
        return [{ nameEn: nameEn ?? nameTh!, nameTh: nameTh ?? nameEn!, kind, meters: Math.round(m / 10) * 10, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) }];
      })
      .sort((a, b) => a.meters - b.meters)
      // One entry per name - a mall is often mapped as both a node and an area.
      .filter((p, i, all) => all.findIndex((q) => q.nameEn === p.nameEn) === i)
      .slice(0, MAX_NEARBY);

    let photos: Awaited<ReturnType<typeof photosFor>> = [];
    try {
      photos = e ? await photosFor(e) : [];
    } catch (err) {
      // Not cached, so the next run tries this station's photos again.
      console.warn(`Photos skipped for ${s.code}: ${(err as Error).message}`);
    }
    const exitList = [...(exits.get(s.code)?.values() ?? [])].sort((a, b) => sortExitLabel(a.label, b.label));
    const wheelchair = ["yes", "limited", "no"].includes(tags.wheelchair) ? tags.wheelchair : undefined;

    const details = {
      code: s.code,
      wikidata: qid,
      wikipedia: enTitle || thTitle ? { en: enTitle, th: thTitle } : undefined,
      summary:
        (enTitle && summaries.en.get(enTitle)) || (thTitle && summaries.th.get(thTitle))
          ? { en: enTitle ? summaries.en.get(enTitle) : undefined, th: thTitle ? summaries.th.get(thTitle) : undefined }
          : undefined,
      // Wikidata times look like "+2004-07-03T00:00:00Z"; month/day are 00 when unknown.
      opened: opened?.replace(/^\+/, "").slice(0, 10).replace(/-00(-00)?$/, "").replace(/-00$/, ""),
      photos,
      exits: exitList,
      unlabeledExits: unlabeled.get(s.code) ?? 0,
      elevators: elevators.get(s.code) ?? 0,
      wheelchair,
      toilets: tags.toilets === "yes" ? true : tags.toilets === "no" ? false : undefined,
      accessibleToilet:
        tags["toilets:wheelchair"] === "yes" ? true : tags["toilets:wheelchair"] === "no" ? false : undefined,
      busStops: busCount.get(s.code) ?? 0,
      nearby,
    };
    if (photos.length) withPhotos++;
    if (exitList.length) withExits++;
    if (details.summary) withSummary++;
    outputs.push({ code: s.code, details });
  }
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const { code, details } of outputs) {
    await writeFile(path.join(OUT_DIR, `${code}.json`), JSON.stringify(details) + "\n");
  }
  console.log(
    `${stations.length} stations: ${wikidataId.size} matched to Wikidata, ${withPhotos} with photos, ` +
      `${withExits} with numbered exits, ${withSummary} with a Wikipedia summary.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
