import type { NextConfig } from "next";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import withSerwistInit from "@serwist/next";

/**
 * Files the app cannot start without, beyond the JS/CSS Serwist finds itself.
 * Left to the runtime cache, each is stored only after the page has already
 * fetched it through the service worker - which a first-time visitor's page
 * never does (the worker takes control after the page has loaded) - so
 * opening the app offline after a single visit would find the map's worker
 * and the line geometry missing. Precached, they arrive with the shell.
 * The revision is a hash of the content, so a changed file is re-fetched.
 */
const precachedPublicFiles = [
  "/line-geometry.json",
  "/maplibre/maplibre-gl-worker.mjs",
  "/maplibre/maplibre-gl-shared.mjs",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon.svg",
].map((url) => ({
  url,
  revision: createHash("md5").update(readFileSync(`public${url}`)).digest("hex"),
}));

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // A static export's index.html isn't in the glob-built manifest, so list
  // the shell explicitly. A fresh revision per build re-fetches it on deploy.
  additionalPrecacheEntries: [{ url: "/", revision: randomUUID() }, ...precachedPublicFiles],
  // Serwist's default is a full `location.reload()` whenever the device
  // comes back online - which on a phone leaving a tunnel or the subway
  // wipes the open station card, the map view, and everything else on
  // screen. Not needed: lib/arrivals-store.ts re-polls on `online` itself.
  reloadOnOnline: false,
});

// A fully static site: served by Cloudflare as Workers static assets (see
// wrangler.jsonc) straight from the edge, with no server code at all. Live
// arrivals come from a separate CDN-cached document (lib/arrivals-url.ts).
// Response headers (security, caching) live in public/_headers, since
// `headers()` isn't available for a static export.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

// Serwist injects a `webpack` config key even when `disable: true` is set,
// which trips Next 16's Turbopack-vs-webpack-config check in `next dev`
// (Turbopack, the dev default). So the wrapper itself is only applied for
// the production (webpack) build - see the "build" script in package.json.
const isProdBuild = process.env.NODE_ENV === "production";

export default isProdBuild ? withSerwist(nextConfig) : nextConfig;
