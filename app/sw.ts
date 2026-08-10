import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkFirst } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

const serwist = new Serwist({
  precacheEntries: (self as unknown as WorkerGlobalScope).__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // BTS live arrivals (fetched client-side straight from the unofficial
      // topmile API, no backend of ours involved): try the network first,
      // but fall back to the last cached response instantly when offline or
      // slow — so a cold PWA launch after being closed a long time still
      // paints last-known arrivals immediately instead of a blank panel.
      matcher: ({ url }) => url.hostname === "bts-api.topmile.com",
      handler: new NetworkFirst({
        cacheName: "bts-arrivals",
        networkTimeoutSeconds: 3,
      }),
    },
  ],
});

serwist.addEventListeners();
