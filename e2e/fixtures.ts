import { test as base, expect, type Page } from "@playwright/test";
import type { ArrivalsDocument, UpstreamStatus } from "../lib/arrivals-document";
import type { Arrivals } from "../lib/bts";
import { liveStations } from "../data/stations";

/** A payload like the upstream's, stamped now (naive UTC, as the real API does). */
export function arrivalsFor(code: string, etas: number[] = [2, 6, 11]): Arrivals {
  const now = new Date();
  return {
    station: { code, name_en: code, name_th: code, line_color: "#76b729" },
    platforms: [
      {
        platform: "1",
        line_color: "#76b729",
        line_id: 1,
        direction: "เคหะฯ | Kheha",
        direction_key: "E23",
        trains: etas.map((eta, i) => ({
          train_no: String(i),
          destination: "Kheha",
          destination_key: "E23",
          eta_minutes: eta,
          // Half a minute of headroom: the card floors the countdown, so
          // an exact "2 min" would tick to "1 min" the moment the page
          // spends a millisecond rendering it.
          eta_precise: eta + 0.5,
          status: "",
        })),
      },
      {
        platform: "2",
        line_color: "#76b729",
        line_id: 1,
        direction: "คูคต | Khu Khot",
        direction_key: "N24",
        trains: etas.map((eta, i) => ({
          train_no: `b${i}`,
          destination: "Khu Khot",
          destination_key: "N24",
          eta_minutes: eta + 1,
          eta_precise: eta + 1.5,
          status: "",
        })),
      },
    ],
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: now.toISOString(),
    timestamp: now.toISOString().replace("Z", ""),
  };
}

/** A reading `ageMs` old whose ETAs are relative to that older moment (as upstream's are). */
export function agedArrivals(code: string, ageMs: number, etas: number[] = [12, 20]): Arrivals {
  const at = new Date(Date.now() - ageMs);
  return { ...arrivalsFor(code, etas), server_time: at.toISOString(), timestamp: at.toISOString().replace("Z", "") };
}

/** The live document with one station's reading swapped for `reading`. */
export function documentWith(reading: Arrivals, status?: UpstreamStatus): ArrivalsDocument {
  const base = liveDocument();
  return { ...base, arrivals: { ...base.arrivals, [reading.station.code]: reading }, ...(status && { status }) };
}

const okStatus: UpstreamStatus = { state: "ok", since: new Date().toISOString(), lastSuccessAt: null, incidents: [] };

export function liveDocument(): ArrivalsDocument {
  return {
    arrivals: Object.fromEntries(liveStations.map((s) => [s.code, arrivalsFor(s.code)])),
    total: liveStations.length,
    complete: true,
    status: okStatus,
  };
}

export function downDocument(): ArrivalsDocument {
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  return {
    arrivals: {},
    total: liveStations.length,
    complete: true,
    status: { state: "down", since, lastSuccessAt: null, incidents: [{ start: since, end: null }] },
  };
}

/**
 * What the page's `fetch` should answer for the live document: a document, or
 * "fail" for a network failure. Held per page so a later call (a test
 * overriding its beforeEach) replaces the earlier one.
 *
 * Why inside the page, and not only `page.route`: the app starts its live
 * poll once the map has painted, by which time the service worker may already
 * control the page - and Playwright cannot route requests the worker handles.
 * Answering in `fetch` itself does not depend on that timing. (`page.route`
 * is kept too, for any request that gets past it.)
 */
const arrivalsSource = new WeakMap<Page, () => ArrivalsDocument | "fail">();

