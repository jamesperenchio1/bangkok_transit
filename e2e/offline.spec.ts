import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

/**
 * With no connection the app must still open, from the service worker's
 * precache, and everything except live times must keep working.
 */
test("opens and routes offline after one visit", async ({ page, context, problems }) => {
  await serveArrivals(page, liveDocument);
  await page.goto("/");
  await mapReady(page);
  // The worker must be installed and in control for a reload to be served from it.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  // A shared route link, never opened before: the shell is precached and
  // query strings are ignored, so it still loads.
  await page.goto("/?from=W1&to=E1");

  await expect(page.getByRole("heading", { name: "Bangkok Transit" })).toBeVisible();
  await expect(page.getByText("Offline — live times paused")).toBeVisible();
  await page.getByRole("button", { name: "View route" }).click();
  const sheet = page.getByRole("dialog", { name: /Route from National Stadium to Chit Lom/ });
  await expect(sheet.getByText(/2 stops · 1 change · ~\d+ min/)).toBeVisible();

  await page.getByRole("button", { name: "Browse all stations" }).click();
  await expect(page.getByRole("dialog", { name: "All stations by line" })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("Offline — live times paused")).toBeHidden();

  // Failed tile/asset loads while offline are expected, not defects.
  problems.splice(0, problems.length, ...problems.filter((p) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch|^console: tq$/.test(p)));
});
