import { expect, test } from "@playwright/test";
import { liveDocument, serveArrivals } from "./fixtures";

/**
 * The performance budget for a first visit: the map is the product, so it is
 * measured as a rider on a mid-range phone on Slow 4G would first see it.
 *
 * Chromium only, through the DevTools protocol: 1.6 Mbps down / 750 kbps up /
 * 150 ms latency (Slow 4G) with the CPU slowed 4x. The page is loaded in a
 * fresh browser context with an empty HTTP cache, and measurement runs from
 * navigation until the transit network has drawn (`window.__map` with the
 * stations layer) plus a short settle, so live-train and tick work after the
 * map is on screen does not count against first paint.
 *
 * Budgets are deliberately loose - they are a regression guard, not a target:
 * LCP <= 6000 ms, CLS <= 0.1, JS transfer <= 600 KB. LCP here is the MapLibre
 * attribution block: the map itself is a canvas, which LCP does not count, so
 * the number tracks the map bundle rather than the header. Measured runs land
 * between 4.4 and 5.0 s under this profile; 6 s keeps that variance from
 * failing CI while a real regression still blows past it. Numbers measured here are
 * logged and attached to the report, so a failure shows how far off it is.
 *
 * The whole spec is skipped unless PERF is set (`npm run test:perf`), because
 * throttling makes it several times slower than the rest of the suite. It runs
 * in the `desktop` project only: one Chromium viewport is the measurement, and
 * the phone profiles exist to test behaviour, not speed. Retried once and
 * serial because a cold cache and a busy CI runner occasionally produce a
 * one-off number; a real regression fails both attempts.
 */

const PERF = !!process.env.PERF;

const LCP_BUDGET_MS = 6_000;
const CLS_BUDGET = 0.1;
const JS_BUDGET_KB = 600;

/** Slow 4G as measured here, in bytes/second (CDP takes throughput, not bits). */
const SLOW_4G = {
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

type Metrics = {
  lcp: number;
  lcpElement: string;
  cls: number;
  jsKb: number;
  jsRequests: number;
  jsUrls: string[];
};

const INIT_SCRIPT = `(() => {
  const perf = { lcp: 0, lcpElement: "", cls: 0 };
  window.__perf = perf;
  const describe = (el) => {
    if (!el) return "";
    const cls = (el.getAttribute && el.getAttribute("class")) || "";
    const id = (el.id ? "#" + el.id : "");
    return el.tagName.toLowerCase() + id + (cls ? "." + cls.split(/\\s+/).slice(0, 2).join(".") : "");
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perf.lcp = entry.startTime;
        perf.lcpElement = describe(entry.element);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Only unexpected movement counts: a shift the rider caused (opening a
        // sheet, typing) is not a layout-instability defect.
        if (!entry.hadRecentInput) perf.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // A browser without these entry types reports zeros, and the budgets
    // still hold - there is nothing to measure.
  }
})();`;

test.describe.configure({ mode: "serial", retries: 1 });

test.skip(!PERF, "performance budget: run with PERF=1 (npm run test:perf)");

test("first load meets the performance budget on Slow 4G", async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "measured on the desktop Chromium project only");
  test.skip(browserName !== "chromium", "CDP throttling is Chromium-only");
  // Throttling plus a cold cache: slow links are the point, so let it take its time.
  test.slow();
  test.setTimeout(180_000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: SLOW_4G.latency,
    downloadThroughput: SLOW_4G.downloadThroughput,
    uploadThroughput: SLOW_4G.uploadThroughput,
    connectionType: "cellular3g",
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // The live document is answered locally: the budget is about our assets, not
  // about a third-party host's latency on the day CI runs.
  await serveArrivals(page, liveDocument);
  await page.addInitScript(INIT_SCRIPT);

  await page.goto("/", { waitUntil: "domcontentloaded" });

  // The map has painted: MapLibre has the style, our stations layer exists and
  // the canvas is in the page. Lines are drawn with the stations (the straight
  // stand-in if the curved geometry is still in flight), so this is the point
  // the rider sees the network.
  await page.waitForFunction(
    () => {
      const map = (window as { __map?: { getLayer?(id: string): unknown; getCanvas?(): HTMLCanvasElement } }).__map;
      return !!map && !!map.getCanvas?.() && !!map.getLayer?.("stations-layer");
    },
    null,
    { timeout: 120_000 },
  );

  // Let the last paint and any arrive-together chunks settle, without waiting
  // out the post-map work (train layer, offline warm-up), which is deliberate
  // and not part of the first paint.
  await page.waitForTimeout(1_500);

  const metrics = await page.evaluate((): Metrics => {
    const observed = (window as unknown as { __perf?: { lcp: number; lcpElement: string; cls: number } }).__perf ?? {
      lcp: 0,
      lcpElement: "",
      cls: 0,
    };
    const js = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((entry) => {
      try {
        return /\.js$/.test(new URL(entry.name).pathname);
      } catch {
        return false;
      }
    });
    // transferSize is the wire cost; encodedBodySize is the same bytes when a
    // resource came from the cache or a worker (where transferSize is 0).
    const bytes = js.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize), 0);
    return {
      lcp: Math.round(observed.lcp),
      lcpElement: observed.lcpElement,
      cls: Number(observed.cls.toFixed(3)),
      jsKb: Math.round(bytes / 1024),
      jsRequests: js.length,
      jsUrls: js.map((entry) => new URL(entry.name).pathname),
    };
  });

  const line = `[perf] LCP ${metrics.lcp} ms on <${metrics.lcpElement.toLowerCase()}> (budget ${LCP_BUDGET_MS}) · CLS ${metrics.cls} (budget ${CLS_BUDGET}) · JS ${metrics.jsKb} KB in ${metrics.jsRequests} files (budget ${JS_BUDGET_KB} KB)`;
  console.log(line);
  await testInfo.attach("performance-budget.json", {
    body: JSON.stringify({ ...metrics, budgets: { lcpMs: LCP_BUDGET_MS, cls: CLS_BUDGET, jsKb: JS_BUDGET_KB } }, null, 2),
    contentType: "application/json",
  });

  expect(metrics.lcp, `LCP ${metrics.lcp} ms exceeds ${LCP_BUDGET_MS} ms (Slow 4G, 4x CPU): ${line}`).toBeLessThanOrEqual(
    LCP_BUDGET_MS,
  );
  expect(metrics.cls, `CLS ${metrics.cls} exceeds ${CLS_BUDGET}: ${line}`).toBeLessThanOrEqual(CLS_BUDGET);
  expect(metrics.jsKb, `JS transfer ${metrics.jsKb} KB exceeds ${JS_BUDGET_KB} KB: ${line}`).toBeLessThanOrEqual(JS_BUDGET_KB);
});
