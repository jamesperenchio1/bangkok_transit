import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
});

const nextConfig: NextConfig = {};

// Serwist injects a `webpack` config key even when `disable: true` is set,
// which trips Next 16's Turbopack-vs-webpack-config check in `next dev`
// (Turbopack, the dev default). So the wrapper itself is only applied for
// the production (webpack) build - see the "build" script in package.json.
const isProdBuild = process.env.NODE_ENV === "production";

export default isProdBuild ? withSerwist(nextConfig) : nextConfig;
