import { devices, type PlaywrightTestProject } from "@playwright/test";

/**
 * The phones the station alert is exercised on, most important first.
 *
 * Priority is the order James set: iPhone Safari, then iPhone Chrome, then the
 * rest of the iPhone range, then Android, and desktop last. Playwright runs
 * projects in the order they are listed, so a failure on a tier-1 phone shows
 * first. `npm run test:alert` runs just this matrix; `--grep`/`--project` narrow it.
 *
 * What a preset really changes: every iPhone entry runs the same real WebKit
 * (that is also what Chrome on iPhone is, Apple requires it), so the preset
 * varies the screen, pixel ratio, touch and user agent. Behaviour that
 * differs by iOS *version* (no `navigator.audioSession` before 16.4, none of
 * `navigator.vibrate` ever) is covered by the fake-environment matrix in
 * `tests/alert-output.test.ts`. Android entries run real Chromium.
 */
export type Platform = "ios" | "android" | "desktop";

interface Entry {
  /** Project name; shown in reports and used by `--project`. */
  name: string;
  platform: Platform;
  /** Key of Playwright's `devices` table. */
  device: string;
  /** Rewrites the device's user agent, to look like another browser on the same engine. */
  browser?: "chrome-ios" | "samsung-internet";
}

const iosChrome = (ua: string) =>
  // Chrome on iPhone keeps Safari's engine and swaps "Version/x" for "CriOS/x".
  ua.replace(/Version\/[\d.]+ (Mobile\/\w+) Safari\/([\d.]+)/, "CriOS/131.0.6778.103 $1 Safari/$2");

// Samsung Internet is Chromium with its own token in front of "Chrome/".
const samsungInternet = (ua: string) => ua.replace(/Chrome\/([\d.]+)/, "SamsungBrowser/27.0 Chrome/$1");

const matrix: Entry[] = [
  // Tier 1: the two ways most iPhone riders will open the app.
  { name: "iphone15-safari", platform: "ios", device: "iPhone 15" },
  { name: "iphone15-chrome", platform: "ios", device: "iPhone 15", browser: "chrome-ios" },

  // Tier 2: the rest of the iPhone range, smallest/oldest to largest/newest.
  { name: "iphone-se1", platform: "ios", device: "iPhone SE" }, // 320px: the tightest layout
  { name: "iphone-se1-chrome", platform: "ios", device: "iPhone SE", browser: "chrome-ios" },
  { name: "iphone8", platform: "ios", device: "iPhone 8" },
  { name: "iphone-se3", platform: "ios", device: "iPhone SE (3rd gen)" },
  { name: "iphone-x", platform: "ios", device: "iPhone X" },
  { name: "iphone11", platform: "ios", device: "iPhone 11" },
  { name: "iphone12-mini", platform: "ios", device: "iPhone 12 Mini" },
  { name: "iphone13", platform: "ios", device: "iPhone 13" },
  { name: "iphone14-pro", platform: "ios", device: "iPhone 14 Pro" },
  { name: "iphone15-pro-max", platform: "ios", device: "iPhone 15 Pro Max" },
  { name: "iphone16-pro", platform: "ios", device: "iPhone 16 Pro" },
  { name: "iphone17-pro-max", platform: "ios", device: "iPhone 17 Pro Max" },
  { name: "iphone17-pro-max-chrome", platform: "ios", device: "iPhone 17 Pro Max", browser: "chrome-ios" },

  // Tier 3: Android, from old small screens to current flagships and foldables.
  { name: "pixel7-chrome", platform: "android", device: "Pixel 7" },
  { name: "galaxy-s5", platform: "android", device: "Galaxy S5" },
  { name: "galaxy-s9plus", platform: "android", device: "Galaxy S9+" }, // 320px wide
  { name: "galaxy-s24", platform: "android", device: "Galaxy S24" },
  { name: "galaxy-s24-samsung-internet", platform: "android", device: "Galaxy S24", browser: "samsung-internet" },
  { name: "galaxy-a55", platform: "android", device: "Galaxy A55" },
  { name: "galaxy-z-flip6", platform: "android", device: "Galaxy Z Flip 6" },
  { name: "galaxy-z-fold6", platform: "android", device: "Galaxy Z Fold 6" },
  { name: "pixel4", platform: "android", device: "Pixel 4" },
  { name: "pixel5", platform: "android", device: "Pixel 5" },
  { name: "pixel10-pro-xl", platform: "android", device: "Pixel 10 Pro XL" },

  // Tier 4: desktop, last on purpose.
  { name: "desktop-safari", platform: "desktop", device: "Desktop Safari" },
  { name: "desktop-chrome", platform: "desktop", device: "Desktop Chrome" },
];

export const alertDeviceProjects: PlaywrightTestProject[] = matrix.map((entry) => {
  const preset = devices[entry.device];
  if (!preset) throw new Error(`Playwright has no device preset "${entry.device}"`);
  const userAgent =
    entry.browser === "chrome-ios"
      ? iosChrome(preset.userAgent)
      : entry.browser === "samsung-internet"
        ? samsungInternet(preset.userAgent)
        : preset.userAgent;
  return {
    name: `alert:${entry.name}`,
    testMatch: /alert-devices\.spec\.ts$/,
    metadata: { platform: entry.platform, browser: entry.browser ?? "default", device: entry.device },
    // Pixel ratio 1 on every phone: the map renders in software GL here, and a
    // 3-4.5x canvas (Galaxy S5/S9+/S24) starves the page so taps time out. The
    // ratio changes nothing about audio, vibration or CSS layout.
    use: { ...preset, userAgent, deviceScaleFactor: 1 },
  };
});
