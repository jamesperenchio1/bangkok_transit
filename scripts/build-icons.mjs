/**
 * Renders public/icons/icon.svg into the PNG sizes browsers and app
 * launchers want (PWA manifest, Apple touch icon), using the Chromium that
 * Playwright already installs for the e2e suite. Re-run after editing the SVG:
 *
 *   node scripts/build-icons.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.join(import.meta.dirname, "..");
const svg = readFileSync(path.join(ROOT, "public/icons/icon.svg"), "utf8");
const SIZES = { "icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180 };

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of Object.entries(SIZES)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: path.join(ROOT, "public/icons", name), omitBackground: false });
  console.log(`public/icons/${name}`);
}
await browser.close();
