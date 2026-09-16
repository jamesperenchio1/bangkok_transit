import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
});

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app itself uses geolocation (lib/use-geolocation.ts), so
          // scope it to same-origin rather than blocking it outright;
          // everything else sensitive (camera, microphone, payment, ...)
          // stays disabled by simply not appearing here.
          { key: "Permissions-Policy", value: "geolocation=(self)" },
        ],
      },
    ];
  },
};

// Serwist injects a `webpack` config key even when `disable: true` is set,
// which trips Next 16's Turbopack-vs-webpack-config check in `next dev`
// (Turbopack, the dev default). So the wrapper itself is only applied for
// the production (webpack) build - see the "build" script in package.json.
const isProdBuild = process.env.NODE_ENV === "production";

export default isProdBuild ? withSerwist(nextConfig) : nextConfig;
