import { stations } from "../data/stations";
import {
  agedArrivals,
  arrivalsFor,
  documentWith,
  downDocument,
  expect,
  failArrivals,
  forgiveNetworkErrors,
  liveDocument,
  openStationCard,
  serveArrivals,
  test,
} from "./fixtures";

/**
 * The station card is the app's core promise: show what we know, honestly.
 * One test per state it can be in, each asserting what the rider reads.
 */

const SIAM = "CEN";
const FIVE_MIN = 5 * 60_000;

test.describe("station card states", () => {
  test("live: every known train in both directions, no staleness markers", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.getByText("→ Kheha")).toBeVisible();
    await expect(card.getByText("→ Khu Khot")).toBeVisible();
    const columns = card.locator("ul");
    await expect(columns).toHaveCount(2);
    await expect(columns.nth(0).getByRole("listitem")).toHaveCount(3);
    await expect(columns.nth(0).getByRole("listitem").first()).toContainText("2 min");
    await expect(columns.nth(1).getByRole("listitem").first()).toContainText("3 min");
    await expect(card.getByText(/Updated/)).toBeVisible();
    await expect(card).not.toContainText(/last known|as of/);
  });

  test("partial: shows only the trains we know - one train, one direction", async ({ page }) => {
    const reading = arrivalsFor(SIAM, [4]);
    reading.platforms[1].trains = []; // upstream listed nothing for the other direction
    await serveArrivals(page, () => documentWith(reading));
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.locator("ul")).toHaveCount(1);
    await expect(card.getByRole("listitem")).toHaveCount(1);
    await expect(card.getByRole("listitem")).toContainText("4 min");
    await expect(card.getByText("→ Khu Khot")).toHaveCount(0);
    // The old dead-end message must not come back while a train is known.
    await expect(card).not.toContainText("No live arrivals");
  });

  test("last known: old times stay up, counted down, flagged amber with their age", async ({ page }) => {
    // 5 min old, trains 12 and 20 min after *that* moment -> ~7 and ~15 min from now.
    await serveArrivals(page, () => documentWith(agedArrivals(SIAM, FIVE_MIN)));
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    const first = card.locator("ul").nth(0).getByRole("listitem");
    await expect(first.first()).toContainText("7 min");
    await expect(first.nth(1)).toContainText("15 min");
    const updated = card.getByText(/Updated 5 min ago · last known/);
    await expect(updated).toBeVisible();
    await expect(updated).toHaveClass(/amber/);
  });

  test("carried over: a direction upstream stopped listing keeps its old trains, labelled", async ({ page }) => {
    const reading = arrivalsFor(SIAM, [4, 9]);
    const carriedFrom = new Date(Date.now() - 3.5 * 60_000).toISOString().replace("Z", "");
    reading.platforms[1] = { ...reading.platforms[1], trains: reading.platforms[1].trains.slice(0, 1), carried_from: carriedFrom };
    await serveArrivals(page, () => documentWith(reading));
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.locator("ul")).toHaveCount(2);
    const note = card.getByText(/as of 3 min ago/);
    await expect(note).toHaveCount(1);
    await expect(note).toHaveClass(/amber/);
    // The note belongs to the Khu Khot column, not the fresh Kheha one.
    const khuKhot = card.locator("div.min-w-0").filter({ hasText: "→ Khu Khot" });
    await expect(khuKhot).toContainText("as of 3 min ago");
    await expect(card.locator("div.min-w-0").filter({ hasText: "→ Kheha" })).not.toContainText("as of");
  });

  test("not running: says so with the next service time, no doubled tilde", async ({ page }) => {
    const reading = { ...arrivalsFor(SIAM), service_active: false, next_service: "~05:30", platforms: [] };
    await serveArrivals(page, () => documentWith(reading));
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.getByText("Not running — next ~05:30")).toBeVisible();
    await expect(card).not.toContainText("~~");
  });

  test("source down with nothing held: names the outage", async ({ page }) => {
    await serveArrivals(page, downDocument);
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.getByText(/down at the source/)).toBeVisible();
  });

  test("source down but old times held: still shows them, and says the source is down", async ({ page }) => {
    const down = downDocument();
    await serveArrivals(page, () => ({ ...documentWith(agedArrivals(SIAM, FIVE_MIN)), status: down.status }));
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.locator("ul").nth(0).getByRole("listitem").first()).toContainText("7 min");
    await expect(card.getByText(/last known, source down/)).toBeVisible();
  });

  test("offline: held times stay and are labelled offline", async ({ page, context, problems }) => {
    await serveArrivals(page, () => documentWith(agedArrivals(SIAM, FIVE_MIN)));
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.getByText(/last known$/)).toBeVisible();
    const beforeOffline = problems.length;
    await context.setOffline(true);
    await expect(card.getByText(/last known, offline/)).toBeVisible();
    await expect(card.locator("ul").nth(0).getByRole("listitem").first()).toContainText("min");
    forgiveNetworkErrors(problems, beforeOffline);
  });

  test("unreachable server before any data: says times are unavailable, not blank", async ({ page, problems }) => {
    await failArrivals(page);
    await page.goto("/");
    const card = await openStationCard(page, "siam");
    await expect(card.getByText(/Live times unavailable right now/)).toBeVisible();
    forgiveNetworkErrors(problems); // the refused requests are the scenario
  });

  test("a station with no live feed says so", async ({ page }) => {
    await serveArrivals(page, liveDocument);
    const noLive = stations.find((s) => !s.hasLiveArrivals)!;
    await page.goto("/");
    const card = await openStationCard(page, noLive.nameEn);
    await expect(card.getByText("No live data for this line")).toBeVisible();
    await expect(card.getByRole("button", { name: /start/i })).toBeVisible();
  });

  test("Thai: directions, ages and the staleness note are all in Thai", async ({ page }) => {
    await serveArrivals(page, () => documentWith(agedArrivals(SIAM, FIVE_MIN)));
    await page.goto("/");
    await page.locator("[data-lang-toggle]").click();
    const card = await openStationCard(page, "siam");
    await expect(card.getByText("→ เคหะฯ")).toBeVisible();
    await expect(card.getByText(/อัปเดต .*ข้อมูลล่าสุดที่มี/)).toBeVisible();
    await expect(card).not.toContainText("Updated");
  });
});
