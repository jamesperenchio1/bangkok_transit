import { expect, mapReady, test } from "./fixtures";

test.describe("settings", () => {
  test("choices apply to the map at once and survive a reload", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });

    const labels = dialog.getByRole("switch", { name: "Station names" });
    await expect(labels).toHaveAttribute("aria-checked", "true");
    await labels.click();
    await expect(labels).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(() =>
        page.evaluate(() =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__map?.getLayoutProperty("stations-label-layer", "visibility"),
        ),
      )
      .toBe("none");

    await dialog.getByRole("switch", { name: /Skytrain Sukhumvit|Sukhumvit/ }).first().click();
    await expect
      .poll(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page.evaluate(() => (window as any).__map?.getFilter("transit-lines-layer")),
      )
      .toBeTruthy();

    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("dialog", { name: "Settings" }).getByRole("switch", { name: "Station names" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("reset puts everything back", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    const larger = dialog.getByRole("switch", { name: "Larger text" });
    await larger.click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe("112.5%");
    await dialog.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(larger).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe("");
  });
});
