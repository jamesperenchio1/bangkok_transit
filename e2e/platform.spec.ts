import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

// Header and cache checks are about the server, not the viewport: once is enough.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "server behaviour does not vary by viewport");
});

test.describe("security headers", () => {
  test("the CSP is tight: no eval, no wildcards, no framing, no plugins", async ({ request }) => {
    const csp = (await request.get("/")).headers()["content-security-policy"];
    const directives = Object.fromEntries(
      csp.split(";").map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values];
      }),
    );
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
    // Every origin the app may talk to, exactly - a new one must be a conscious change.
    expect([...directives["connect-src"]].sort()).toEqual(
      ["'self'", "https://cloudflareinsights.com", "https://live.bangkok-transit.com", "https://photon.komoot.io", "https://tiles.openfreemap.org"].sort(),
    );
  });

  test("other hardening headers are present", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe("geolocation=(self)");
  });

  test("the home page, and only the home page, names the map's first downloads for Early Hints", async ({ request }) => {
    // public/_headers: Cloudflare turns these into a 103 once Early Hints is on.
    const link = (await request.get("/")).headers()["link"] ?? "";
    expect(link).toContain("<https://tiles.openfreemap.org>; rel=preconnect");
    expect(link).toContain("<https://tiles.openfreemap.org/styles/liberty>; rel=preload; as=fetch; crossorigin");
    expect(link).toContain("</line-geometry.json>; rel=preload; as=fetch; crossorigin");
    // Only the page that has the map: the SEO pages don't need these downloads.
    expect((await request.get("/lines")).headers()["link"]).toBeUndefined();
  });
});

test.describe("caching", () => {
  test("hashed build output is immutable; the service worker is always revalidated", async ({ request, page }) => {
    await serveArrivals(page, liveDocument);
    await page.goto("/");
    const asset = await page.evaluate(
      () => (performance.getEntriesByType("resource").find((e) => e.name.includes("/_next/static/")) as PerformanceEntry | undefined)?.name,
    );
    expect(asset, "page loaded a hashed asset").toBeTruthy();
    expect((await request.get(asset!)).headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await request.get("/sw.js")).headers()["cache-control"]).toBe("no-cache");
  });

  test("the service worker never stores the live arrivals document", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    await page.goto("/");
    await mapReady(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(500); // let the first poll land after the reload
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
      }
      return urls;
    });
    expect(cached.length, "the precache exists").toBeGreaterThan(0);
    expect(cached.filter((u) => u.includes("arrivals.json"))).toEqual([]);
  });
});

test.describe("installable app", () => {
  test("the manifest describes a standalone app with sized icons", async ({ request }) => {
    const manifest = await (await request.get("/manifest.json")).json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.name).toContain("Bangkok");
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes.some((s: string) => /192/.test(s))).toBe(true);
    expect(sizes.some((s: string) => /512/.test(s))).toBe(true);
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  });
});

test("an unknown path gets a real 404, not a silent redirect to the app", async ({ request }) => {
  const res = await request.get("/definitely-not-a-page", { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});
