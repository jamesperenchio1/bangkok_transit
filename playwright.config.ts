import { defineConfig, devices } from "@playwright/test";
import { alertDeviceProjects } from "./e2e/alert-devices";

/**
 * End-to-end tests against the real production build, served the way
 * Cloudflare serves it (`wrangler dev` runs `npm run build`, then serves
 * out/ as Workers static assets with public/_headers applied - so the CSP
 * and caching headers are exercised too). The live arrivals document is
 * replaced per test with a fixture (e2e/fixtures.ts); map tiles are real.
 *
 * Two kinds of project: `desktop` and `mobile` run the whole suite once, and
 * the `alert:*` projects (e2e/alert-devices.ts) run only the phone-by-phone
 * station-alert spec: iPhones first, then Android, then desktop.
 */
const PORT = 8788;
const ALERT_DEVICES = /alert-devices\.spec\.ts$/;

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
    // Phones first: projects run in this order, so a phone failure shows first.
    ...alertDeviceProjects,
    { name: "mobile", testIgnore: ALERT_DEVICES, use: { ...devices["Pixel 7"] } },
    { name: "desktop", testIgnore: ALERT_DEVICES, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx wrangler dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
});
