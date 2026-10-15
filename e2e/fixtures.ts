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

/** Serves `doc` wherever the app fetches the live arrivals document. */
export async function serveArrivals(page: Page, doc: () => ArrivalsDocument) {
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
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
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
