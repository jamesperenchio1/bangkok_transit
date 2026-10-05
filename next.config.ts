import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
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
