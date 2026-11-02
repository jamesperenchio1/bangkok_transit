// Regenerates the golden screenshots the visual check compares against.
//
// Deliberately narrow: app chrome only (header + route sheet), never the map.
// The simulation serves a stub basemap, so a real-world tile change would
// otherwise show up as a false regression here.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
import { budgets } from "./budgets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../", budgets.visual.baselines);

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer({ port: 0 });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: "en-US",
      timezoneId: "Asia/Bangkok",
      baseURL: server.url,
    });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "load" });
    await page.waitForSelector("h1", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "home.png") });

    await page.goto("/?from=W1&to=E1", { waitUntil: "load" });
    // A deep link sets the route but leaves the sheet closed on purpose, so the
    // map stays visible; open it the way a rider does.
    await page.getByRole("button", { name: /view route/i }).first().click();
    await page.waitForSelector('[aria-hidden="false"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "route-sheet.png") });

    console.log(`baselines written to ${OUT}`);
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
