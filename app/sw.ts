/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";
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
    plugins: [new ExpirationPlugin({ maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [openFreeMapCache, ...defaultCache],
});

serwist.addEventListeners();
