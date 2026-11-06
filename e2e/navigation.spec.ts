import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

test.describe("navigation and search", () => {
  test.beforeEach(async ({ page }) => {
    await serveArrivals(page, liveDocument);
  });

  test("a shared link opens straight into the route", async ({ page }) => {
    await page.goto("/?from=W1&to=E1");
    const hint = page.getByRole("banner").locator("p").first();
    await expect(hint).toContainText("National Stadium");
    await expect(hint).toContainText("Chit Lom");
    await page.getByRole("button", { name: "View route" }).click();
    await expect(page.getByRole("dialog", { name: /Route from National Stadium to Chit Lom/ })).toBeVisible();
  });

  test("garbage in the link is ignored, not a crash", async ({ page }) => {
    await page.goto("/?from=ZZZ&to=QQQ");
    await expect(page.getByRole("heading", { name: "Bangkok Transit" })).toBeVisible();
    await expect(page.getByText("Tap a station, then choose Start or Destination")).toBeVisible();
    await expect(page.getByRole("button", { name: "View route" })).toHaveCount(0);
    await mapReady(page);
  });

  test("the route is written to the URL as plain codes and removed when cleared", async ({ page }) => {
    await page.goto("/?from=W1&to=E1");
    await page.getByRole("button", { name: "Swap start and destination" }).click();
    await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ from: "E1", to: "W1" });
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("search says so when nothing matches", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("zzzzqq");
    // Shown on screen and announced (a second, screen-reader-only copy).
    await expect(page.locator("p:not([role=status])", { hasText: "No stations found." })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "No stations found." })).toBeAttached();
    await expect(page.getByRole("option")).toHaveCount(0);
  });

  test("search finds a station by its Thai name", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("สยาม");
    await expect(page.getByRole("option", { name: /Siam/ }).first()).toBeVisible();
  });

  test("search picks the highlighted result with the keyboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("chit lom");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator(".maplibregl-popup").getByText("Chit Lom")).toBeVisible();
  });

  test("the search panel lists every station by line until you type, and closes on Escape", async ({ page }) => {
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Search stations" });
    await opener.click();
    const browse = page.getByTestId("browse-stations");
    await expect(browse.getByText("All stations by line")).toBeVisible();
    await page.getByRole("combobox", { name: "Search stations" }).fill("siam");
    await expect(browse).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(browse).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the search box is at least 16px, so iOS Safari does not zoom the page on focus", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).click();
    const size = await page
      .getByRole("combobox", { name: "Search stations" })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});

test.describe("location denied", () => {
  test.use({ permissions: [] });

  test("says so, and the rest of the app still works", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    await page.goto("/");
    await expect(page.getByText(/Location access denied/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Nearest:/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("siam");
    await page.getByRole("option").first().click();
    await expect(page.locator(".maplibregl-popup").getByText("Siam")).toBeVisible();
  });
});
