import { stationsByCode } from "../data/stations";
import { expect, liveDocument, mapReady, serveArrivals, test } from "./fixtures";

/**
 * What a rider reads, not what the router computes. Every case here was
 * reported by a rider as wrong while the unit tests were green, so each one
 * asserts the text on screen. Station ids in the URLs are the app's internal
 * ids (BL07 is Tha Phra); the codes people see are the operators' (BL01).
 */
test.describe("rider-reported errors", () => {
  test.beforeEach(async ({ page }) => {
    await serveArrivals(page, liveDocument);
  });

  async function openSheet(page: import("@playwright/test").Page, from: string, to: string) {
    await page.goto(`/?from=${from}&to=${to}`);
    await page.getByRole("button", { name: "View route" }).click();
    return page.getByRole("dialog", { name: /Route from/ });
  }

  test("Tha Phra -> Fai Chai names the platform, since both ways end at Lak Song", async ({ page }) => {
    const sheet = await openSheet(page, "BL07", "BL38");
    await expect(sheet.getByText("Board toward Lak Song (first stop Charan Sanitwong 13)")).toBeVisible();
    await expect(sheet.getByText("BL01", { exact: true })).toBeVisible(); // Tha Phra
    await expect(sheet.getByText("BL03", { exact: true })).toBeVisible(); // Fai Chai
  });

  test("National Telecom -> Impact is one change, at Muang Thong Thani", async ({ page }) => {
    const sheet = await openSheet(page, "PK13", "MT01");
    await expect(sheet.getByText(/4 stops · 1 change/)).toBeVisible();
    await expect(sheet.getByText("Board toward MLake Muang Thong Thani")).toBeVisible();
  });

  test("Bang Sue -> Wong Sawang costs 23 baht, one entry fee across Blue and Purple", async ({ page }) => {
    const sheet = await openSheet(page, "BL30", "PP14");
    await expect(page.getByTestId("route-fare").first()).toContainText("฿23");
    await expect(sheet.getByTestId("route-fare")).toContainText("Includes a ฿14 transfer discount");
  });

  test("Blue -> Yellow at Lat Phrao takes the 15 baht entry fee off", async ({ page }) => {
    const sheet = await openSheet(page, "BL25", "YL02");
    await expect(sheet.getByTestId("route-fare")).toContainText("Includes a ฿15 transfer discount");
  });

  test("Purple -> Pink at Nonthaburi Civic Center takes the 15 baht entry fee off, same EMV card", async ({ page }) => {
    const sheet = await openSheet(page, "PP10", "PK02");
    await expect(sheet.getByTestId("route-fare")).toContainText("Includes a ฿15 transfer discount");
    await expect(sheet.getByTestId("route-fare")).toContainText("same contactless (EMV) card");
  });

  test("the map and the search box show the operator's codes, and search finds them", async ({ page }) => {
    await page.goto("/");
    await mapReady(page);
    // Centred on the station itself (from the data), so the narrow mobile viewport sees it too.
    const huaiKhwang = stationsByCode.get("BL23")!;
    const labels = await page.evaluate(async ([lon, lat]) => {
      const map = (window as unknown as { __map: import("maplibre-gl").Map }).__map;
      map.jumpTo({ center: [lon, lat], zoom: 15 });
      await new Promise<void>((resolve) => map.once("idle", () => resolve()));
      return map.queryRenderedFeatures({ layers: ["stations-label-layer"] }).map((f) => `${f.properties.nameEn} ${f.properties.shownCode}`);
    }, [huaiKhwang.lon, huaiKhwang.lat]);
    expect(labels).toContain("Huai Khwang BL18");

    await page.getByRole("button", { name: /search/i }).first().click();
    await page.getByRole("combobox").fill("BL18");
    await expect(page.getByRole("option", { name: /Huai Khwang/ })).toBeVisible();
    await page.getByRole("combobox").fill("RW01");
    await expect(page.getByRole("option", { name: /Krung Thep Aphiwat/ })).toBeVisible();
  });

  test("Si Iam is spelled with a capital i", async ({ page }) => {
    await page.goto("/stations/si-iam-yl17");
    await expect(page.getByRole("heading", { name: /Si Iam/ })).toBeVisible();
  });
});
