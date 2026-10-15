import { stationsByCode } from "../data/stations";
import { downDocument, expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

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
    await expect(card.getByText("Kheha")).toBeVisible();
    await expect(card.getByText(/^2 min$/).first()).toBeVisible();
    await expect(card.getByText(/Updated/)).toBeVisible();
  });

  test("finds stations by forgiving search and shows the nearest one", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Nearest: Siam/ })).toBeVisible();
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByPlaceholder("Search stations…").fill("phaya thai");
    await expect(page.getByRole("button", { name: /Phaya Thai.*N2/ })).toBeVisible();
    await page.getByPlaceholder("Search stations…").fill("n 15");
    await page.getByRole("button", { name: /N15/ }).click();
    await expect(page.locator(".maplibregl-popup").getByRole("button", { name: "Start" })).toBeVisible();
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
      await page.locator("ul button").first().click();
    };
    await search("national stadium");
    await page.locator(".maplibregl-popup").getByRole("button", { name: "Start" }).click();
    await search("chit lom");
    await page.locator(".maplibregl-popup").getByRole("button", { name: "Destination" }).click();

    await expect(page).toHaveURL(/from=W1&to=E1/);
    const sheet = page.locator("[aria-hidden=false]").filter({ hasText: "National Stadium" });
    await expect(sheet.getByText(/2 stops · 1 change · ~\d+ min/)).toBeVisible();
    await expect(sheet.getByText("Board toward Khu Khot").or(sheet.getByText("Board toward Kheha"))).toBeVisible();
  });

  test("shows a walking transfer instead of a duplicate station", async ({ page }) => {
    await page.goto("/?from=N8&to=BL22");
    await page.getByRole("button", { name: "View route" }).click();
    const sheet = page.locator("[aria-hidden=false]");
    await expect(sheet.getByText("Chatuchak Park")).toBeVisible();
    await expect(sheet.getByText(/Walk \d+ m from the previous station/)).toBeVisible();
    await expect(sheet.getByText(/6 stops · no changes · \d+ m walk/)).toBeVisible();
  });

  test("swaps and clears the route", async ({ page }) => {
    await page.goto("/?from=W1&to=E1");
    await page.getByRole("button", { name: "Swap start and destination" }).click();
    await expect(page).toHaveURL(/from=E1&to=W1/);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("language", () => {
  test("switches to Thai and remembers it", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    await page.goto("/");
    await page.getByRole("button", { name: "TH" }).click();
    await expect(page.getByRole("heading", { name: "รถไฟฟ้ากรุงเทพฯ" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    await page.reload();
    await expect(page.getByRole("heading", { name: "รถไฟฟ้ากรุงเทพฯ" })).toBeVisible();
  });
});

test.describe("live data outage", () => {
  test("says the source is down rather than a generic error", async ({ page }) => {
    await serveArrivals(page, downDocument);
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByPlaceholder("Search stations…").fill("siam");
    await page.locator("ul button").first().click();
    await expect(page.locator(".maplibregl-popup").getByText(/down at the source/)).toBeVisible();
  });
});

test.describe("platform", () => {
  test("serves security headers, a manifest and icons", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    const manifest = await (await request.get("/manifest.json")).json();
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
    expect((await request.get("/sw.js")).headers()["cache-control"]).toBe("no-cache");
  });
});
