// Perceived-speed budgets, measured on a clean navigation so a previous
// scenario cannot warm the cache and flatter the numbers.
//
// Modes come from `scripts/sim/budgets.mjs`: "report" records the number and
// always passes (use while tuning), "gate" fails the run when over budget.

const CLS_INIT = `(() => {
  window.__cls = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
})();`;

export async function checkPerf(session, budgets = {}) {
  const mode = budgets.mode ?? "gate";
  const page = await session.context.newPage();
  try {
    await page.addInitScript(CLS_INIT);
    const started = Date.now();
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const lcp = performance.getEntriesByType("largest-contentful-paint");
      const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
      const js = performance
        .getEntriesByType("resource")
        .filter((r) => /\.js(\?|$)/.test(r.name))
        .reduce((sum, r) => sum + (r.encodedBodySize || r.transferSize || 0), 0);
      return {
        lcp: lcp.length ? lcp[lcp.length - 1].startTime : (fcp?.startTime ?? 0),
        jsBytes: js,
        cls: window.__cls ?? 0,
      };
    });

    const gate = (ok) => (mode === "gate" ? ok : true);
    session.check("perf.lcp", gate(m.lcp <= (budgets.lcpMs ?? 2500)), {
      severity: "major",
      data: { lcpMs: Math.round(m.lcp), budget: budgets.lcpMs ?? 2500, mode, wallMs: Date.now() - started },
    });
    session.check("perf.cls", gate(m.cls <= (budgets.cls ?? 0.1)), {
      severity: "major",
      data: { cls: Number(m.cls.toFixed(3)), budget: budgets.cls ?? 0.1, mode },
    });
    session.check("perf.js-budget", gate(m.jsBytes / 1024 <= (budgets.jsKb ?? 300)), {
      severity: "major",
      data: { jsKb: Math.round(m.jsBytes / 1024), budget: budgets.jsKb ?? 300, mode },
    });
  } finally {
    await page.close();
  }
}
