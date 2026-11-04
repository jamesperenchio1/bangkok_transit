import { stationsByCode } from "../data/stations";
import { downDocument, expect, liveDocument, mapReady, openStationCard, serveArrivals, test } from "./fixtures";

const siam = stationsByCode.get("CEN")!;

test.describe("map", () => {
  test.beforeEach(async ({ page }) => {
    await serveArrivals(page, liveDocument);
  });

  test("loads the network with station labels", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Bangkok Transit" })).toBeVisible();
    await mapReady(page);
    const labels = await page.evaluate(async () => {
      const map = (window as unknown as { __map: import("maplibre-gl").Map }).__map;
      map.jumpTo({ center: [100.5341, 13.7455], zoom: 14.5 });
      await new Promise<void>((resolve) => map.once("idle", () => resolve()));
      return map.queryRenderedFeatures({ layers: ["stations-label-layer"] }).map((f) => f.properties.nameEn);
    });
    expect(labels).toContain("Siam");
  });

  test("opens a station card by tapping its marker, with live times", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    const point = await page.evaluate(async ([lon, lat]) => {
      const map = (window as unknown as { __map: import("maplibre-gl").Map }).__map;
      map.jumpTo({ center: [lon, lat], zoom: 15 });
      await new Promise<void>((resolve) => map.once("idle", () => resolve()));
      const { x, y } = map.project([lon, lat]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + y };
    }, [siam.lon, siam.lat]);
    await page.mouse.click(point.x, point.y);
    const card = page.locator(".maplibregl-popup");
    await expect(card.getByText("Siam")).toBeVisible();
    await expect(card.getByText("→ Kheha")).toBeVisible();
    // Kheha's first train, specifically (fixture: 2 min), not just any "2 min".
    await expect(card.locator("ul").first().getByRole("listitem").first()).toContainText("2 min");
    await expect(card.getByText(/Updated/)).toBeVisible();
    await expect(card).not.toContainText("last known");
  });

  test("offers the nearest station from the rider's location", async ({ page }) => {
    await page.goto("/");
    const pill = page.getByRole("button", { name: /Nearest: Siam/ });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator(".maplibregl-popup").getByText("Siam")).toBeVisible();
  });

  test("search is forgiving about spacing and finds the right station by code", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByPlaceholder("Search stations…").fill("phaya thai");
    await expect(page.getByRole("option", { name: /Phaya Thai.*N2/ })).toBeVisible();
    await page.getByPlaceholder("Search stations…").fill("n 15");
    await page.getByRole("option", { name: /N15/ }).click();
    const card = page.locator(".maplibregl-popup");
    await expect(card.getByText("N15")).toBeVisible();
    await expect(card.getByRole("button", { name: "Start" })).toBeVisible();
  });
});

test.describe("routes", () => {
  test.beforeEach(async ({ page }) => {
    await serveArrivals(page, liveDocument);
  });

  test("plans a route from the card buttons and keeps it in the URL", async ({ page }) => {
    await page.goto("/");
    const search = async (q: string) => {
      await page.getByRole("button", { name: "Search stations" }).click();
      await page.getByPlaceholder("Search stations…").fill(q);
      await page.getByRole("option").first().click();
    };
    await search("national stadium");
    await page.locator(".maplibregl-popup").getByRole("button", { name: "Start" }).click();
    await search("chit lom");
    await page.locator(".maplibregl-popup").getByRole("button", { name: "Destination" }).click();

    await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ from: "W1", to: "E1" });
    const sheet = page.getByRole("dialog", { name: /Route from National Stadium to Chit Lom/ });
    await expect(sheet.getByText(/2 stops · 1 change · ~\d+ min/)).toBeVisible();
    // National Stadium -> Chit Lom runs east, toward Kheha.
    await expect(sheet.getByText("Board toward Kheha")).toBeVisible();
  });

  test("shows a walking transfer instead of a duplicate station", async ({ page }) => {
    await page.goto("/?from=N8&to=BL22");
    await page.getByRole("button", { name: "View route" }).click();
    const sheet = page.getByRole("dialog", { name: /Route from/ });
    await expect(sheet.getByText("Chatuchak Park")).toBeVisible();
    await expect(sheet.getByText(/Walk \d+ m from the previous station/)).toBeVisible();
    await expect(sheet.getByText(/6 stops · 1 change · \d+ m walk/)).toBeVisible();
  });

  test("swaps and clears the route", async ({ page }) => {
    await page.goto("/?from=W1&to=E1");
    await page.getByRole("button", { name: "Swap start and destination" }).click();
    await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ from: "E1", to: "W1" });
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });
});

test.describe("language", () => {
  test("switches to Thai, flips back, and remembers the choice", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    await page.goto("/");
    const toggle = page.locator("[data-lang-toggle]");
    // The button offers the language you are *not* in.
    await expect(toggle).toHaveText("TH");
    await toggle.click();
    await expect(page.getByRole("heading", { name: "รถไฟฟ้ากรุงเทพฯ" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    await expect(toggle).toHaveText("EN");
    await page.reload();
    await expect(page.getByRole("heading", { name: "รถไฟฟ้ากรุงเทพฯ" })).toBeVisible();
    await expect(toggle).toHaveText("EN");
    await toggle.click();
    await expect(page.getByRole("heading", { name: "Bangkok Transit" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("live data outage", () => {
  test("says the source is down rather than a generic error", async ({ page }) => {
    await serveArrivals(page, downDocument);
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.getByText(/down at the source/)).toBeVisible();
  });
});
