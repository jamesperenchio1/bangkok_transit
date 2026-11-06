import { expect, forgiveNetworkErrors, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

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

  const beforeOffline = problems.length;
  await context.setOffline(true);
  // A shared route link, never opened before: the shell is precached and
  // query strings are ignored, so it still loads.
  await page.goto("/?from=W1&to=E1");

  await expect(page.getByRole("heading", { name: "Bangkok Transit" })).toBeVisible();
  await expect(page.getByText("Offline — live times paused")).toBeVisible();
  await page.getByRole("button", { name: "View route" }).click();
  const sheet = page.getByRole("dialog", { name: /Route from National Stadium to Chit Lom/ });
  await expect(sheet.getByText(/2 stops · 1 change · ~\d+ min/)).toBeVisible();

  await page.getByRole("button", { name: "Search stations" }).click();
  await expect(page.getByTestId("browse-stations")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("Offline — live times paused")).toBeHidden();

  // Going offline makes requests fail and the browser/MapLibre log each one:
  // that is the scenario, not a defect. Only console noise after this point
  // is forgiven; a page error or CSP violation still fails the test.
  forgiveNetworkErrors(problems, beforeOffline);
});
