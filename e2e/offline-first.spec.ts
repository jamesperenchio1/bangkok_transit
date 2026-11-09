import type { Page } from "@playwright/test";
import { expect, forgiveNetworkErrors, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

/**
 * "Works with no internet" is the app's main promise, and a slow connection
 * is the next best thing to none. These tests pin both: what a visitor has
 * after ONE online visit, and that the network draws without waiting for the
 * third-party basemap.
 */

type MapLike = {
  getLayer(id: string): unknown;
  getStyle(): { layers: { id: string; source?: string }[] };
  loaded(): boolean;
  listImages(): string[];
  queryRenderedFeatures(o: { layers: string[] }): unknown[];
};
const stationsDrawn = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __map?: MapLike }).__map;
    return m && m.getLayer("stations-layer") ? m.queryRenderedFeatures({ layers: ["stations-layer"] }).length : 0;
  });
const linesDrawn = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __map?: MapLike }).__map;
    return m && m.getLayer("transit-lines-layer") ? m.queryRenderedFeatures({ layers: ["transit-lines-layer"] }).length : 0;
  });
const usingFallbackBasemap = (page: Page) =>
  page.evaluate(() => (window as unknown as { __map: MapLike }).__map.getStyle().layers.some((l) => l.id === "fallback-background"));

/** The map's own GeoJSON sources (TransitMap.tsx); every other layer is the third-party basemap. */
const OUR_SOURCES = ["transit-lines", "highlighted-route", "stations", "gps-position", "gps-accuracy"];
/** How many basemap features (roads, water, buildings...) are actually on screen right now. */
const basemapFeaturesDrawn = (page: Page) =>
  page.evaluate((ours) => {
    const m = (window as unknown as { __map?: MapLike }).__map;
    if (!m) return 0;
    const layers = m.getStyle().layers.filter((l) => l.source && !ours.includes(l.source)).map((l) => l.id);
    return layers.length ? m.queryRenderedFeatures({ layers }).length : 0;
  }, OUR_SOURCES);
/** lib/offline-warm.ts (DONE_KEY) writes this once every style, font and tile request has finished. */
const warmUpDone = (page: Page) => page.evaluate(() => !!window.localStorage.getItem("bts:map-warm:v2"));

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

    // Only what the browser logs from here on is the outage; an error during
    // the online visit above is a real failure and must still fail the test.
    const cutAt = problems.length;
    await context.setOffline(true);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Bangkok Transit" })).toBeVisible();
    await expect.poll(() => stationsDrawn(page), { timeout: 30_000 }).toBeGreaterThan(10);
    forgiveNetworkErrors(problems, cutAt);
  });

  test("the basemap is cached by the first-visit warm-up, so the next offline open has it", async ({ page, context, problems }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the warm-up fetches hundreds of tiles; once is enough");
    test.setTimeout(240_000);
    await page.goto("/");
    await mapReady(page);
    // lib/offline-warm.ts starts ~8 s after load and stores the style, fonts
    // and the network's tiles through the service worker. Wait for it to
    // report that it finished, not for an arbitrary number of tiles.
    await expect.poll(() => warmUpDone(page), { timeout: 180_000, intervals: [1000] }).toBe(true);
    await expect.poll(async () => (await cachedUrls(page)).some((u) => u.includes("/styles/liberty"))).toBe(true);

    const cutAt = problems.length;
    await context.setOffline(true);
    await page.reload();
    await expect.poll(() => stationsDrawn(page), { timeout: 30_000 }).toBeGreaterThan(10);
    expect(await usingFallbackBasemap(page), "real basemap, not the blank fallback").toBe(false);
    // A cached style alone still loads when its tiles are missing, so also
    // require real streets/water to be rendered from the cached tiles.
    await expect.poll(() => basemapFeaturesDrawn(page), { timeout: 30_000, message: "basemap features drawn offline" }).toBeGreaterThan(0);
    forgiveNetworkErrors(problems, cutAt);
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

  test("the basemap's icon sprite is only requested once the network is already drawn", async ({ page, context }) => {
    // The sprite is a 117 KB image of road shields and POI icons. Fetched
    // alongside the files the first draw needs, on a slow link it takes bandwidth
    // from them (measured: ~0.6 s on slow 4G, ~2 s on 3G). So it must wait for
    // the network to be on screen, and the icons must still arrive afterwards.
    let drawnWhenRequested: number | null = null;
    await context.route(/tiles\.openfreemap\.org\/sprites\//, async (route) => {
      drawnWhenRequested ??= await stationsDrawn(page);
      await route.continue().catch(() => {});
    });
    await page.goto("/");
    await expect.poll(() => stationsDrawn(page), { timeout: 30_000 }).toBeGreaterThan(10);
    const spriteIcons = () =>
      page.evaluate(() => (window as unknown as { __map: MapLike }).__map.listImages().filter((n) => !n.startsWith("destination-ring")).length);
    await expect.poll(spriteIcons, { timeout: 30_000, message: "sprite icons arrive afterwards" }).toBeGreaterThan(5);
    expect(drawnWhenRequested, "stations already drawn when the sprite was first requested").toBeGreaterThan(10);
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

test.describe("the map comes first", () => {
  test("the lines are drawn, joined station to station, even if the curved track cannot be downloaded", async ({ page, problems }) => {
    // Before: one failed request for public/line-geometry.json left the map with
    // stations and no lines at all until the next reload. (A fresh first load,
    // so the service worker has not taken over yet and cannot answer from its
    // precache.)
    await page.route("**/line-geometry.json", (route) => route.abort("failed"));
    await page.goto("/");
    await expect.poll(() => linesDrawn(page), { timeout: 30_000 }).toBeGreaterThan(10);
    expect(await stationsDrawn(page)).toBeGreaterThan(10);
    forgiveNetworkErrors(problems);
  });

  test("live times are not requested until the lines are on screen", async ({ page, context }) => {
    // A slow basemap keeps the map busy for a few seconds. Live times and the
    // offline-map download are not the map, so they wait for it: before, the
    // first poll went out as soon as the page hydrated, in front of the map's
    // own files, and the lines were not drawn yet when it did.
    await context.route(/tiles\.openfreemap\.org\/(planet|fonts)\//, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue().catch(() => {});
    });
    // Measured inside the page, at the moment of the fetch: once the service
    // worker controls the page Playwright can no longer see (or route) the
    // request, and a check made afterwards would be too late to mean anything.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __map?: MapLike;
        __linesAtArrivals?: number;
        fetch: typeof fetch;
      };
      const realFetch = w.fetch.bind(window);
      w.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/arrivals.json") && w.__linesAtArrivals === undefined) {
          const m = w.__map;
          w.__linesAtArrivals = m && m.getLayer("transit-lines-layer") ? m.queryRenderedFeatures({ layers: ["transit-lines-layer"] }).length : 0;
        }
        return realFetch(input, init);
      };
    });
    await page.goto("/");
    const linesAtFirstPoll = () => page.evaluate(() => (window as unknown as { __linesAtArrivals?: number }).__linesAtArrivals);
    await expect.poll(linesAtFirstPoll, { timeout: 30_000, message: "live times are still requested" }).toBeDefined();
    expect(await linesAtFirstPoll(), "lines already drawn when live times were first requested").toBeGreaterThan(10);
  });
});
