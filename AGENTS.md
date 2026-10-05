<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Bangkok Transit — Agent Guide

## What this app is

Tap a station on a real interactive map (BTS, MRT, Gold, Yellow, Pink, Airport
Rail Link, SRT Red — every currently-operating line), see it marked as your
route start; tap a second station to pick a destination; confirm to see the
actual multi-line path highlighted (with line-change transfers) and
everything else grayed out. Your live GPS position is always shown on the
map. This supersedes an earlier, deliberately much smaller version of this
app (tap-a-BTS-station-for-arrivals only, no interactive map, no routing) —
see git history around the "new-app-idea" branch for why that scope was
expanded. See `docs/` or ask the user for further design history if needed.

## Project Conventions

- **Framework**: Next.js 16 App Router, React 19, TypeScript.
- **Styling**: Tailwind CSS v4. Minimal hand-rolled components (no shadcn CLI
  dependency) styled with `clsx`/`tailwind-merge` via `lib/utils.ts`'s `cn()`.
- **Map**: `components/TransitMap.tsx`, built on `react-leaflet` + Leaflet
  with free OpenStreetMap raster tiles (no API key). Every station has real
  `lat`/`lon` (no more pixel coordinates on a map image) so markers, line
  polylines, and the user's own GPS dot all place directly via projection —
  no manual calibration needed. `FitStationBounds` inside that file works
  around a real Leaflet gotcha: `fitBounds()` computed at mount can see a
  zero-size container (flex-layout race, or a backgrounded tab) and lock
  onto a wildly wrong zoom with no way to recover on its own; it retries via
  a `ResizeObserver` until the container actually has room. The wrapping
  `<div>` around `<TransitMap />` in `app/page.tsx` has Tailwind's `isolate`
  class for a real reason, not decoration: Leaflet's internal panes use
  z-index up to ~700, and without a stacking context to contain them they
  render above anything else on the page (confirm bar, route sheet) that
  isn't *also* pinned to a very high z-index. Line paths are NOT drawn as
  straight segments between consecutive stations - that looks nothing like
  the real track, which curves along roads and rivers. `data/line-geometry.json`
  (built by `scripts/build-line-geometry.ts` from the same BMA GIS source as
  the station data) holds each line's real curved geometry as one or more
  independent coordinate segments; `lib/line-geometry.ts`'s `fullLineSegments()`
  feeds the full-network view, and `trackBetween()` finds the real sub-curve
  between two adjacent stations (by nearest-vertex snapping onto whichever
  source segment contains both) for the highlighted-route overlay - falling
  back to a straight line only if no segment is close enough to both stations.
- **Data**: `data/stations.ts` (+ `data/stations.json`) is the full station
  list — 193 stations across every currently-operating line. BTS
  Sukhumvit/Silom (61 codes, including N6 Sena Ruam, absent from the live
  API's own `/stations` listing) and Gold/Yellow/Pink keep their original
  hand-curated codes; MRT Blue/Purple, Airport Rail Link, and SRT Red were
  added from BMA's public ArcGIS REST API (see "External station/line data"
  below) with locally-assigned codes (`BL01`, `PP01`, `A01`, `RD01`, ...)
  since none of those systems have a live arrivals API. Every station has
  real `lat`/`lon` now (backfilled for Gold/Yellow/Pink, which previously had
  none at all). `data/line-sequences.json` is the ordered per-line stop list
  the routing graph needs — nothing in any source data provides stop order,
  so this is hand-verified (see `scripts/build-line-sequences.ts`'s comments
  for the one-off quirks: N6 inserted mid-sequence, Silom's mixed W/CEN/S
  prefixes, the Pink Line's unopened Muang Thong Thani branch, Tao Poon
  getting merged into the Blue Line's `BL31` code since it's the same
  physical Blue/Purple interchange station).
