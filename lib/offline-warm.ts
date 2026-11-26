import stations from "@/data/stations.json";
import { isDarkTheme, mapStyleUrl } from "@/lib/map-style";
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

// v2: the warm-up now also covers zoom 9, the zoom the map opens at. Without it
// the opening view's tiles were cached only if the service worker already
// controlled the page during the first visit, so offline could open on stations
// over an empty basemap. Bumping re-runs it for installs that did the v1 pass.
// The theme's style is warmed along with the tiles (see warm()): the light and
// dark styles share one tile source and sprite, so the key still stands for
// both - an install that warmed v2 only lacks the dark style JSON, a few KB.
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
/**
 * Fontstacks our own layers name (station names, train labels). The basemap
 * style may not list them - the dark style only names Noto Sans Regular - and
 * without them the station names have no glyphs offline.
 */
const OWN_FONTSTACKS = ["Noto Sans Bold"];

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
  connection?: {
    saveData?: boolean;
    type?: string;
    effectiveType?: string;
    downlink?: number;
    addEventListener?: (type: "change", listener: () => void) => void;
  };
}

/** How much of the map to download now, given what the connection and the rider allow. */
export function warmMode({ dataSaver, onLine, connection }: WarmEnvironment): WarmMode {
  if (dataSaver || !onLine || connection?.saveData) return "skip";
  // A slow link: not now. It will be tried again on a later visit.
  if (connection?.effectiveType && connection.effectiveType !== "4g") return "skip";
  return connection?.type === "cellular" ? "overview" : "full";
}

/**
 * Quick and unmetered enough for the whole set (the later upgrade of a light
 * pass). Positive evidence only: a Wi-Fi link, or 4G with a decent downlink.
 * Unlike warmMode's default, an unknown connection does not count, because
 * this one may spend a rider's data allowance without them asking again.
 */
export function canWarmFully(connection?: WarmEnvironment["connection"]): boolean {
  if (!connection || connection.saveData) return false;
  if (connection.type === "wifi" || connection.type === "ethernet") return true;
  // Chrome fills `downlink` in Mbps whenever it names an effectiveType; a
  // missing one (Safari has no Network Information API at all) is no evidence.
  return connection.effectiveType === "4g" && (connection.downlink ?? 0) >= 1.5;
}

/** One step of a download, as reported to the caller after each request finishes. */
export interface WarmProgress {
  /** Requests finished so far - a failed one still finished. */
  done: number;
  total: number;
  /** The part still being downloaded: the whole-network zooms, or street level. */
  phase: "overview" | "detail";
}

export interface WarmSummary {
  total: number;
  /** Every request that finished, successful or not (see `failed`). */
  done: number;
  failed: number;
  /** Whether the browser agreed to keep the cached map on this device (unsupported browsers say false). */
  persisted: boolean;
}

function currentConnection(): WarmEnvironment["connection"] | undefined {
  return (navigator as Navigator & { connection?: WarmEnvironment["connection"] }).connection;
}

function currentWarmMode(): WarmMode {
  return warmMode({ dataSaver: useSettingsStore.getState().settings.dataSaver, onLine: navigator.onLine, connection: currentConnection() });
}

/** Runs `run` over `items`, CONCURRENCY at a time; returns how many threw. */
async function mapPool<T>(items: T[], run: (item: T) => Promise<void>): Promise<number> {
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await run(item);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return failed;
}

/** One file to fetch, tagged with the part of the map it belongs to so progress can name it. */
interface WarmRequest {
  url: string;
  phase: WarmProgress["phase"];
}

/** The progress-free part of the summary; persistence is about the whole pass (see warmMapNow). */
type WarmResult = Omit<WarmSummary, "persisted">;

/** localStorage throws in some privacy modes; a missed marker only means a re-run next visit. */
function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // non-fatal: it will simply run again next visit
  }
}

