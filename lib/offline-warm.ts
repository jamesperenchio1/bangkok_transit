import stations from "@/data/stations.json";
import { useSettingsStore } from "@/lib/settings-store";

/**
 * Pre-fetches the basemap for the rail network once, on an idle moment after
 * the first visit, so the map works offline everywhere the app is useful -
 * not only where the user happened to pan. The service worker (app/sw.ts)
 * answers these fetches from / into its CacheFirst OpenFreeMap cache, so
 * this module never stores anything itself.
 *
 * This is what makes the default (MapLibre) map work offline, and why it is the
 * default: Google's tiles cannot be stored, these can.
 *
 * Bounded and polite, and sized to the connection: on Wi-Fi the whole set
 * (the network at overview zooms, plus street level around every station);
 * on mobile data only the overview zooms (~150 tiles, a few MB), so the map
 * is still there offline without a surprise bill; nothing on Data Saver or a
 * slow link. A few requests at a time, and recorded as done so each runs once.
 * Whatever the rider views is cached as they go either way (app/sw.ts).
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// v2: the warm-up now also covers zoom 9, the zoom the map opens at. Without it
// the opening view's tiles were cached only if the service worker already
// controlled the page during the first visit, so offline could open on stations
// over an empty basemap. Bumping re-runs it for installs that did the v1 pass.
export const OFFLINE_DONE_KEY = "bts:map-warm:v2";
/** The lighter pass done on mobile data; the full one (above) later replaces it. */
export const OFFLINE_OVERVIEW_KEY = "bts:map-warm:overview:v1";
const DONE_KEY = OFFLINE_DONE_KEY;
const CONCURRENCY = 4;
/** Whole-network overview zooms (9 is where the map opens), then street-level zoom only around stations. */
const OVERVIEW_ZOOMS = [9, 10, 11, 12, 13];
const DETAIL_ZOOM = 14;
/** Glyph ranges for Latin (0-255) and Thai (3584-3839) labels. */
const GLYPH_RANGES = ["0-255", "3584-3839"];

interface StyleLike {
  sprite?: string;
  glyphs?: string;
  sources?: Record<string, { type?: string; url?: string }>;
  layers?: { layout?: { "text-font"?: string[] } }[];
}

function tileXY(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return [x, y];
}

/** Tile coordinates covering the network's bounding box at zoom z. */
function overviewTiles(z: number): [number, number, number][] {
  const lats = stations.map((s) => s.lat);
  const lons = stations.map((s) => s.lon);
  const [x0, y1] = tileXY(Math.min(...lats), Math.min(...lons), z);
  const [x1, y0] = tileXY(Math.max(...lats), Math.max(...lons), z);
  const out: [number, number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

/** The tile each station sits in, plus its neighbours: a walking-distance ring. */
function detailTiles(): [number, number, number][] {
  const seen = new Set<string>();
  const out: [number, number, number][] = [];
  for (const s of stations) {
    const [x, y] = tileXY(s.lat, s.lon, DETAIL_ZOOM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${x + dx}/${y + dy}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push([DETAIL_ZOOM, x + dx, y + dy]);
        }
      }
    }
  }
  return out;
}

export type WarmMode = "full" | "overview" | "skip";

export interface WarmEnvironment {
  dataSaver: boolean;
  onLine: boolean;
  /** The Network Information API, where the browser has it. */
  connection?: { saveData?: boolean; type?: string; effectiveType?: string };
}

/** How much of the map to download now, given what the connection and the rider allow. */
export function warmMode({ dataSaver, onLine, connection }: WarmEnvironment): WarmMode {
  if (dataSaver || !onLine || connection?.saveData) return "skip";
  // A slow link: not now. It will be tried again on a later visit.
  if (connection?.effectiveType && connection.effectiveType !== "4g") return "skip";
  return connection?.type === "cellular" ? "overview" : "full";
}

function currentWarmMode(): WarmMode {
  const connection = (navigator as Navigator & { connection?: WarmEnvironment["connection"] }).connection;
  return warmMode({ dataSaver: useSettingsStore.getState().settings.dataSaver, onLine: navigator.onLine, connection });
}