- **Routing**: `lib/transit-graph.ts` builds a graph from `data/stations.ts` +
  `data/line-sequences.json` (adjacent-stop edges per line, plus MRT Blue's
  loop-closure edge since it's a closed loop, not a line with two ends) and
  runs a Dijkstra-ish shortest-hop search (`findPath`). Walking transfers
  between *distinct* nearby stations on different lines (e.g. Mo Chit BTS
  <-> Chatuchak Park MRT) are generated automatically for any two stations
  within ~400m — no hand-curated list of interchange names to maintain.
  Same-complex interchanges (Siam, Tao Poon, ...) need no special edge at
  all: they're modeled as one station node carrying multiple lines, so ride
  edges on each of its lines are already present.
- **External station/line data**: BMA's public, unauthenticated ArcGIS REST
  API at `cityplangis.bangkok.go.th/arcgis/rest/services/bma/Basemap/MapServer`
  (layer 1 = station points, layer 3 = line geometry) was the one-time source
  for every non-BTS/Gold/Yellow/Pink station — fetched via
  `scripts/fetch-transit-network.ts` into `data/raw/*.geojson` and turned into
  station records via `scripts/build-stations.ts` (see that file's comments
  for real data-quality issues found along the way: Siam is only tagged with
  one of its two actual lines in that dataset, Orange Line entries are all
  marked under-construction and excluded, and English station names had to be
  filled in by hand in `scripts/fill-english-names.ts` since the source has
  Thai names only). This is a one-time/rarely-rerun pipeline, not a runtime
  dependency — the network doesn't change often enough to justify hitting a
  third-party government server on every build or request.
- **PWA**: Serwist service worker in `app/sw.ts`. Only wired in for the
  **production** build — `next.config.ts` skips the Serwist wrapper during
  `next dev` because it injects a `webpack` config key that conflicts with
  Turbopack (the Next 16 dev default) even when `disable: true` is set.
  Production build therefore uses webpack: `npm run build` runs
  `next build --webpack`.
- **Hosting (Cloudflare, free plan)**: the site is a fully static export
  (`output: "export"` -> `out/`) served as Workers static assets on
  `bangkok-transit.com` (root `wrangler.jsonc`, assets-only - no script runs,
  so requests are free and unlimited). There is no server code and no API
  route. Response headers live in `public/_headers` (`headers()` doesn't work
  for a static export).
- **Icons**: Use `lucide-react`.
- **Live arrivals API**: `https://bts-api.topmile.com` — undocumented,
  BTS Sukhumvit + Silom only (~61 codes), no batch endpoint, no CORS, and
  `timestamp` in responses is UTC despite looking naive (see `lib/bts.ts`).
  It is polled **once, centrally, for everybody** — never per user — by
  `cloudflare/poller`: a single Durable Object (`ArrivalsPoller`, one
  instance worldwide, so no lock is needed) whose own alarm fires every 10s
  during service hours (every 5 min overnight). The free plan allows 50
  outside fetches per invocation, so each alarm polls the ~half of the 61
  stations whose readings are oldest (6 at a time, within a ~9s budget), so
  every station refreshes about every 20s and one whose call failed is
  retried first. The document's `poll` field reports the latest poll's
  failures (status/"timeout"/"skipped") - read it with curl to diagnose.
  Each alarm merges into the previous readings and writes one document,
  `arrivals.json` (`lib/arrivals-document.ts`: `{ arrivals, total, complete }`),
  to the R2 bucket `bts-live`, served at `live.bangkok-transit.com` through
  Cloudflare's CDN cache (`s-maxage=10`, or 2 while still filling). Clients
  fetch `ARRIVALS_URL` (`lib/arrivals-url.ts`) - users only ever hit the CDN,
  so nothing grows with traffic. A cron (`* * * * *`) on the same Worker is a
  watchdog that re-arms the alarm chain if it ever stops. CORS on
  `live.` comes from a zone Transform Rule (response headers
  `Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers: Date, Age`),
  and the bucket must have **no** CORS policy of its own. The edge caches
  one copy for every visitor and R2 adds CORS headers only when a request
  carries an `Origin`, so the rule is the reliable source - and with both,
  responses carry two `Access-Control-Allow-Origin` headers, which browsers
  reject outright. The client learns server time from `Date`/`Age`, so they
  must stay exposed.
  **Last-known times beat an empty card**: if updates stall, each station's
  latest reading keeps showing (counted down against the clock, departed
  trains dropped) with its age flagged in amber once it's older than
  `FRESH_FOR_MS` (90s). Only entries past `MAX_SHOW_AGE_MS` (30 min,
  `lib/bts.ts`) are dropped - on the server, in the client store, and on
  render (`lib/use-arrivals.ts`). Ages are measured on the server's clock
  (offset learned from each response's `Date`/`Age` headers), so a phone
  with a wrong clock still counts down correctly. The client polls every
  15s for as long as the page is open (paused in hidden tabs; immediate
  re-poll on return, `online`, and bfcache restore; plus a watchdog that
  restarts a dead poll chain).

## Build & Test

```bash
npm install
npm run dev       # dev server (Turbopack, Serwist disabled)
npm run build     # production build with webpack + Serwist
npx wrangler dev  # build, then serve out/ the way production does
cd cloudflare/poller && npm run dev   # poller locally; trigger with /__scheduled
```

Deploys: Cloudflare Workers Builds, one build per Worker (repo root for the
site, `cloudflare/poller` for the poller), on every push to `main`.

## Adding Data

1. Update `data/stations.json` directly (flat array, see `data/stations.ts`
   for the `Station` type) — every station needs real `lat`/`lon`, there are
   no pixel coordinates to measure anymore.
2. If you add or reorder stations on an existing line, update that line's
   entry in `data/line-sequences.json` to match the real physical stop
   order — the routing graph in `lib/transit-graph.ts` trusts this file
   completely and has no way to detect a wrong order on its own.
3. To pull in a newly-opened line or station from BMA's GIS data, re-run
   `scripts/fetch-transit-network.ts` then `scripts/build-stations.ts` (or
   fold the new data in by hand if the scripts' line-specific logic doesn't
   cover it) - review the diff carefully given the known data-quality issues
   noted above, this is not a script to run and blindly trust.
4. Run `npm run build` to validate TypeScript.

## Notes

- Keep everything free-tier friendly (Cloudflare Workers/Durable Objects/R2
  free plan; OpenFreeMap's free tiles; BMA's free GIS API hit only rarely via
  the one-time fetch script above).
- Avoid AI assistant features.