async function warm(mode: "full" | "overview", onProgress?: (progress: WarmProgress) => void): Promise<WarmResult> {
  // Same flags as MapLibre's own requests (CORS, no credentials) so the
  // cache entries are reused rather than duplicated.
  // priority "low": this is a background download, and must never queue ahead
  // of a tile the rider's own panning needs.
  const get = async (url: string) => {
    const res = await fetch(url, { mode: "cors", credentials: "omit", priority: "low" });
    if (!res.ok) throw new Error(String(res.status));
    return res;
  };

  // The style of the theme in use (dark at night). Both styles share one vector
  // tile source and one sprite, so the tiles below are the same either way.
  const dark = isDarkTheme();
  const style = (await (await get(mapStyleUrl(dark))).json()) as StyleLike;
  // The other theme's style JSON is a few KB and comes from the same host; with
  // it cached too, switching theme while offline still gets a real basemap
  // instead of the plain fallback ground. An extra, so a failure is ignored.
  try {
    await get(mapStyleUrl(!dark));
  } catch {
    // not required for the active theme
  }
  const urls: WarmRequest[] = [];

  if (style.sprite) {
    for (const suffix of ["", "@2x"])
      urls.push({ url: `${style.sprite}${suffix}.json`, phase: "overview" }, { url: `${style.sprite}${suffix}.png`, phase: "overview" });
  }
  if (style.glyphs) {
    const fonts = new Set<string>(OWN_FONTSTACKS);
    for (const layer of style.layers ?? []) {
      const stack = layer.layout?.["text-font"];
      if (Array.isArray(stack)) fonts.add(stack.join(","));
    }
    for (const fontstack of fonts)
      for (const range of GLYPH_RANGES)
        urls.push({
          url: style.glyphs.replace("{fontstack}", encodeURIComponent(fontstack)).replace("{range}", range),
          phase: "overview",
        });
  }

  const vector = Object.values(style.sources ?? {}).find((s) => s.type === "vector" && s.url);
  if (vector?.url) {
    const tilejson = (await (await get(vector.url)).json()) as { tiles?: string[] };
    const template = tilejson.tiles?.[0];
    if (template) {
      const tileUrl = ([z, x, y]: [number, number, number]) =>
        template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      // Overview first, then street level, so progress moves through the map
      // the way it is built: the whole network, then around every station.
      for (const tile of OVERVIEW_ZOOMS.flatMap(overviewTiles)) urls.push({ url: tileUrl(tile), phase: "overview" });
      if (mode === "full") for (const tile of detailTiles()) urls.push({ url: tileUrl(tile), phase: "detail" });
    }
  }

  // Progress is counted, never guessed: one step per request that actually
  // finished - including a tile that 404s (empty sea/edges) and one that fails.
  const total = urls.length;
  // The label names the part that still has work, not the request that just
  // finished: CONCURRENCY requests are in flight, so an overview tile can land
  // after a detail one, and a label that flipped back would flicker.
  const firstDetail = urls.findIndex((request) => request.phase === "detail");
  const overviewCount = firstDetail === -1 ? total : firstDetail;
  let done = 0;
  // Missing tiles (404 in empty ocean/edges) are normal; only a transport
  // failure should leave the job unfinished so it retries next visit.
  const failed = await mapPool(urls, async (request) => {
    try {
      const res = await fetch(request.url, { mode: "cors", credentials: "omit", priority: "low" });
      if (!res.ok && res.status !== 404 && res.status !== 204) throw new Error(String(res.status));
    } finally {
      done += 1;
      const phase = firstDetail === -1 || done < overviewCount ? "overview" : "detail";
      onProgress?.({ done, total, phase });
    }
  });
  if (failed === 0) writeKey(mode === "full" ? DONE_KEY : OFFLINE_OVERVIEW_KEY, String(Date.now()));
  return { total, done, failed };
}

/** Ask the browser not to evict the cached map/app under storage pressure. True when it agreed. */
async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * One warm at a time per mode. A tap in Settings and the automatic pass can
 * otherwise both fetch the same few hundred tiles; a second caller for the
 * same mode joins the running one and receives its progress from then on.
 */
let activeWarm: { mode: "full" | "overview"; listeners: Set<(progress: WarmProgress) => void>; promise: Promise<WarmResult> } | null =
  null;

function runWarm(mode: "full" | "overview", onProgress?: (progress: WarmProgress) => void): Promise<WarmResult> {
  if (activeWarm && activeWarm.mode === mode) {
    if (onProgress) activeWarm.listeners.add(onProgress);
    return activeWarm.promise;
  }
  const listeners = new Set<(progress: WarmProgress) => void>();
  if (onProgress) listeners.add(onProgress);
  const promise = warm(mode, (progress) => {
    for (const listener of listeners) {
      // A UI callback must never be able to fail the download itself.
      try {
        listener(progress);
      } catch {
        // ignore
      }
    }
  }).finally(() => {
    if (activeWarm?.promise === promise) activeWarm = null;
  });
  activeWarm = { mode, listeners, promise };
  return promise;
}

