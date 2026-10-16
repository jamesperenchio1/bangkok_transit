import stations from "@/data/stations.json";

/**
 * Pre-fetches the basemap for the rail network once, on an idle moment after
 * the first visit, so the map works offline everywhere the app is useful -
 * not only where the user happened to pan. The service worker (app/sw.ts)
 * answers these fetches from / into its CacheFirst OpenFreeMap cache, so
 * this module never stores anything itself.
 *
 * Bounded and polite: skipped on Data Saver or a slow/cellular-metered
 * connection, a few requests at a time, and recorded as done so it runs once.
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DONE_KEY = "bts:map-warm:v1";
const CONCURRENCY = 4;
/** Whole-network overview zooms, then street-level zoom only around stations. */
const OVERVIEW_ZOOMS = [10, 11, 12, 13];
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

function shouldSkip(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string; effectiveType?: string } })
    .connection;
  if (conn?.saveData) return true;
  if (conn?.type === "cellular") return true;
  if (conn?.effectiveType && conn.effectiveType !== "4g") return true;
  return !navigator.onLine;
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

async function warm(): Promise<void> {
  // Same flags as MapLibre's own requests (CORS, no credentials) so the
  // cache entries are reused rather than duplicated.
  const get = async (url: string) => {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
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
      for (const [z, x, y] of [...OVERVIEW_ZOOMS.flatMap(overviewTiles), ...detailTiles()])
        urls.push(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
    }
  }

  // Missing tiles (404 in empty ocean/edges) are normal; only a transport
  // failure should leave the job unfinished so it retries next visit.
  const ok = await mapPool(urls, async (url) => {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok && res.status !== 404 && res.status !== 204) throw new Error(String(res.status));
  });
  if (ok) {
    try {
      window.localStorage.setItem(DONE_KEY, String(Date.now()));
    } catch {
      // non-fatal: it will simply run again next visit
    }
  }
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
    if (shouldSkip()) return;
    // Wait for the worker to control the page, or the fetches would go
    // straight to the network and never be cached.
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) return;
    await requestPersistence();
    try {
      await warm();
    } catch {
      // offline or upstream hiccup: try again next visit
    }
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  // Well after first paint and the first live-times poll.
  setTimeout(() => (idle ? idle(() => void start(), { timeout: 10_000 }) : void start()), 8_000);
}
