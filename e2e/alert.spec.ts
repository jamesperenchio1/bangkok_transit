import AxeBuilder from "@axe-core/playwright";
import { expect, liveDocument, serveArrivals, test } from "./fixtures";

test.describe("station alert", () => {
  test.beforeEach(async ({ page }) => {
    await serveArrivals(page, liveDocument);
  });

  test("rings when the rider reaches their station, and says so for screen readers", async ({ page, context }) => {
    // Start far from the destination: nothing rings.
    await context.setGeolocation({ latitude: 13.8021, longitude: 100.5535 }); // Mo Chit
    await page.goto("/?from=N8&to=CEN");
    await page.getByRole("button", { name: "View route" }).click();
    const sheet = page.getByRole("dialog", { name: /Route from/ });
    await sheet.getByRole("switch", { name: /Alert me near my stop/ }).click();
    await expect(sheet.getByRole("switch", { name: /Alert me near my stop/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/is your station/)).toHaveCount(0);

    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);

    // Arrived at the destination: the chime and the on-screen alert.
    await context.setGeolocation({ latitude: 13.7457, longitude: 100.5342 }); // Siam
    await expect(page.getByRole("alert").filter({ hasText: /Siam is your station/ })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss alert" }).click();
    await expect(page.getByText(/is your station/)).toHaveCount(0);
  });
});