/** The light pass was done on mobile data: add the street-level tiles once an unmetered link shows up. */
const UPGRADE_KEY = "bts:map-warm:upgrade:v1";
/** At most once a day: each pass only fetches what the cache is missing, but it is still hundreds of requests. */
const UPGRADE_EVERY_MS = 24 * 60 * 60 * 1000;
/** Give the map and the first tiles the link, then look at what is left to download. */
const UPGRADE_CHECK_DELAY_MS = 20_000;

function upgradeFullWarm(): void {
  void (async () => {
    try {
      // Same gate as the first pass: only a controlling worker caches these.
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) return;
      await requestPersistence();
      await runWarm("full");
    } catch {
      // offline or upstream hiccup: a later visit may succeed
    }
  })();
}

/**
 * Watches for a better connection after a light pass. Cheap and passive: it
 * only listens, and once it has upgraded (or tried) it stops for a day. Never
 * runs on a metered or slow link, and never blocks the map - it starts only
 * from scheduleOfflineWarm, which the page calls after the map has painted.
 */
function watchForFullWarm(): void {
  const connection = currentConnection();
  if (!connection?.addEventListener) return;
  let started = false;
  const check = () => {
    if (started || activeWarm) return;
    // Only the light pass is waiting to be completed - and only if the rider
    // has not deleted the map since (that clears both markers).
    if (readKey(DONE_KEY) || !readKey(OFFLINE_OVERVIEW_KEY)) return;
    if (!canWarmFully(currentConnection())) return;
    if (Date.now() - Number(readKey(UPGRADE_KEY) ?? 0) < UPGRADE_EVERY_MS) return;
    started = true;
    writeKey(UPGRADE_KEY, String(Date.now()));
    // Same rule as every other background job: wait for an idle moment.
    whenIdle(upgradeFullWarm, 0);
  };
  connection.addEventListener("change", check);
  window.addEventListener("online", check);
  // The device may already be on Wi-Fi (the light pass can date from an
  // earlier, cellular visit), so look once too.
  whenIdle(check, UPGRADE_CHECK_DELAY_MS);
}

/** Run once the main thread is free, and never before `delayMs`: nothing here may compete with the map. */
function whenIdle(task: () => void, delayMs: number): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  setTimeout(() => (idle ? idle(task, { timeout: 10_000 }) : task()), delayMs);
}

/** Call once from the page. Safe to call repeatedly. */
export function scheduleOfflineWarm(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (readKey(DONE_KEY)) {
    void requestPersistence();
    return;
  }
  // No full set yet: a light one may be waiting to be completed on Wi-Fi.
  watchForFullWarm();
  const start = async () => {
    const mode = currentWarmMode();
    if (mode === "skip") return;
    // The light pass is done once; only Wi-Fi (the full set) goes further.
    if (mode === "overview" && readKey(OFFLINE_OVERVIEW_KEY)) return;
    // Wait for the worker to control the page, or the fetches would go
    // straight to the network and never be cached.
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) return;
    await requestPersistence();
    try {
      await runWarm(mode);
    } catch {
      // offline or upstream hiccup: try again next visit
    }
  };
  // Called once the map has painted (see HomeClient), and then still waits:
  // well after first paint and the first live-times poll.
  whenIdle(() => void start(), 8_000);
}

/**
 * "Download the map for offline use now" (Settings): ignores the data-saver /
 * cellular checks, because the rider asked. Reports progress as it goes (one
 * step per real request) and resolves with what was fetched; still throws when
 * anything failed to download, so the caller can say so.
 */
export async function warmMapNow(options: { onProgress?: (progress: WarmProgress) => void } = {}): Promise<WarmSummary> {
  // Without the service worker in control, fetches go straight to the network
  // and nothing is stored: that is a failure to report, not a success.
  if (!("serviceWorker" in navigator)) throw new Error("no service worker support");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) throw new Error("page not controlled by the service worker yet");
  const persisted = await requestPersistence();
  const summary = await runWarm("full", options.onProgress);
  if (summary.failed > 0) throw new Error("some tiles could not be downloaded");
  return { ...summary, persisted };
}
