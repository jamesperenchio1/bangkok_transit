import { expect, forgiveNetworkErrors, mapReady, servePlaces, test } from "./fixtures";

const paragon = {
  id: "places/siam-paragon",
  displayName: { text: "Siam Paragon" },
  formattedAddress: "991 Rama I Rd, Pathum Wan, Bangkok",
  location: { latitude: 13.7467785, longitude: 100.534954 },
  types: ["shopping_mall", "point_of_interest"],
  primaryTypeDisplayName: { text: "Shopping mall" },
};

test.use({ placesOnline: true, serviceWorkers: "block" });

test.describe("place search", () => {
  // With the service worker blocked (so the requests can be mocked) Serwist's
  // injected client code throws on a missing registration. That is an
  // artifact of blocking it, not of the app, so it is the one error forgiven.
  test.afterEach(({ problems }) => {
    const kept = problems.filter((p) => !p.includes("reading 'waiting'"));
    problems.splice(0, problems.length, ...kept);
  });

  test("finds a mall, shows its nearest station, and routes to it", async ({ page }) => {
    await servePlaces(page, [paragon]);
    await page.goto("/");
    await mapReady(page);
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("paragon");

    const option = page.getByRole("option", { name: /Siam Paragon/ });
    await expect(option).toBeVisible();
    await expect(option).toContainText("Shopping mall");
    await option.click();

    const card = page.locator(".maplibregl-popup");
    await expect(card.getByText("Siam Paragon")).toBeVisible();
    await expect(card.getByText(/Nearest station/)).toContainText("Siam");
    await card.getByRole("button", { name: /Set .* as destination/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("to")).toBe("CEN");
  });

  test("can be switched off: no request is made", async ({ page }) => {
    let calls = 0;
    await page.route("https://places.googleapis.com/**", (route) => {
      calls++;
      return route.fulfill({ json: { places: [] } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /^Place search/ }).click();
    await page.getByRole("switch", { name: "Search places online" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("paragon");
    await expect(page.getByText("No stations found.").first()).toBeVisible();
    expect(calls).toBe(0);
  });

  test("a failing service says so and leaves station search working", async ({ page, problems }) => {
    await page.route("https://places.googleapis.com/**", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: "Search stations" }).click();
    await page.getByRole("combobox").fill("siam");
    await expect(page.getByRole("option", { name: /Siam/ }).first()).toBeVisible();
    await expect(page.getByText(/Place search unavailable/)).toBeVisible();
    // The browser logs the aborted request itself; that is the scenario.
    forgiveNetworkErrors(problems);
  });
});
