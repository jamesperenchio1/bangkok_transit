import { expect, liveDocument, openStationCard, serveArrivals, test } from "./fixtures";

/**
 * Phone layout. The Pixel 7 project is 412px wide; riders also have 320-390px
 * iPhones and 430px Pro Max models, where the header is tightest.
 */
const sizes = [
  { name: "320 (small)", width: 320, height: 640 },
  { name: "390 (iPhone)", width: 390, height: 844 },
  { name: "430 (Pro Max)", width: 430, height: 932 },
];

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the viewport matrix is set per test; run it once");
});

for (const size of sizes) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    test.beforeEach(async ({ page }) => {
      await serveArrivals(page, liveDocument);
    });

    test("nothing scrolls sideways", async ({ page }) => {
      await page.goto("/");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("header controls are all at least 44px and inside the screen", async ({ page }) => {
      await page.goto("/?from=W1&to=E1"); // the busiest header: swap + clear + language + search + settings
      const header = page.getByRole("banner");
      for (const button of await header.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        const label = (await button.getAttribute("aria-label")) ?? "button";
        expect(box.width, `${label} width`).toBeGreaterThanOrEqual(43.5);
        expect(box.height, `${label} height`).toBeGreaterThanOrEqual(43.5);
        expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(size.width + 0.5);
      }
    });

    test("the language button is one control that offers the other language", async ({ page }) => {
      await page.goto("/");
      const toggle = page.locator("[data-lang-toggle]");
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toHaveText("TH");
      await toggle.click();
      await expect(toggle).toHaveText("EN");
      await expect(page.getByRole("heading", { name: "รถไฟฟ้ากรุงเทพฯ" })).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveText("TH");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  });
}

for (const size of sizes.slice(1)) {
  test.describe(`hint text at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    test.beforeEach(async ({ page }) => {
      await serveArrivals(page, liveDocument);
    });

    for (const lang of ["en", "th"] as const) {
      test(`the idle hint is fully readable in ${lang}`, async ({ page }) => {
        await page.goto("/");
        if (lang === "th") await page.locator("[data-lang-toggle]").click();
        const hint = page.getByRole("banner").locator("p").first();
        await expect(hint).toBeVisible();
        const clipped = await hint.evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(clipped, "hint is cut off").toBeLessThanOrEqual(1);
        const header = (await page.getByRole("banner").boundingBox())!;
        expect(header.height, "header stays compact").toBeLessThanOrEqual(80);
      });
    }

    test("the route header names both stations without hiding the buttons", async ({ page }) => {
      await page.goto("/?from=W1&to=E1");
      const hint = page.getByRole("banner").locator("p").first();
      await expect(hint).toContainText("National Stadium");
      await expect(hint).toContainText("Chit Lom");
      await expect(page.getByRole("button", { name: "Swap start and destination" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
    });
  });
}

test.describe("on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ page }) => {
    await serveArrivals(page, liveDocument);
  });

  test("the station card fits the screen width", async ({ page }) => {
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    const box = (await card.locator(".maplibregl-popup-content").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });

  test("the nearest-station pill sits fully on screen", async ({ page }) => {
    await page.goto("/");
    const pill = page.getByRole("button", { name: /Nearest: Siam/ });
    await expect(pill).toBeVisible();
    const box = (await pill.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });

  test("the route sheet never covers more than 70% of the screen", async ({ page }) => {
    await page.goto("/?from=N8&to=BL22");
    await page.getByRole("button", { name: "View route" }).click();
    const sheet = page.getByRole("dialog", { name: /Route from/ });
    await expect(sheet).toBeVisible();
    // It slides in; measure once it has settled on the bottom edge.
    await expect
      .poll(async () => {
        const box = (await sheet.boundingBox())!;
        return Math.round(box.y + box.height);
      })
      .toBeLessThanOrEqual(844 + 1);
    const box = (await sheet.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(844 * 0.7 + 1);
  });
});
