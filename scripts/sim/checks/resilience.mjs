// The promises the app makes about resilience: no broken asset on load, a
// service worker that actually controls the page, and a route that still works
// with the network off. All three were previously untested.

const ASSET_TIMEOUT = 20000;

export async function checkNetwork(session) {
  const page = await session.context.newPage();
  const bad = [];
  try {
    page.on("response", (res) => {
      const url = res.url();
      if (!url.startsWith(session.cfg.baseURL)) return;
      if (res.status() >= 400) bad.push({ status: res.status(), url: url.slice(session.cfg.baseURL.length) });
    });
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    session.check("network.no-404", bad.length === 0, {
      severity: "major",
      data: { count: bad.length, sample: bad.slice(0, 6) },
    });
  } finally {
    await page.close();
  }
}

export async function checkServiceWorker(session) {
  const page = session.page;
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "load" });
  const state = await page.evaluate(async () => ({
    controlled: Boolean(navigator.serviceWorker.controller),
    caches: typeof caches === "undefined" ? [] : await caches.keys(),
  }));
  session.check("sw.no-stale", state.controlled && state.caches.length > 0, {
    severity: "major",
    data: state,
  });
}

export async function checkOffline(session) {
  const page = session.page;
  await page.goto("/?from=W1&to=E1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await session.setOffline(true);
  try {
    await page.goto("/?from=W1&to=E1", { waitUntil: "domcontentloaded", timeout: ASSET_TIMEOUT }).catch(() => {});
    const heading = await page.locator("h1").first().innerText().catch(() => "");
    const controls = await page.getByRole("button", { name: /view route/i }).count();
    session.check("offline.route-works", heading.length > 0 && controls > 0, {
      severity: "major",
      data: { heading, viewRoute: controls },
    });
  } finally {
    await session.setOffline(false);
  }
}
