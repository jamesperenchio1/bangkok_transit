<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Bangkok Transit — Agent Guide

A static, installable map of every operating Bangkok rail line with routing and
live BTS arrivals, live at bangkok-transit.com. Read `README.md` first, then
`docs/architecture.md` (data flow, cost model, failure modes) and
`docs/operations.md` (deployment, dashboard-only config, runbook).

## Non-negotiables

- **Costs must not scale with users.** Nothing per-user may reach a server
  that does work: page views are static assets, live data is one CDN-cached
  file written by one Durable Object. Don't add API routes, per-user fetches
  to the upstream, or anything that needs a paid plan. Keep the Cloudflare
  free-tier numbers in `docs/architecture.md#cost-model` true.
- **Never per-user calls to `bts-api.topmile.com`.** It has no CORS, no batch
  endpoint and a ~180/min rate limit; only `cloudflare/poller` talks to it.
- **Honest live data.** Old readings are shown as last-known with their age
  (amber), dropped after 30 min, and an upstream outage is named as such.
- **The UI is considered done** — change it only to fix bugs or when asked.
- No AI features in the app.

## Layout

- `app/` — the single page (`page.tsx`: route state, URL sync), layout
  (metadata, preloads), service worker (`sw.ts`, Serwist), error boundary.
- `components/TransitMap.tsx` — MapLibre GL map (OpenFreeMap vector tiles):
  GeoJSON sources/layers for lines, route, stations, labels, GPS. Station
  cards are MapLibre popups rendered as separate React roots, which is why
  language lives in a Zustand store (`lib/i18n.ts`), not context.
  `window.__map` exposes the map for debugging and e2e.
- `components/RoutePanel.tsx` — the route sheet (legs, walks, boarding
  direction, live times at each boarding point).
- `lib/transit-graph.ts` — routing (see below). `lib/line-geometry.ts` —
  curved track between stations from `public/line-geometry.json`.
- `lib/arrivals-store.ts` / `lib/use-arrivals.ts` — the one client polling
  loop, server-clock correction, last-known handling.
- `lib/bts.ts` (upstream client + validation), `lib/arrivals-document.ts`
  (the published document, shared by the poller and the browser — keep it
  free of runtime-specific imports).
- `cloudflare/poller/` — separate Worker: `src/index.ts` (the
  `ArrivalsPoller` Durable Object + cron watchdog), `src/schedule.ts` (pure
  scheduling/health logic). Own `package.json`, tests in `test/`.
- `data/` — `stations.json`, `line-sequences.json`, `interchanges.json`
  (hand-maintained; see `scripts/README.md` for how to add stations).

## Routing model

`line-sequences.json` maps each line to **segments** (ordered stop lists).
Consecutive codes are adjacent; branches are extra segments sharing a station;
MRT Blue is one segment visiting Tha Phra twice. Termini are segment ends —
used for "board toward X" and to match BTS live platforms (`direction_key`).
`interchanges.json` lists walking transfers between distinct stations;
same-building interchanges are one node with several `lines`. `findPath`
runs Dijkstra over (station, mode, line) states with a minutes cost model and
returns legs with `mode: "start" | "ride" | "walk"`.

Station codes for BTS/Gold/Yellow/Pink are the operators'; MRT Blue/Purple,
ARL and SRT Red use locally assigned codes (`BL01`…, `PP01`…, `A01`…,
`RD01`…) that do **not** match the operators' numbering. Don't renumber them;
fix names/order against an authoritative source and let the tests guard it.

## Conventions

- Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4,
  `lucide-react` icons, no component library. Match the surrounding comment
  style: explain *why*, especially for workarounds.
- Static export (`output: "export"`); response headers (CSP, caching) live in
  `public/_headers` — `headers()` doesn't work for a static export. If the page
  starts talking to a new origin, add it to the CSP; the e2e suite fails on
  CSP violations.
- `npm run build` uses webpack (`--webpack`) because Serwist injects a webpack
  config that conflicts with Turbopack; `next dev` uses Turbopack without the
  service worker.
- MapLibre's worker is served from `public/maplibre/` (copied on install) —
  bundlers can't resolve it from `node_modules`.
- MapLibre coordinates are `[lon, lat]`; the app's geometry helpers use
  `[lat, lon]`. Convert at GeoJSON build time.
- Upstream `timestamp`s are UTC without a `Z`; always parse via `ageMs`/
  `parseUtc`.
- Timers in the poller must be cancellable (`deadlineAfter` in `lib/bts.ts`),
  not `AbortSignal.timeout()` — a pending timer keeps the Durable Object
  busy and billed.

## Build & test

```bash
npm install
npm run dev            # Turbopack dev server, no service worker
npm run lint           # warnings fail
npm run typecheck
npm test               # Vitest unit tests (tests/)
npm run test:e2e       # Playwright against the production build via wrangler dev
npm start              # build + serve out/ the way production does
npm run check:live     # production health check
cd cloudflare/poller && npm install && npm run typecheck && npm test
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push/PR.
Deploys are Cloudflare Workers Builds on push to `main` (site from the repo
root, poller from `cloudflare/poller`). `live-check.yml` checks production
every 30 minutes.
