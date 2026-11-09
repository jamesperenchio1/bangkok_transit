/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from "serwist";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// defaultCache's built-in image-caching rule can't match this: Serwist only
// applies a rule to a cross-origin request when the match starts at index 0
// of the URL, and a bare `.pbf$`/`.png$`-style regex never does for a full
// cross-origin URL. Vector tiles/fonts/sprites are small, so cache them
// generously - this makes repeat visits and pan-backs instant, on top of
// vector tiles already avoiding the blank-while-loading raster tile problem
// for first-time visitors.
const openFreeMapCache: RuntimeCaching = {
  matcher: ({ url }) => url.hostname === "tiles.openfreemap.org",
  handler: new CacheFirst({
    cacheName: "openfreemap-tiles",
    plugins: [new ExpirationPlugin({ maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 })],
  }),
};

// Live arrivals must never come from a cache. defaultCache's catch-all
// cross-origin rule would answer from a stored copy (up to an hour old) when
// the network fails or is slow, and that copy's old Date header would wind
// the client's server clock back (lib/arrivals-store.ts), making stale times
// look live. The client already keeps last-known times itself.
const liveArrivals: RuntimeCaching = {
  matcher: ({ url }) => url.pathname.endsWith("/arrivals.json"),
  handler: new NetworkOnly(),
};

// Place search sends what the rider types to a third party. It is fetched live
// and never stored: a cached copy would keep their queries on the device and
// answer from stale data. (The page keeps its own in-memory cache.)
const placeSearch: RuntimeCaching = {
  matcher: ({ url }) => url.hostname === "photon.komoot.io",
  handler: new NetworkOnly(),
};

// The paid API (worker/) answers with money-gated data and 402s. A cached copy
// would hand a paid response to someone who didn't pay (Serwist's default rule
// caches same-origin /api/ GETs), so it is never stored.
const paidApi: RuntimeCaching = {
  matcher: ({ url }) => url.pathname === "/api" || url.pathname.startsWith("/api/"),
  handler: new NetworkOnly(),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // The shell ("/", added in next.config.ts) is precached, so a cold start
  // offline - or online - answers from the cache at once instead of waiting
  // out a network timeout. Query strings are ignored so a shared
  // `/?from=N8&to=CEN` link opens offline too: the route is read client-side.
  precacheOptions: { cleanupOutdatedCaches: true, ignoreURLParametersMatching: [/.*/] },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [paidApi, liveArrivals, placeSearch, openFreeMapCache, ...defaultCache],
});

serwist.addEventListeners();
