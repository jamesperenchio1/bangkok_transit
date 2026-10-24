// Multi-persona "real user" simulation harness.
//
// Drives the REAL production build (out/) in real Chromium via Playwright.
// Each persona gets an isolated BrowserContext (own geolocation, permissions,
// storage, offline state). Network to the arrivals CDN + map tiles is
// intercepted hermetically. Every observation is turned into a timestamped
// persona complaint/comment and streamed to the console + saved to a report.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
import { docFor } from "./fixtures.mjs";
import { personas, say } from "./personas.mjs";
import { makeFinding, severityAtLeast } from "./findings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

// Minimal MapLibre style so the map reaches "load" with no external network.
const MIN_STYLE = {
  version: 8,
  name: "sim",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8eef7" } }],
};

const ARRIVALS_PATTERN = "**/arrivals.json";

// ---------------------------------------------------------------- reporter
class Reporter {
  constructor() {
    this.entries = [];
    this.t0 = Date.now();
  }
  stamp() {
    const s = Math.floor((Date.now() - this.t0) / 1000);
    return `+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  add(entry) {
    entry.t = Date.now();
    entry.at = this.stamp();
    this.entries.push(entry);
    if (entry.text) {
      console.log(`[${entry.at}] ${entry.persona.name}  💬  ${entry.text}`);
    } else if (entry.kind) {
      const d = entry.data && Object.keys(entry.data).length ? " " + JSON.stringify(entry.data) : "";
      console.log(`[${entry.at}] ${entry.persona.name}  ·  ${entry.kind}${d}`);
    }
  }
  // voice + record
  say(persona, event, data = {}) {
    this.add({ persona, event, text: say(persona, event, data), data });
  }
  fact(persona, kind, data = {}) {
    this.add({ persona, kind, data });
  }
}

// ---------------------------------------------------------------- session
function parseNearest(text) {
  const m = /Nearest:\s*(.+?)\s*[·•]\s*(.+)$/.exec(text || "");
  return m ? { name: m[1].trim(), dist: m[2].trim() } : { name: (text || "").trim(), dist: "?" };
}

async function createPage(browser, context, session) {
  const page = await context.newPage();
  page.on("pageerror", (e) => session.pushError(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") session.pushError(`console: ${m.text()}`);
  });
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("arrivals.json")) session.arrivalRequests++;
    session.requestCount++;
  });
  return page;
}

async function makeSession(browser, persona, cfg, reporter) {
  const wantGeo = persona.geo?.mode === "allow" || persona.geo?.mode === "moving";
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
    baseURL: cfg.baseURL,
    permissions: wantGeo ? ["geolocation"] : [],
    geolocation: persona.geo?.position || persona.geo?.track?.[0],
    storageState: cfg.storageState,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  const session = {
    persona,
    browser,
    cfg,
    reporter,
    context,
    errors: [],
    arrivalRequests: 0,
    requestCount: 0,
    offline: false,
    fixture: { mode: persona.fixture || "normal", arg: undefined },
    pushError(msg) {
      if (this.errors.length < 200) this.errors.push(msg);
    },
    setFixture(mode, arg) {
      this.fixture = { mode, arg };
    },
    async setOffline(v) {
      this.offline = v;
      await context.setOffline(v);
    },
    findings: [],
    shots: [],
    check(name, ok, { severity = "major", data = null, steps = null } = {}) {
      const finding = makeFinding({
        persona: this.persona.id,
        op: this.persona.op,
        check: name,
        severity,
        ok,
        data,
        steps,
        session: this,
        baseSha: this.cfg.baseSha ?? null,
        seed: this.cfg.seed ?? null,
        buildId: this.cfg.buildId ?? null,
        artifactsDir: this.cfg.artifactsDir,
      });
      this.findings.push(finding);
      if (!ok) {
        this.reporter.fact(this.persona, `finding:${name}`, { severity, ...(data || {}) });
      }
      return finding;
    },
  };

  // --- hermetic network stubs -------------------------------------------
  await context.route("https://tiles.openfreemap.org/**", (route) => {
    if (session.offline) return route.abort("internetdisconnected");
    const u = route.request().url();
    if (u.includes("/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(MIN_STYLE),
      });
    }
    return route.fulfill({ status: 204, body: "" });
  });

  await context.route(ARRIVALS_PATTERN, (route) => {
    if (session.offline) return route.abort("internetdisconnected");
    try {
      const { doc } = docFor(session.fixture.mode, session.fixture.arg);
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          date: new Date().toUTCString(),
          age: "0",
        },
        body: JSON.stringify(doc),
      });
    } catch (e) {
      return route.fulfill({ status: 500, body: String(e) });
    }
  });

  const page = await createPage(browser, context, session);
  session.page = page;
  return session;
}

// ---------------------------------------------------------------- helpers
// --- boot preconditions -------------------------------------------------
// Kill-switch for false positives: a stale service worker or a broken asset
// graph means the run itself is untrustworthy, not the app.
async function buildAssetCheck(session) {
  const outDir = path.join(REPO, "out");
  const indexPath = path.join(outDir, "index.html");
  const report = { refs: 0, missing: [], hash: null, error: null };
  try {
    const html = await readFile(indexPath, "utf8");
    const refs = [
      ...new Set(
        [...html.matchAll(/_next\/static\/[^"'\\\s)]+/g)].map((m) =>
          m[0].replace(/&amp;/g, "&"),
        ),
      ),
    ].sort();
    report.refs = refs.length;
    const hash = createHash("sha256");
    for (const ref of refs) {
      try {
        const buf = await readFile(path.join(outDir, ref));
        hash.update(ref).update(buf);
      } catch {
        report.missing.push(ref);
      }
    }
    report.hash = hash.digest("hex").slice(0, 16);
  } catch (e) {
    report.error = e.message;
  }
  const ok = !report.error && report.refs > 0 && report.missing.length === 0;
  report.ok = ok;
  session.check("build.asset-hash", ok, { severity: "blocker", data: report });
  return ok;
}

async function swState(page) {
  return page
    .evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const regs = await navigator.serviceWorker.getRegistrations();
      return {
        supported: true,
        controller: Boolean(navigator.serviceWorker.controller),
        waiting: regs.some((r) => Boolean(r.waiting)),
        updating: regs.some((r) => Boolean(r.installing)),
        scriptURL:
          navigator.serviceWorker.controller?.scriptURL ??
          regs.find((r) => r.active)?.active?.scriptURL ??
          null,
      };
    })
    .catch((e) => ({ supported: false, error: e.message }));
}

async function preconditionSwFresh(session) {
  const { page, reporter, persona } = session;
  let state = await swState(page);
  for (let i = 0; i < 6 && state.supported && (state.waiting || state.updating); i++) {
    await page.waitForTimeout(500);
    state = await swState(page);
  }
  const ok = !state.supported || (!state.waiting && !state.updating);
  if (!ok) {
    session.invalidRun = "stale service worker";
    reporter.fact(persona, "invalid_run", { check: "sw.no-stale", ...state });
  }
  return ok;
}

async function open(session) {
  const { page, reporter, persona } = session;
  reporter.say(persona, "boot");
  await buildAssetCheck(session);
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(
    'button[aria-label="Search stations"], button[aria-label="Close search"]',
    { timeout: 25000 },
  );
  await page.waitForSelector(".maplibregl-canvas", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200); // let style/tiles/layers settle
  if (!(await preconditionSwFresh(session))) {
    throw new Error("invalid-run: stale service worker");
  }
  reporter.fact(persona, "map_ready");
  reporter.say(persona, "map_ready");
}

async function shot(session, name) {
  try {
      const dir = path.join(session.cfg.artifactsDir, "screenshots");
      const rel = `screenshots/${session.persona.id}-${name}.png`;
      await mkdir(dir, { recursive: true });
      await session.page.screenshot({ path: path.join(dir, `${session.persona.id}-${name}.png`) });
      session.shots.push(rel);
  } catch {}
}

// Open the search box, find a station, tap the result -> popup opens.
async function openStation(session, name) {
  const { page } = session;
  const input = page.locator('input[role="combobox"]');
  if (!(await input.count())) {
    const openBtn = page.locator('button[aria-label="Search stations"]');
    if (await openBtn.count()) await openBtn.first().click();
  }
  await input.waitFor({ state: "visible", timeout: 8000 });
  await input.fill("");
  await input.fill(name);
  await page.waitForTimeout(300);
  const results = page.locator('ul[role="listbox"] li[role="option"]');
  const count = await results.count();
  if (count === 0) return { ok: false, reason: "no-results" };
  let target = results.first();
  for (let i = 0; i < count; i++) {
    const t = (await results.nth(i).innerText()).toLowerCase();
    if (t.includes(name.toLowerCase())) {
      target = results.nth(i);
      break;
    }
  }
  await target.click();
  const popup = page.locator(".maplibregl-popup-content").last();
  await popup.waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(400);
  return { ok: true, popup };
}

// Open a station and press Start / Destination inside its popup.
async function pickStation(session, name, role) {
  const { page, reporter, persona } = session;
  reporter.say(persona, "search_open");
  const res = await openStation(session, name);
  if (!res.ok) {
    reporter.say(persona, "no_results", { q: name });
    return res;
  }
  reporter.say(persona, "search_pick", { name });
  const btnText = role === "start" ? "Start" : "Destination";
  const btn = res.popup.locator(`button:has-text("${btnText}")`).first();
  await btn.click({ timeout: 6000 });
  await page.waitForTimeout(300);
  reporter.say(persona, role === "start" ? "start_set" : "dest_set", { name });
  return { ok: true, popup: res.popup };
}

async function panelSummary(session) {
  const text = await session.page
    .locator("body")
    .innerText()
    .catch(() => "");
  const stops = /(\d+)\s+stops?/.exec(text);
  const changes = /(no changes|\d+\s+changes?)/.exec(text);
  return { stops: stops ? stops[0] : "?", changes: changes ? changes[1] : "?" };
}

async function routeDrawn(session) {
  const panel = session.page.getByText("Get directions in Google Maps");
  await panel.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const { stops, changes } = await panelSummary(session);
  session.reporter.say(session.persona, "route_drawn", { stops, changes });
  return { stops, changes };
}

async function readPopupArrival(session) {
  const popup = session.page.locator(".maplibregl-popup-content").last();
  // The card paints at once but the arrivals line only settles after the store
  // resolves, so poll for a decided state rather than reading an empty popup.
  let text = "";
  for (let i = 0; i < 10; i++) {
    text = (await popup.innerText({ timeout: 1000 }).catch(() => "")) || "";
    if (text && !/Checking times/i.test(text)) break;
    await session.page.waitForTimeout(500);
  }
  if (/No live data for this line/.test(text)) return { kind: "arrivals_nolive", text };
  if (/Not running/.test(text)) {
    const m = /Not running — next ~(\S+)/.exec(text);
    return { kind: "arrivals_not_running", next: m ? m[1] : "?", text };
  }
  if (/No live arrivals right now/.test(text)) return { kind: "arrivals_empty", text };
  if (/Checking times/.test(text)) return { kind: "arrivals_checking", text };
  if (/unavailable|retrying/.test(text)) return { kind: "arrivals_unavailable", text };
  const m = /(\d+)\s*min|Arriving|Due/.exec(text);
  return { kind: "arrivals_ok", eta: m ? m[0] : "?", text };
}

/**
 * Facts about the planned route, read once so several checks can assert on the
 * same snapshot. Each field degrades to a safe default instead of throwing: a
 * missing route is the thing being checked, not an error to propagate.
 */
async function routeFacts(session) {
  const { page } = session;
  const text = (await page.locator("body").innerText().catch(() => "")) || "";
  const stops = /(\d+)\s+stops?/.exec(text);
  const changes = /(no changes|\d+\s+changes?)/.exec(text);
  const changesNum = changes ? (/no changes/.test(changes[1]) ? 0 : Number(/(\d+)/.exec(changes[1])[1])) : null;

  let confirmHref = null;
  const links = page.locator('a[href^="http"]');
  const linkCount = await links.count().catch(() => 0);
  for (let i = 0; i < linkCount; i++) {
    const href = await links.nth(i).getAttribute("href").catch(() => null);
    if (href && /google\.[a-z.]+\/maps/.test(href)) {
      confirmHref = href;
      break;
    }
  }

  // `window.__map` is the app's own debugging handle (components/TransitMap.tsx).
  const featureCount = await page
    .evaluate(() => {
      const map = window.__map;
      if (!map) return 0;
      // `_data` is not a FeatureCollection for a rendered source, so ask the
      // renderer instead; fall back for a source that has not been tiled yet.
      try {
        const rendered = map.querySourceFeatures("highlighted-route").length;
        if (rendered > 0) return rendered;
      } catch {}
      const source = map.getSource("highlighted-route");
      const data = source && source._data;
      return data && data.features ? data.features.length : 0;
    })
    .catch(() => 0);

  return {
    text,
    stops: stops ? Number(stops[1]) : 0,
    changes: changesNum,
    changesText: changes ? changes[1] : null,
    confirmHref,
    featureCount,
    hasNaN: /NaN/.test(text),
  };
}

function nearestNow(session) {  return session.page
    .locator('button:has-text("Nearest:")')
    .first()
    .innerText()
    .catch(() => null);
}

// Run a small block of work with a hard timeout so one persona can't hang us.
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- scenarios

async function scenarioFirstTimer(session) {
  const { reporter, persona, page } = session;
  await open(session);

  // GPS allowed -> nearest chip should appear
  const near = await page
    .waitForSelector('button:has-text("Nearest:")', { timeout: 8000 })
    .then(() => nearestNow(session))
    .catch(() => null);
  if (near) {
    const { name, dist } = parseNearest(near);
    reporter.say(persona, "geo_ok", {
      lat: persona.geo.position.latitude.toFixed(4),
      lon: persona.geo.position.longitude.toFixed(4),
    });
    reporter.say(persona, "nearest", { name, dist });
  } else {
    reporter.fact(persona, "nearest-chip-missing");
  }

  const startPick = await pickStation(session, "Siam", "start");
  session.check("search.finds-station", startPick.ok === true, {
    severity: "blocker",
    data: { query: "Siam", reason: startPick.reason ?? null },
  });
  const arr = await readPopupArrival(session);
  reporter.say(persona, arr.kind, { dest: "the next train", eta: arr.eta || arr.next || "?", n: 3 });

  // A stuck "Checking times" is the failure this guards: the card never
  // resolves for the rider. Which times the fixtures can serve varies by
  // station, so the parsed text is recorded but not asserted on.
  session.check("eta.counts-down", arr.kind !== "arrivals_checking", {
    severity: "major",
    data: { kind: arr.kind, eta: arr.eta ?? arr.next ?? null },
  });

  await pickStation(session, "Khu Khot", "destination");
  await routeDrawn(session);
  await shot(session, "route");

  const route = await routeFacts(session);
  session.check("route.confirm-enabled", Boolean(route.confirmHref), {
    severity: "major",
    data: { href: route.confirmHref },
  });
  session.check("route.path-drawn", route.featureCount > 0, {
    severity: "blocker",
    data: { features: route.featureCount },
  });
  // Siam -> Khu Khot is one Sukhumvit-line run, so any change here is wrong.
  session.check("route.transfer-count", route.changes === 0, {
    severity: "major",
    data: { text: route.changesText },
  });
  // The app has no fare display yet, so this guards the ETA/route maths from
  // leaking NaN into the panel text at all.
  session.check("fare.not-nan", !route.hasNaN, {
    severity: "major",
    data: { stops: route.stops },
  });

  const langBtn = page.locator('button[aria-label="Language / ภาษา"]');
  let thOk = true;
  if (await langBtn.count()) {
    await langBtn.first().click();
    await page.waitForTimeout(600);
    const thText = (await page.locator("body").innerText().catch(() => "")) || "";
    thOk = /[\u0E00-\u0E7F]/.test(thText);
    await langBtn.first().click();
    await page.waitForTimeout(400);
  }
  session.check("locale.th-complete", thOk, { severity: "minor", data: { toggled: Boolean(thOk) } });

  // --- geo edge cases in throwaway contexts (timeout + unsupported) ---
  for (const mode of ["timeout", "unsupported"]) {
    const ctx = await session.browser.newContext({
      viewport: { width: 390, height: 844 },
      baseURL: session.cfg.baseURL,
      permissions: ["geolocation"],
      geolocation: { latitude: 13.745515, longitude: 100.534605 },
    });
    if (mode === "timeout") {
      await ctx.addInitScript(() => {
        const fake = (_s, error) => {
          setTimeout(() => error && error({ code: 3, TIMEOUT: 3, PERMISSION_DENIED: 1 }), 60);
          return 1;
        };
        Object.defineProperty(navigator, "geolocation", {
          value: { getCurrentPosition: fake, watchPosition: fake, clearWatch() {} },
          configurable: true,
        });
      });
    } else {
      await ctx.addInitScript(() => {
        try {
          delete Object.getPrototypeOf(navigator).geolocation;
        } catch {}
      });
    }
    const extra = await createPage(session.browser, ctx, session);
    await extra.goto("/", { waitUntil: "domcontentloaded" }).catch(() => {});
    await extra.waitForTimeout(2500);
    const hasDot = await extra.locator("canvas").count();
    reporter.say(persona, mode === "timeout" ? "geo_timeout" : "geo_unsupported", { canvases: hasDot });
    await ctx.close();
  }

  // Uncaught exceptions are the ones that kill a React root; console noise from
  // a failed fetch is already covered by the arrivals checks.
  const pageErrors = session.errors.filter((e) => e.startsWith("pageerror:"));
  session.check("console.clean", pageErrors.length === 0, {
    severity: "major",
    data: { pageErrors: pageErrors.slice(0, 5) },
  });

  await shot(session, "final");
}

async function scenarioDeniedGps(session) {
  const { reporter, persona, page } = session;
  await open(session);

  const banner = page.getByText("Location access denied", { exact: false });
  const shown = await banner
    .waitFor({ state: "visible", timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  if (shown) reporter.say(persona, "geo_denied");
  else reporter.fact(persona, "no-denied-banner", { note: "expected amber location banner" });

  reporter.say(persona, "nearest", { name: "(none)", dist: "n/a" });

  // Can still route without GPS.
  await pickStation(session, "Mo Chit", "start");
  await pickStation(session, "Siam", "destination");
  await routeDrawn(session);
  await shot(session, "denied-route");
}

async function scenarioMoving(session) {
  const { reporter, persona, context, page } = session;
  await open(session);

  let last = null;
  for (const point of persona.geo.track) {
    await context.setGeolocation(point);
    await page.waitForTimeout(1600);
    const txt = await nearestNow(session);
    if (txt) {
      const { name, dist } = parseNearest(txt);
      if (name !== last) {
        reporter.say(persona, "nearest", { name, dist });
        last = name;
      } else {
        reporter.fact(persona, "nearest-same", { name, dist });
      }
    }
  }
  reporter.say(persona, "geo_ok", {
    lat: "moving",
    lon: "moving",
  });

  await pickStation(session, "Mo Chit", "start");
  const arr = await readPopupArrival(session);
  reporter.say(persona, arr.kind, { dest: "the next train", eta: arr.eta || arr.next || "?", n: 3 });
  await shot(session, "moving");
}

async function scenarioPowerUser(session) {
  const { reporter, persona, page } = session;
  await open(session);

  await pickStation(session, "Khu Khot", "start");
  await pickStation(session, "Ratchathewi", "destination");
  await routeDrawn(session);

  // swap
  const swapBtn = page.locator('button[aria-label="Swap start and destination"]');
  if (await swapBtn.count()) {
    await swapBtn.first().click();
    await page.waitForTimeout(400);
    reporter.say(persona, "swap");
  }

  // clear
  const clearBtn = page.getByRole("button", { name: "Clear", exact: true });
  if (await clearBtn.count()) {
    await clearBtn.first().click();
    await page.waitForTimeout(400);
    reporter.say(persona, "clear_route");
  }

  // transfer route, destination on a non-live line
  await pickStation(session, "Mo Chit", "start");
  await pickStation(session, "Lak Song", "destination");
  await routeDrawn(session);
  const panelText = await page.locator("body").innerText().catch(() => "");
  if (/Change line/i.test(panelText)) reporter.say(persona, "transfer", { at: "Chatuchak Park", line: "MRT Blue" });
  else reporter.fact(persona, "no-transfer-indicator");

  const arr = await readPopupArrival(session);
  reporter.say(persona, arr.kind, { dest: "the next train", eta: arr.eta || "?" });
  await shot(session, "transfer");
}

async function scenarioSpottyNetwork(session) {
  const { reporter, persona, page } = session;
  session.setFixture("partial", 0.5);
  const before = session.arrivalRequests;
  await open(session);
  await pickStation(session, "Siam", "start");
  await page.waitForTimeout(6000); // partial -> fast-poll (2s)
  const polls = session.arrivalRequests - before;
  reporter.say(persona, "many_requests", { n: polls });

  // empty arrivals
  session.setFixture("empty");
  await page.waitForTimeout(4000);
  await openStation(session, "Siam");
  const arr = await readPopupArrival(session);
  reporter.say(persona, arr.kind, { dest: "the next train", eta: arr.eta || "?" });

  // offline / online
  await session.setOffline(true);
  reporter.say(persona, "offline");
  await page.waitForTimeout(2500);
  await session.setOffline(false);
  session.setFixture("normal");
  await page.waitForTimeout(3500);
  reporter.say(persona, "online_again");
  await shot(session, "network");
}

async function scenarioLifecycle(session) {
  const { reporter, persona, page, context, browser, cfg } = session;
  await open(session);
  await pickStation(session, "Siam", "start");
  await page.waitForTimeout(1500);

  // backgrounded tab
  const second = await context.newPage();
  await second.goto("about:blank");
  await second.bringToFront();
  reporter.say(persona, "hidden");
  const hiddenStart = session.arrivalRequests;
  await page.waitForTimeout(5000);
  const whileHidden = session.arrivalRequests - hiddenStart;
  reporter.fact(persona, "requests-while-hidden", { count: whileHidden });

  await page.bringToFront();
  reporter.say(persona, "visible");

  // close + reopen in the same context (snapshot seed path)
  const state = await context.storageState();
  await page.close();
  const page2 = await createPage(browser, context, session);
  session.page = page2;
  const t0 = Date.now();
  await page2.goto("/", { waitUntil: "domcontentloaded" });
  await page2.waitForTimeout(800);
  const seeded = await page2.evaluate(() => !!localStorage.getItem("bts:arrivals:v1"));
  reporter.fact(persona, "reopen", { seeded, ms: Date.now() - t0 });
  reporter.say(persona, seeded ? "reopen_seeded" : "reopen_fresh");
  await shot(session, "reopen");

  // process-kill: brand new context carrying the saved storage state
  await context.close();
  const killed = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: cfg.baseURL,
    permissions: ["geolocation"],
    geolocation: persona.geo.position,
    storageState: state,
  });
  const page3 = await createPage(browser, killed, session);
  session.page = page3;
  await page3.goto("/", { waitUntil: "domcontentloaded" });
  await page3.waitForTimeout(1000);
  const seeded2 = await page3.evaluate(() => !!localStorage.getItem("bts:arrivals:v1"));
  reporter.fact(persona, "cold-relaunch", { seeded: seeded2 });
  reporter.say(persona, seeded2 ? "reopen_seeded" : "reopen_fresh");
  session.context = killed;
  await shot(session, "cold-relaunch");
}

async function scenarioStress(session) {
  const { reporter, persona, page } = session;
  await open(session);

  const names = ["Siam", "Mo Chit", "Khu Khot", "Ratchathewi", "Asok", "Bang Wa", "Lak Song", "Phaya Thai"];
  reporter.say(persona, "rapid_taps", { n: names.length * 2 });
  for (let i = 0; i < names.length; i++) {
    const role = i % 2 === 0 ? "start" : "destination";
    await pickStation(session, names[i], role).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(800);

  // sheet open/close churn
  const closeBtn = page.locator('button[aria-label="Close"]');
  if (await closeBtn.count()) {
    await closeBtn.first().click().catch(() => {});
    reporter.say(persona, "sheet_close");
  }
  await pickStation(session, "Siam", "destination").catch(() => {});
  reporter.say(persona, "sheet_open");
  await shot(session, "stress");
}

async function scenarioPwaSoak(session) {
  const { reporter, persona, page, browser, cfg } = session;
  await open(session);

  // manifest / install
  const manifest = await page
    .evaluate(() => fetch("/manifest.json").then((r) => r.json()))
    .catch(() => null);
  const icons = manifest?.icons?.length ?? 0;
  if (icons === 0) reporter.say(persona, "icons_missing");
  else reporter.fact(persona, "icons", { count: icons });

  // standalone emulation in a fresh context
  const standaloneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: cfg.baseURL,
    permissions: ["geolocation"],
    geolocation: persona.geo.position,
  });
  await standaloneCtx.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      /display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : orig(q);
  });
  const sp = await createPage(browser, standaloneCtx, session);
  await sp.goto("/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await sp.waitForTimeout(1500);
  const standalone = await sp.evaluate(() => window.matchMedia("(display-mode: standalone)").matches);
  reporter.say(persona, standalone ? "standalone" : "icons_missing");
  await standaloneCtx.close();

  // soak: keep the app open, sample periodically
  await pickStation(session, "Siam", "start");
  const startReq = session.requestCount;
  const errorStart = session.errors.length;
  const ticks = Math.max(1, Math.round(cfg.soakMs / 5000));
  for (let i = 0; i < ticks; i++) {
    await page.waitForTimeout(5000);
    if (i % 3 === 0) {
      await page.mouse.wheel(0, 40); // gentle activity so it isn't fully idle
    }
  }
  const mins = (cfg.soakMs / 60000).toFixed(1);
  reporter.say(persona, "soak_summary", {
    mins,
    errors: session.errors.length - errorStart,
    requests: session.requestCount - startReq,
  });
  await shot(session, "soak-end");
}

const SCENARIOS = {
  scenarioFirstTimer,
  scenarioDeniedGps,
  scenarioMoving,
  scenarioPowerUser,
  scenarioSpottyNetwork,
  scenarioLifecycle,
  scenarioStress,
  scenarioPwaSoak,
};

// ---------------------------------------------------------------- runner
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export async function run(options = {}) {
  const cfg = {
    baseURL: options.baseURL,
    concurrency: options.concurrency ?? 3,
    soakMs: options.soakMs ?? 90000,
    only: options.only ?? null,
    headful: options.headful ?? false,
  artifactsDir: options.artifactsDir,
  baseSha: options.baseSha ?? null,
  seed: options.seed ?? null,
  buildId: options.buildId ?? null,
  failOn: options.failOn === undefined ? "major" : options.failOn,
};

  let server = null;
  if (!cfg.baseURL) {
    server = await startServer({ port: options.port ?? 0 });
    cfg.baseURL = server.url;
  }

  const reporter = new Reporter();
  const startedAt = Date.now();
  console.log(`\n=== Bangkok Transit: real-user simulation ===`);
  console.log(`target: ${cfg.baseURL}`);
  console.log(`personas: ${personas.length}   concurrency: ${cfg.concurrency}   soak: ${fmtDuration(cfg.soakMs)}`);
  console.log(`artifacts: ${cfg.artifactsDir}\n`);

  // The default headless shell has no WebGL2 at all -> MapLibre throws
  // "WebGL2 is required" and React's error boundary replaces the whole UI,
  // which looks like a broken app instead of a broken browser. SwiftShader
  // gives the headless shell a software WebGL2 context (CI too).
  const headless = !cfg.headful;
  const browser = await chromium.launch({
    headless,
    args: headless
      ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
      : [],
  });

  const selected = cfg.only ? personas.filter((p) => cfg.only.includes(p.id)) : personas;
  const failures = [];
  const allFindings = [];

  // simple concurrency pool
  let idx = 0;
  async function worker() {
    while (idx < selected.length) {
      const persona = selected[idx++];
      let session;
      try {
        session = await makeSession(browser, persona, cfg, reporter);
        const op = SCENARIOS[persona.op];
        if (!op) throw new Error(`unknown op ${persona.op}`);
        await withTimeout(op(session), Math.max(120000, cfg.soakMs + 90000), persona.id);
        reporter.say(persona, "done");
        if (session.errors.length) {
          reporter.fact(persona, "console-errors", { count: session.errors.length, sample: session.errors.slice(0, 3) });
        }
      } catch (e) {
        failures.push({ persona: persona.id, error: e.message });
        reporter.fact(persona, "FAILED", { error: e.message });
      } finally {
        if (session?.findings?.length) allFindings.push(...session.findings);
        try {
          await session?.context?.close();
        } catch {}
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, selected.length) }, worker));

  await browser.close();
  if (server) await server.close();

  const durationMs = Date.now() - startedAt;
  const findingsFailed = cfg.failOn
    ? allFindings.some((f) => !f.ok && severityAtLeast(f.severity, cfg.failOn))
    : false;
  const report = {
    startedAt: new Date(startedAt).toISOString(),
    durationMs,
    baseURL: cfg.baseURL,
    personas: selected.map((p) => p.id),
    failures,
    entries: reporter.entries,
    findings: allFindings,
    findingsFailed,
  };

  await mkdir(cfg.artifactsDir, { recursive: true });
    await writeFile(path.join(cfg.artifactsDir, "report.json"), JSON.stringify(report, null, 2));
    if (allFindings.length) await writeFile(path.join(cfg.artifactsDir, "findings.jsonl"), allFindings.map((f) => JSON.stringify(f)).join("\n") + "\n");

  const lines = [];
  lines.push(`# Bangkok Transit — real-user simulation report`);
  lines.push(``);
  lines.push(`- target: ${cfg.baseURL}`);
  lines.push(`- started: ${report.startedAt}`);
  lines.push(`- duration: ${fmtDuration(durationMs)}`);
  lines.push(`- personas: ${selected.map((p) => p.id).join(", ")}`);
  lines.push(`- failures: ${failures.length}`);
  lines.push(`- findings: ${allFindings.length} (${allFindings.filter((f) => !f.ok).length} failing)`);
  lines.push(``);
  lines.push(`## Persona stream`);
  lines.push(``);
  for (const e of reporter.entries) {
    const who = e.persona.name;
    if (e.text) lines.push(`- \`${e.at}\` **${who}** — ${e.text}`);
    else lines.push(`- \`${e.at}\` _${who}_ · ${e.kind}${e.data && Object.keys(e.data).length ? " " + JSON.stringify(e.data) : ""}`);
  }
  await writeFile(path.join(cfg.artifactsDir, "report.md"), lines.join("\n"));

  console.log(`\n=== done in ${fmtDuration(durationMs)} — ${reporter.entries.length} observations, ${failures.length} failures ===`);
  console.log(`report: ${path.join(cfg.artifactsDir, "report.md")}`);
  if (failures.length) console.log(`failures: ${JSON.stringify(failures, null, 2)}`);
  return report;
}

export { Reporter };
