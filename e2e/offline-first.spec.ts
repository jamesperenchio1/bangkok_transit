import type { Page } from "@playwright/test";
import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

/**
 * "Works with no internet" is the app's main promise, and a slow connection
 * is the next best thing to none. These tests pin both: what a visitor has
 * after ONE online visit, and that the network draws without waiting for the
 * third-party basemap.
 */

type MapLike = {
  getLayer(id: string): unknown;
  getStyle(): { layers: { id: string }[] };
  loaded(): boolean;
  queryRenderedFeatures(o: { layers: string[] }): unknown[];
};
const stationsDrawn = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __map?: MapLike }).__map;
    return m && m.getLayer("stations-layer") ? m.queryRenderedFeatures({ layers: ["stations-layer"] }).length : 0;
  });
const usingFallbackBasemap = (page: Page) =>
  page.evaluate(() => (window as unknown as { __map: MapLike }).__map.getStyle().layers.some((l) => l.id === "fallback-background"));

/** Console noise the browser logs for requests that fail on purpose; never CSP violations or page errors. */
function forgiveNetworkErrors(problems: string[]) {
  const kept = problems.filter((p) => !p.startsWith("console:") || p.startsWith("console: CSP violation"));
  problems.splice(0, problems.length, ...kept);
}

const cachedUrls = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(req.url);
    return out;
  });

test.beforeEach(async ({ page }) => {
  await serveArrivals(page, liveDocument);
});

test.describe("one visit is enough", () => {
  test("the first visit precaches everything the map needs to start", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(async () => (await cachedUrls(page)).filter((u) => /line-geometry\.json|maplibre-gl-worker\.mjs|maplibre-gl-shared\.mjs|manifest\.json/.test(u)).length)
      .toBe(4);
  });

  test("offline straight after that first visit - no reload in between - the network still draws", async ({ page, context, problems }) => {
    await page.goto("/");
    await mapReady(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(async () => (await cachedUrls(page)).some((u) => u.includes("maplibre-gl-worker.mjs"))).toBe(true);

    await context.setOffline(true);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Bangkok Transit" })).toBeVisible();
    await expect.poll(() => stationsDrawn(page), { timeout: 30_000 }).toBeGreaterThan(10);
    forgiveNetworkErrors(problems);
  });

  test("the basemap is cached by the first-visit warm-up, so the next offline open has it", async ({ page, context, problems }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the warm-up fetches hundreds of tiles; once is enough");
    test.setTimeout(150_000);
    await page.goto("/");
    await mapReady(page);
    // lib/offline-warm.ts starts ~8 s after load and stores the style, fonts
    // and the network's tiles through the service worker.
    await expect
      .poll(async () => (await cachedUrls(page)).filter((u) => u.includes("tiles.openfreemap.org") && /\.pbf$/.test(u)).length, { timeout: 100_000 })
      .toBeGreaterThan(5);
    await expect.poll(async () => (await cachedUrls(page)).some((u) => u.includes("/styles/liberty"))).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect.poll(() => stationsDrawn(page), { timeout: 30_000 }).toBeGreaterThan(10);
    expect(await usingFallbackBasemap(page), "real basemap, not the blank fallback").toBe(false);
    forgiveNetworkErrors(problems);
  });
});

test.describe("when the basemap is slow or missing", () => {
  test("a basemap that cannot be reached still leaves the whole network usable", async ({ page, context, problems }) => {
    await context.route("https://tiles.openfreemap.org/**", (route) => route.abort("failed"));
    await page.goto("/");
    await expect.poll(() => stationsDrawn(page), { timeout: 30_000 }).toBeGreaterThan(10);
    expect(await usingFallbackBasemap(page)).toBe(true);
    // And it is operable: search finds a station and its card opens.
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("siam");
    await page.getByRole("option").first().click();
    await expect(page.locator(".maplibregl-popup").getByText("Siam")).toBeVisible();
    forgiveNetworkErrors(problems);
  });

  test("the network is drawn without waiting for the basemap's tiles and fonts", async ({ page, context }) => {
    // Hold every tile and font for 8 s, as a bad connection would.
    await context.route(/tiles\.openfreemap\.org\/(planet|fonts)\//, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8000));
      await route.continue().catch(() => {});
    });
    await page.goto("/");
    await expect.poll(() => stationsDrawn(page), { timeout: 6000 }).toBeGreaterThan(10);
    const basemapDone = await page.evaluate(() => (window as unknown as { __map: MapLike }).__map.loaded());
    expect(basemapDone, "the basemap is still loading while the stations are already drawn").toBe(false);
  });
});