async function mapPool<T>(items: T[], run: (item: T) => Promise<void>): Promise<boolean> {
  let failed = false;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await run(item);
      } catch {
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return !failed;
}

async function warm(mode: "full" | "overview"): Promise<boolean> {
  // Same flags as MapLibre's own requests (CORS, no credentials) so the
  // cache entries are reused rather than duplicated.
  // priority "low": this is a background download, and must never queue ahead
  // of a tile the rider's own panning needs.
  const get = async (url: string) => {
    const res = await fetch(url, { mode: "cors", credentials: "omit", priority: "low" });
    if (!res.ok) throw new Error(String(res.status));
    return res;
  };

  const style = (await (await get(STYLE_URL)).json()) as StyleLike;
  const urls: string[] = [];

  if (style.sprite) {
    for (const suffix of ["", "@2x"]) urls.push(`${style.sprite}${suffix}.json`, `${style.sprite}${suffix}.png`);
  }
  if (style.glyphs) {
    const fonts = new Set<string>();
    for (const layer of style.layers ?? []) {
      const stack = layer.layout?.["text-font"];
      if (Array.isArray(stack)) fonts.add(stack.join(","));
    }
    for (const fontstack of fonts)
      for (const range of GLYPH_RANGES)
        urls.push(style.glyphs.replace("{fontstack}", encodeURIComponent(fontstack)).replace("{range}", range));
  }

  const vector = Object.values(style.sources ?? {}).find((s) => s.type === "vector" && s.url);
  if (vector?.url) {
    const tilejson = (await (await get(vector.url)).json()) as { tiles?: string[] };
    const template = tilejson.tiles?.[0];
    if (template) {
      const tiles = [...OVERVIEW_ZOOMS.flatMap(overviewTiles), ...(mode === "full" ? detailTiles() : [])];
      for (const [z, x, y] of tiles)
        urls.push(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
    }
  }

  // Missing tiles (404 in empty ocean/edges) are normal; only a transport
  // failure should leave the job unfinished so it retries next visit.
  const ok = await mapPool(urls, async (url) => {
    const res = await fetch(url, { mode: "cors", credentials: "omit", priority: "low" });
    if (!res.ok && res.status !== 404 && res.status !== 204) throw new Error(String(res.status));
  });
  if (ok) {
    try {
      window.localStorage.setItem(mode === "full" ? DONE_KEY : OFFLINE_OVERVIEW_KEY, String(Date.now()));
    } catch {
      // non-fatal: it will simply run again next visit
    }
  }
  return ok;
}

/** Ask the browser not to evict the cached map/app under storage pressure. */
async function requestPersistence() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // best effort
  }
}

/** Call once from the page. Safe to call repeatedly. */
export function scheduleOfflineWarm(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    if (window.localStorage.getItem(DONE_KEY)) {
      void requestPersistence();
      return;
    }
  } catch {
    // proceed
  }
  const start = async () => {
    const mode = currentWarmMode();
    if (mode === "skip") return;
    // The light pass is done once; only Wi-Fi (the full set) goes further.
    if (mode === "overview" && window.localStorage.getItem(OFFLINE_OVERVIEW_KEY)) return;
    // Wait for the worker to control the page, or the fetches would go
    // straight to the network and never be cached.
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) return;
    await requestPersistence();
    try {
      await warm(mode);
    } catch {
      // offline or upstream hiccup: try again next visit
    }
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  // Called once the map has painted (see HomeClient), and then still waits:
  // well after first paint and the first live-times poll.
  setTimeout(() => (idle ? idle(() => void start(), { timeout: 10_000 }) : void start()), 8_000);
}

/** "Download the map for offline use now" (Settings): ignores the data-saver / cellular checks, because the rider asked. */
export async function warmMapNow(): Promise<void> {
  // Without the service worker in control, fetches go straight to the network
  // and nothing is stored: that is a failure to report, not a success.
  if (!("serviceWorker" in navigator)) throw new Error("no service worker support");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) throw new Error("page not controlled by the service worker yet");
  await requestPersistence();
  if (!(await warm("full"))) throw new Error("some tiles could not be downloaded");
}
