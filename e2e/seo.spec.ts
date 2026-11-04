import { expect, test } from "./fixtures";

test.describe("search & AI discoverability", () => {
  test("serves robots, sitemap and llms.txt", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBe(true);
    const body = await robots.text();
    expect(body).toContain("Sitemap: https://bangkok-transit.com/sitemap.xml");
    expect(body).toContain("ClaudeBot");
    expect(body).not.toMatch(/Disallow:\s*\//);

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://bangkok-transit.com/lines/bts-sukhumvit-line</loc>");

    const llms = await request.get("/llms.txt");
    expect(llms.ok()).toBe(true);
    expect(llms.headers()["content-type"]).toContain("text/plain");
    expect(await llms.text()).toContain("# Bangkok Transit");
  });

  test("every sitemap URL resolves", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const paths = [...sitemap.matchAll(/<loc>https:\/\/bangkok-transit\.com([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
    expect(paths.length).toBeGreaterThan(400);
    // Sample every 10th page: the full set is the build's job (tests/seo.test.ts).
    for (const path of paths.filter((_, i) => i % 10 === 0)) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
    }
  });

  test("home page has indexable metadata and structured data", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Bangkok BTS & MRT Map/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /live BTS train arrivals/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /bangkok-transit\.com/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /og-default\.png/);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.length).toBeGreaterThan(0);
    for (const block of ld) expect(() => JSON.parse(block)).not.toThrow();
  });

  test("a station page renders crawlable content and links to the map", async ({ page }) => {
    await page.goto("/stations/siam-cen");
    await expect(page.getByRole("heading", { level: 1, name: /Siam station/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Plan a route from Siam/ })).toHaveAttribute("href", "/?from=CEN");
  });

  test("a branched line is listed branch by branch, not as one run", async ({ page }) => {
    await page.goto("/lines/mrt-pink-line");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(2);
    // The spur starts at its junction (Muang Thong Thani) and never follows Min Buri.
    const spur = page.locator("section", { has: page.getByRole("heading", { level: 3, name: /^Muang Thong Thani to / }) });
    await expect(spur.getByRole("listitem")).toHaveCount(3);
    await expect(spur.getByRole("listitem").first()).toContainText("PK10");
    await expect(spur).not.toContainText("Min Buri");
    // A single-run line keeps its plain ordered list.
    await page.goto("/lines/bts-sukhumvit-line");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(0);
  });

  test("a route page explains the trip", async ({ page }) => {
    await page.goto("/routes/siam-cen-to-asok-e4");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Siam to Asok");
    await expect(page.getByText("Step by step")).toBeVisible();
  });

  test("unknown pages are a real 404", async ({ request }) => {
    expect((await request.get("/stations/not-a-station")).status()).toBe(404);
  });
});
