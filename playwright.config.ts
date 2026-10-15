import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real production build, served the way
 * Cloudflare serves it (`wrangler dev` runs `npm run build`, then serves
 * out/ as Workers static assets with public/_headers applied - so the CSP
 * and caching headers are exercised too). The live arrivals document is
 * replaced per test with a fixture (e2e/fixtures.ts); map tiles are real.
 */
const PORT = 8788;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Bangkok, so "nearest station" has something to find.
    geolocation: { latitude: 13.7455, longitude: 100.5341 },
    permissions: ["geolocation"],
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx wrangler dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
});