async function answerArrivalsInPage(page: Page, source: () => ArrivalsDocument | "fail") {
  const first = !arrivalsSource.has(page);
  arrivalsSource.set(page, source);
  if (!first) return;
  await page.exposeFunction("__fixtureArrivals", () => arrivalsSource.get(page)!());
  await page.addInitScript(() => {
    const w = window as unknown as { __fixtureArrivals: () => Promise<unknown> };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/arrivals.json")) return realFetch(input, init);
      // Like a real network: nothing is reachable while the device is offline.
      if (!navigator.onLine) throw new TypeError("Failed to fetch");
      const doc = await w.__fixtureArrivals();
      if (doc === "fail") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(doc), {
        headers: { "content-type": "application/json", date: new Date().toUTCString() },
      });
    };
  });
}

/** Makes the live document unreachable (a network failure, not an error status). */
export async function failArrivals(page: Page) {
  await answerArrivalsInPage(page, () => "fail");
  await page.route("**/arrivals.json", (route) => route.abort("failed"));
}

/** Opens a station's card by searching for it (no pixel-perfect map taps) and returns the card. */
export async function openStationCard(page: Page, query: string) {
  await page.getByRole("button", { name: /Search stations|ค้นหา/ }).click();
  await page.getByRole("combobox").fill(query);
  await page.getByRole("option").first().click();
  const card = page.locator(".maplibregl-popup");
  await expect(card).toBeVisible();
  return card;
}

/**
 * Drops the console errors the browser itself logs when a request fails
 * (`Failed to load resource`, MapLibre's tile errors) from `problems`, from
 * index `from` on. For tests that deliberately cut the network: those lines
 * are the scenario, not a defect. Page errors and CSP violations are never
 * dropped, so a real bug during the outage still fails the test.
 */
export function forgiveNetworkErrors(problems: string[], from = 0) {
  const kept = problems.filter((p, i) => i < from || !p.startsWith("console:") || p.startsWith("console: CSP violation"));
  problems.splice(0, problems.length, ...kept);
}

/** Serves `doc` wherever the app fetches the live arrivals document. */
export async function serveArrivals(page: Page, doc: () => ArrivalsDocument) {
  await answerArrivalsInPage(page, doc);
  await page.route("**/arrivals.json", (route) =>
    route.fulfill({
      json: doc(),
      headers: {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Date, Age",
        date: new Date().toUTCString(),
      },
    }),
  );
}

/** Waits until MapLibre has loaded the style and our layers. */
export async function mapReady(page: Page) {
  await page.waitForFunction(() => {
    const map = (window as { __map?: { loaded(): boolean; getLayer(id: string): unknown } }).__map;
    return !!map && map.loaded() && !!map.getLayer("stations-layer");
  });
}

/**
 * Every test fails on a page error, a console error, or a CSP violation -
 * so a broken script or a new third-party origin can't pass silently.
 */
export const PHOTON_URL = "https://photon.komoot.io/**";

/** Answers the online place search with `features` (Photon's GeoJSON shape). */
export async function servePlaces(page: Page, features: unknown[]) {
  await page.route(PHOTON_URL, (route) =>
    route.fulfill({
      json: { type: "FeatureCollection", features },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
}

export const test = base.extend<{ problems: string[]; placesOnline: boolean }>({
  // Online place search is off for every test but the ones that opt in (with
  // `test.use({ placesOnline: true, serviceWorkers: "block" })`). The service
  // worker answers cross-origin fetches itself, where Playwright's request
  // mocking cannot reach, so without blocking it a test would hit the real
  // service. Seeded only when nothing is saved, so reloads keep the choice.
  placesOnline: [false, { option: true }],
  problems: [
    async ({ page, placesOnline }, use) => {
      // No test may depend on the real third-party service: it answers
      // "nothing found" unless a test serves its own results.
      await servePlaces(page, []);
      await page.addInitScript((online) => {
        try {
          if (!localStorage.getItem("bts:settings:v1")) {
            localStorage.setItem("bts:settings:v1", JSON.stringify({ onlinePlaces: online }));
          }
        } catch {
          // storage unavailable
        }
      }, placesOnline);
      const problems: string[] = [];
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) =>
          console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
        );
      });
      await use(problems);
      expect(problems, "no errors or CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
