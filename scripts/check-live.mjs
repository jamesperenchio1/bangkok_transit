#!/usr/bin/env node
/**
 * Checks production end to end: the site, its headers, and the live
 * arrivals document as a browser on the site would see it. Run by the
 * scheduled GitHub workflow (.github/workflows/live-check.yml), which emails
 * the repo owner when it fails; also handy by hand:
 *
 *   npm run check:live
 *   SITE_URL=http://localhost:8787 ARRIVALS_URL=... npm run check:live
 *
 * Exit code 0 = healthy, 1 = something is wrong (each problem is printed).
 * Dashboard-only configuration (the CORS Transform Rule, edge caching on
 * live.) has no code in the repo, so this is what guards it.
 */

const SITE_URL = process.env.SITE_URL ?? "https://bangkok-transit.com";
const ARRIVALS_URL = process.env.ARRIVALS_URL ?? "https://live.bangkok-transit.com/arrivals.json";
/** The newest reading may be this old during service hours before it counts as stale. */
const MAX_STALE_MS = 5 * 60_000;

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

function bangkokMinutes(now) {
  const d = new Date(now);
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 7 * 60) % (24 * 60);
}
/** BTS runs ~05:15-00:30 Bangkok time; allow margin at both ends. */
function inServiceHours(now) {
  const m = bangkokMinutes(now);
  return m >= 5 * 60 + 45 && m < 23 * 60 + 45;
}

async function get(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    fail(`${url}: request failed (${err.message})`);
    return null;
  }
}

// The site.
const site = await get(SITE_URL, { redirect: "follow" });
if (site) {
  if (!site.ok) fail(`${SITE_URL}: HTTP ${site.status}`);
  const html = await site.text();
  if (!html.includes("Bangkok Transit")) fail(`${SITE_URL}: page doesn't look like the app`);
  for (const header of ["content-security-policy", "x-content-type-options", "permissions-policy"]) {
    if (!site.headers.get(header)) fail(`${SITE_URL}: missing ${header} header`);
  }
}

// The live document, requested the way the page does (cross-origin).
const live = await get(ARRIVALS_URL, { headers: { origin: SITE_URL }, cache: "no-store" });
if (live) {
  if (!live.ok) fail(`${ARRIVALS_URL}: HTTP ${live.status}`);
  // Duplicate Access-Control-Allow-Origin headers arrive joined ("*, *") -
  // browsers reject that outright. It happens if the R2 bucket gets a CORS
  // policy on top of the zone Transform Rule.
  const allowOrigin = live.headers.get("access-control-allow-origin");
  if (allowOrigin !== "*") fail(`arrivals: Access-Control-Allow-Origin is ${JSON.stringify(allowOrigin)}, want exactly "*"`);
  const exposed = (live.headers.get("access-control-expose-headers") ?? "").toLowerCase();
  for (const h of ["date", "age"]) {
    if (!exposed.includes(h)) fail(`arrivals: ${h} isn't in Access-Control-Expose-Headers (the client needs it for its clock)`);
  }
  if (!/s-maxage=\d+/.test(live.headers.get("cache-control") ?? "")) fail("arrivals: no s-maxage in Cache-Control");
  const cacheStatus = live.headers.get("cf-cache-status");
  if (!cacheStatus || cacheStatus === "DYNAMIC" || cacheStatus === "BYPASS") {
    fail(`arrivals: not edge-cached (cf-cache-status: ${cacheStatus}) - every visitor would hit R2`);
  }

  let doc = null;
  try {
    doc = await live.json();
  } catch {
    fail("arrivals: body isn't JSON");
  }
  if (doc) {
    const now = Date.now();
    const timestamps = Object.values(doc.arrivals ?? {})
      .map((a) => Date.parse(a.timestamp.endsWith("Z") ? a.timestamp : `${a.timestamp}Z`))
      .filter(Number.isFinite);
    const newestAge = timestamps.length ? now - Math.max(...timestamps) : Infinity;
    const count = timestamps.length;
    note(`arrivals: ${count}/${doc.total} stations, newest ${Number.isFinite(newestAge) ? `${Math.round(newestAge / 1000)}s` : "n/a"} old`);

    const status = doc.status;
    if (status) {
      note(`upstream: ${status.state} since ${status.since}${status.lastSuccessAt ? `, last success ${status.lastSuccessAt}` : ""}`);
      const open = status.incidents?.find((i) => i.end === null);
      if (status.state === "down") fail(`upstream API is down (since ${open?.start ?? status.since}) - the site shows "down at the source"`);
    }
    if (doc.poll) note(`last poll: ${doc.poll.ok}/${doc.poll.polled} ok at ${doc.poll.at}`);
    if (inServiceHours(now) && newestAge > MAX_STALE_MS && status?.state !== "down") {
      const age = Number.isFinite(newestAge) ? `the newest reading is ${Math.round(newestAge / 60_000)} min old` : "no readings at all";
      fail(`arrivals: ${age} during service hours - is the poller running, or the upstream failing? (see "last poll")`);
    }
  }
}

for (const n of notes) console.log(`  ${n}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\n✓ production looks healthy");
