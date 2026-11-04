import type { Page } from "@playwright/test";
import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

/**
 * Picking stations from search must not fight the rider: it should not zoom
 * in on every pick, must keep a chosen start in view when a destination is
 * picked, and must never leave the page scrolled sideways.
 */

type MapLike = {
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  getBounds(): { contains(p: [number, number]): boolean };
  isMoving(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
};
const mapState = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __map: MapLike }).__map;
    const c = m.getCenter();
    return { zoom: m.getZoom(), lng: c.lng, lat: c.lat, moving: m.isMoving() };
  });
const settled = async (page: Page) => {
  await page.waitForFunction(() => !(window as unknown as { __map: MapLike }).__map.isMoving());
  return mapState(page);
};

async function pick(page: Page, query: string) {
  await page.getByRole("button", { name: "Search stations" }).click();
  await page.getByRole("combobox").fill(query);
  await page.getByRole("option").first().click();
  await expect(page.locator(".maplibregl-popup")).toBeVisible();
}

/** Every element that is scrolled away from its origin - nothing in this app should be. */
const scrolledElements = (page: Page) =>
  page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll("*")]
      .filter((el) => el.scrollLeft !== 0)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} scrollLeft=${el.scrollLeft}`),
  );

test.beforeEach(async ({ page }) => {
  await serveArrivals(page, liveDocument);
});

test.describe("camera", () => {
  test("a station already on screen is selected without moving the map", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    await page.evaluate(() => (window as unknown as { __map: MapLike }).__map.jumpTo({ center: [100.5341, 13.7455], zoom: 15.2 }));
    const before = await settled(page);
    await pick(page, "siam");
    const after = await settled(page);
    expect(after.zoom).toBeCloseTo(before.zoom, 1);
    expect(after.lng).toBeCloseTo(before.lng, 3);
    expect(after.lat).toBeCloseTo(before.lat, 3);
  });

  test("a far-away station is brought into view without zooming in tight on it", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    await page.evaluate(() => (window as unknown as { __map: MapLike }).__map.jumpTo({ center: [100.62, 13.9], zoom: 10.5 }));
    await settled(page);
    await pick(page, "siam");
    const after = await settled(page);
    expect(after.zoom, "does not zoom in past street level").toBeLessThanOrEqual(13.5);
    expect(after.lat).toBeCloseTo(13.7455, 1);
  });

  test("picking a destination keeps the chosen start in view", async ({ page }) => {
    await page.goto("/");
    await pick(page, "mo chit");
    await page.locator(".maplibregl-popup").getByRole("button", { name: /start/i }).click();
    await settled(page);
    await pick(page, "bearing");
    await settled(page);
    const visible = await page.evaluate(() => {
      const m = (window as unknown as { __map: MapLike }).__map;
      return {
        start: m.getBounds().contains([100.5535, 13.8021]), // Mo Chit
        destination: m.getBounds().contains([100.6016, 13.6613]), // Bearing
      };
    });
    expect(visible, "the start and the station just picked are both on screen").toEqual({ start: true, destination: true });
  });
});

test.describe("page stays put", () => {
  test("opening cards from search never scrolls the page sideways", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    await pick(page, "siam");
    await settled(page);
    expect(await scrolledElements(page)).toEqual([]);
    await pick(page, "khu khot");
    await settled(page);
    expect(await scrolledElements(page)).toEqual([]);
  });

  test("focusing the card's close button off-screen cannot scroll the page", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    // What MapLibre does when a card opens: focus its close button. With the
    // button outside the viewport the browser tries to scroll it into view,
    // even though overflow is hidden.
    const scrolled = await page.evaluate(() => {
      const button = document.createElement("button");
      button.textContent = "x";
      button.style.cssText = "position:absolute;left:-60px;top:200px";
      document.querySelector("main")!.appendChild(button);
      button.focus();
      return [document.documentElement, document.body, document.querySelector("main")!].map((e) => e.scrollLeft);
    });
    expect(scrolled).toEqual([0, 0, 0]);
  });
});
