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
- **Icons**: Use `lucide-react`.
- **Live arrivals API**: `https://bts-api.topmile.com` — undocumented,
  BTS Sukhumvit + Silom only (~61 codes), no CORS (must be proxied
  server-side via `app/api/arrivals/[code]/route.ts`), `timestamp` in
  responses is UTC despite looking naive. See `lib/bts.ts` for the response
  shape and `lib/arrivals-cache.ts` for the Upstash Redis caching layer
  (24h TTL, freshness judged from the payload's own timestamp — module
  memory -> Redis -> upstream, single-flight de-dupe).
- **Keep-warm job**: `.github/workflows/keep-arrivals-warm.yml` pings every
  station's `/api/arrivals/[code]` every ~12 min (GitHub Actions free
  minutes, unmetered on a public repo). This does NOT make data "always
  fresh" - arrivals are only fresh for ~90s after fetch, so it just avoids
  the worst-case cold start after long idle periods. A tighter interval
  isn't affordable on Upstash's free tier (500K commands/month) and isn't
  possible on Vercel Hobby's cron (once-per-day only, Pro-only for
  anything more frequent) - see project memory / commit history for the
  math if this ever needs revisiting.

## Build & Test

```bash
npm install
npm run dev       # dev server (Turbopack, Serwist disabled)
npm run build     # production build with webpack + Serwist
npm start         # serve production build
```

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

- Keep everything free-tier friendly (Vercel hobby, Upstash free tier,
  GitHub Actions free minutes, OpenStreetMap's free tile server, BMA's free
  GIS API hit only rarely via the one-time fetch script above).
- Avoid AI assistant features.
