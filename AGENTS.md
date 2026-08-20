<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Bangkok Transit — Agent Guide

## What this app is

Tap a BTS station on the network map image, see its live arrival times. That's
the whole app — no interactive Leaflet map, no route planner, no multi-modal
data. See `docs/` or ask the user for the design history if more context is
needed.

## Project Conventions

- **Framework**: Next.js 16 App Router, React 19, TypeScript.
- **Styling**: Tailwind CSS v4. Minimal hand-rolled components (no shadcn CLI
  dependency) styled with `clsx`/`tailwind-merge` via `lib/utils.ts`'s `cn()`.
- **Data**: `data/stations.ts` (+ `data/stations.json`) is the full station
  list — BTS Sukhumvit/Silom (with live arrival codes, carried forward from
  the previous app's validated dataset) plus Gold/Yellow/Pink names. `x`/`y`
  are pixel coordinates on `public/bts-map.jpg` (measured via automated
  circle detection - see git history - not hand-placed).
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

## Build & Test

```bash
npm install
npm run dev       # dev server (Turbopack, Serwist disabled)
npm run build     # production build with webpack + Serwist
npm start         # serve production build
```

## Adding Data

1. Update `data/stations.json` directly (flat array, see `data/stations.ts`
   for the `Station` type).
2. Station `x`/`y` coordinates must be measured against the actual pixel
   dimensions of `public/bts-map.jpg` — if that file changes, coordinates
   need remeasuring.
3. Run `npm run build` to validate TypeScript.

## Notes

- Keep everything free-tier friendly (Vercel hobby, Upstash free tier,
  GitHub Actions free minutes).
- No route planner / travel-time calculator in this app (explicitly out of
  scope) — don't add one without checking with the user first.
- Avoid AI assistant features.
