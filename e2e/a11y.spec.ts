import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

// The basemap is third-party raster/vector content drawn on a canvas and the
// MapLibre attribution/controls are its own widgets; audit our own UI.
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".maplibregl-canvas")
    .exclude(".maplibregl-ctrl")
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    "axe violations",
  ).toEqual([]);
}

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await serveArrivals(page, liveDocument);
  });

  test("home screen has no axe violations and exposes landmarks", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await audit(page);
  });

  test("zoom is not disabled", async ({ page }) => {
    await page.goto("/");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?(\s|,|$)/);
  });

  test("skip link moves focus to the map region", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to map" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("search works by keyboard alone as a combobox", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).focus();
    await page.keyboard.press("Enter");
    const input = page.getByRole("combobox");
    await expect(input).toBeFocused();
    await input.fill("siam");
    await expect(page.getByRole("status").filter({ hasText: /found/ })).toHaveText(/\d+ stations? found/);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
    await expect(page.getByRole("button", { name: "Search stations" })).toBeFocused();
  });

  test("the station list is a keyboard route to every station", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Browse all stations" }).click();
    const dialog = page.getByRole("dialog", { name: "All stations by line" });
    await expect(dialog).toBeVisible();
    await audit(page);
    await dialog.getByRole("button", { name: /Siam/ }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".maplibregl-popup").getByText("Siam")).toBeVisible();
  });

  test("route sheet is a labelled dialog, announces the route, closes on Escape", async ({ page }) => {
    await page.goto("/?from=W1&to=E1");
    await page.getByRole("button", { name: "View route" }).click();
    const sheet = page.getByRole("dialog", { name: /Route from National Stadium to Chit Lom/ });
    await expect(sheet).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Route found" })).toContainText(/changes?/);
    await expect(sheet.getByText(/BTS .* Line/).first()).toBeVisible();
    await audit(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});
