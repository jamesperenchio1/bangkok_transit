import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

type MapLike = {
  getLayoutProperty(layer: string, prop: string): unknown;
  getFilter(layer: string): unknown;
  getPaintProperty(layer: string, prop: string): unknown;
};
const map = (page: import("@playwright/test").Page, fn: (m: MapLike) => unknown) =>
  page.evaluate(`(${fn.toString()})(window.__map)`);

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  return page.getByRole("dialog", { name: "Settings" });
}

test.describe("settings", () => {
  test("choices apply to the map at once and survive a reload", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    const dialog = await openSettings(page);

    const labels = dialog.getByRole("switch", { name: "Station names on the map" });
    await expect(labels).toHaveAttribute("aria-checked", "true");
    await labels.click();
    await expect(labels).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => map(page, (m) => m.getLayoutProperty("stations-label-layer", "visibility"))).toBe("none");

    await page.reload();
    const again = await openSettings(page);
    await expect(again.getByRole("switch", { name: "Station names on the map" })).toHaveAttribute("aria-checked", "false");
  });

  test("hiding a line filters it out of the map", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: /Lines/ }).first().click();
    await dialog.getByRole("switch", { name: /Sukhumvit/ }).first().click();
    await expect.poll(() => map(page, (m) => m.getFilter("transit-lines-layer"))).toBeTruthy();
  });

  test("reset puts everything back", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("button", { name: /Display/ }).click();
    await dialog.getByRole("radio", { name: "Dark" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await dialog.getByRole("button", { name: "Reset to defaults" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
  });

  test("text size applies to the whole page", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: /Display/ }).click();
    const slider = dialog.getByRole("slider", { name: "Text size" });
    await slider.fill("125");
    await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe("125%");
  });

  test("search finds an advanced option in any section", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSettings(page);
    await dialog.getByRole("searchbox", { name: "Search settings" }).fill("walking speed");
    await expect(dialog.getByRole("slider", { name: "Walking speed" })).toBeVisible();
  });

  test("advanced options stay out of the way until asked for", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: /^Map/ }).click();
    await expect(dialog.getByRole("slider", { name: "Line thickness" })).toHaveCount(0);
    await dialog.getByRole("switch", { name: "Show advanced options" }).click();
    await expect(dialog.getByRole("slider", { name: "Line thickness" })).toBeVisible();
  });

  test("the panel and its sections are lazy: nothing is downloaded until they are opened", async ({ page }) => {
    const chunks: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/_next/static/chunks/")) chunks.push(r.url());
    });
    await page.goto("/");
    await mapReady(page);
    const before = chunks.length;
    // Strings only the settings catalog contains.
    const sources = async () =>
      (
        await Promise.all(
          chunks.map((u) => page.request.get(u).then((r) => r.text()).catch(() => "")),
        )
      ).join("\n");
    expect(await sources()).not.toContain("Trains listed per platform");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: /^Live times/ }).click();
    await expect(dialog.getByRole("switch", { name: "Show live arrival times" })).toBeVisible({ timeout: 15_000 });
    expect(chunks.length).toBeGreaterThan(before);
  });

  test("Test sound says what happened", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: /^Station alert/ }).click();
    await dialog.getByRole("button", { name: "Test the alert sound" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: /Played|blocked/ })).toBeVisible();
  });
});

test.describe("trains while a route is shown", () => {
  // Zoomed out over the whole network, so every train is inside the viewport
  // (querySourceFeatures only sees what is loaded for the current view).
  const trains = async (page: import("@playwright/test").Page) => {
    await page.evaluate(`window.__map.jumpTo({ center: [100.55, 13.8], zoom: 9.6 })`);
    await page.waitForTimeout(1200); // let the source's tiles for this view load
    return page.evaluate(`(() => {
      const m = window.__map;
      return m.getSource("live-trains") ? m.querySourceFeatures("live-trains").map((f) => f.properties.onRoute) : [];
    })()`) as Promise<boolean[]>;
  };
  // The route's own camera move and the (idle-started) trains layer settle first.
  const settled = async (page: import("@playwright/test").Page) => {
    await page.waitForFunction(() => !!(window as unknown as { __map?: { getLayer(id: string): unknown } }).__map?.getLayer("live-trains-layer"), null, { timeout: 30_000 });
    await page.waitForTimeout(3000);
  };
  const ROUTE = "/?from=N24&to=CEN"; // most of the Sukhumvit line

  test("only trains on the route are drawn by default", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    await page.goto(ROUTE);
    await mapReady(page);
    await settled(page);
    await expect.poll(async () => (await trains(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect((await trains(page)).every((onRoute) => onRoute === true)).toBe(true);
  });

  test("'Grey out' keeps the others on the map but marks them", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    await page.addInitScript(() => {
      // Unconditional: the fixtures' own default seeds the key first.
      localStorage.setItem("bts:settings:v1", JSON.stringify({ otherTrains: "dim", onlinePlaces: false }));
    });
    await page.goto("/?from=N8&to=N5"); // a short stretch: most trains are elsewhere
    await mapReady(page);
    await settled(page);
    await expect.poll(async () => (await trains(page)).includes(false), { timeout: 30_000 }).toBe(true);
    expect(await page.evaluate(`window.__map.getPaintProperty("live-trains-layer", "icon-opacity")`)).toEqual([
      "case",
      ["==", ["get", "onRoute"], true],
      0.85,
      0.22,
    ]);
  });
});
