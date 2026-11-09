import { expect, test } from "./fixtures";

test.describe("search & AI discoverability", () => {
  test("serves robots, sitemap and llms.txt", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBe(true);
    const body = await robots.text();
    expect(body).toContain("Sitemap: https://bangkok-transit.com/sitemap.xml");
    expect(body).toContain("ClaudeBot");
    expect(body).not.toMatch(/Disallow:\s*\//);
    // The AI-use preference, stated in the `*` group and in a named crawler's group.
    const signal = "Content-Signal: search=yes, ai-input=yes, ai-train=no";
    expect(body.split("\n").filter((l) => l === signal).length).toBeGreaterThan(10);
    expect(body).toMatch(/User-Agent: ClaudeBot\nAllow: \/\nContent-Signal: /i);

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://bangkok-transit.com/lines/bts-sukhumvit-line</loc>");

    const llms = await request.get("/llms.txt");
    expect(llms.ok()).toBe(true);
    expect(llms.headers()["content-type"]).toContain("text/plain");
    expect(await llms.text()).toContain("# Bangkok Transit");
  });

  test("publishes an API catalog, its OpenAPI description, and markdown twins with the right types", async ({ request }) => {
    // These files have no (or an unusual) extension, so their Content-Type
    // comes from public/_headers; only the real asset server shows whether it applies.
    const catalog = await request.get("/.well-known/api-catalog");
    expect(catalog.status()).toBe(200);
    expect(catalog.headers()["content-type"]).toContain("application/linkset+json");
    expect((await catalog.json()).linkset.map((e: { anchor: string }) => e.anchor)).toEqual([
      "https://live.bangkok-transit.com/arrivals.json",
      "https://bangkok-transit.com/api/v1",
    ]);

    const api = await request.get("/openapi.json");
    expect(api.status()).toBe(200);
    expect(api.headers()["content-type"]).toContain("application/openapi+json");
    const apiPaths = Object.keys((await api.json()).paths);
    expect(apiPaths).toContain("/arrivals.json");
    expect(apiPaths).toContain("/api/v1/route");

    for (const path of ["/md/index.md", "/md/lines/mrt-blue-line.md", "/md/stations/siam-cen.md"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"], path).toContain("text/markdown");
      expect(await res.text(), path).toMatch(/^# .+\n\nCanonical page: https:\/\/bangkok-transit\.com/);
    }
    expect((await request.get("/md/lines/nope.md")).status()).toBe(404);
  });

  test("each content page links to its markdown twin", async ({ request }) => {
    const html = await (await request.get("/lines/mrt-blue-line")).text();
    expect(html).toContain('rel="alternate" type="text/markdown" href="https://bangkok-transit.com/md/lines/mrt-blue-line.md"');
    const home = await (await request.get("/")).text();
    expect(home).toContain('type="text/markdown" href="https://bangkok-transit.com/md/index.md"');
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
