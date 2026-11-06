# Architecture

## Goals

1. Live BTS arrivals and network-wide routing on a phone, instantly.
2. **Running cost that doesn't grow with users** — and is $0 at any realistic traffic.
3. Degrade honestly: old data is labelled as old, an outage is called an outage.

## The constraint that shapes everything

Live arrivals come from `bts-api.topmile.com`, an undocumented third-party API:

- **No CORS header** — browsers can't call it.
- **No batch endpoint** — one request per station (61 BTS Sukhumvit/Silom codes). Probed: `/arrivals/all`, comma lists, `/arrivals/batch`, multi-segment paths all 400/404.
- **Rate limited** — HTTP 429 at around 180 calls/minute.
- **Quirks** — `timestamp` is UTC with no `Z` (parse it as local time and every countdown is 7 hours off); stations outside its coverage can return `200` with no `platforms`.
- **No SLA** — as of 2026-10-15 every data endpoint returns 500 while `/health` says ok.

So the browser can't talk to it, and nothing per-user may talk to it either: per-user polling would multiply upstream load (and our bill) by the number of riders, and trip the rate limit at a handful of users.

## Data flow

```
cron * * * * *  ──► Worker.scheduled() ──► ArrivalsPoller.ensureRunning()   (watchdog)
                                                │ re-arms the alarm if none is set
                                                ▼
                     ArrivalsPoller.alarm()  ── every 10 s (5 min overnight; backoff when down)
                       1. pick the 31 stalest of 61 stations (3 while the upstream is down)
                       2. fetch them, 6 at a time, within a 9.5 s budget; stop at the first 429
                       3. merge with previous readings (failures keep their last reading)
                       4. update upstream health (ok / degraded / down + outage history)
                       5. write arrivals.json to R2 — unless nothing a client reads changed
                                                │
                                                ▼
                     R2 bucket "bts-live" ── custom domain live.bangkok-transit.com
                                                │  Cache-Control: max-age=0, s-maxage=10
                                                ▼        (2 while filling, 30 while down)
                                     Cloudflare CDN (one cached copy per edge)
                                                │
                                                ▼
                     every browser: fetch every 15 s (paused in hidden tabs)
```

The site (`bangkok-transit.com`) is a static Next.js export served as Workers static assets: no server code runs for page views.

### Why a Durable Object

- **Exactly one poller worldwide, by construction.** `idFromName("bts")` always addresses the same object, so there's no lock or leader election to get wrong.
- **10-second cadence.** Cron triggers bottom out at once a minute; a Durable Object alarm can re-arm itself every 10 seconds. The cron stays only as a watchdog.
- **State without a database.** Readings live in memory and in the published R2 file (reloaded after an eviction); upstream health lives in the object's own storage, so an eviction doesn't reset the backoff or lose the outage history.
- **Free-plan fit.** An invocation may make at most 50 outbound fetches, so each alarm polls the 31 stalest stations — normally the other half from last time, so every station refreshes about every 20 seconds. A station that failed is stalest next time and retried first.

### Why one file on a CDN, not an API

Every user wants the same data. Publishing it once and letting the CDN serve it means the backend does the same work for one visitor or a million. `max-age=0` makes browsers come back to the edge each poll; `s-maxage` lets the edge hold one copy for everyone. `fetch(..., { cache: "no-store" })` only bypasses the browser's own cache — the edge still answers.

Polling a cached file beats WebSockets/SSE here: the data changes every ~20 s, the client counts down between updates anyway, and a cached GET costs nothing while a held connection would.

### CORS and the server clock

`live.` gets `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Date, Age` from a **zone Transform Rule**. The R2 bucket must have **no** CORS policy of its own: R2 adds its header only when a request carries an `Origin`, the edge caches one copy for everyone, and with both sources a response can carry two `Access-Control-Allow-Origin` headers — which browsers reject outright.

`Date` and `Age` are exposed because the client measures the server's clock from them (`Date + Age` for an edge copy) and counts every ETA down on that clock. `serverNow()` takes the later of two estimates — wall clock plus measured offset, and a `performance.now()` anchor from the last response — so a device clock jump or a monotonic clock that paused during sleep can only make data look *older*, never newer.

## Client behaviour (`lib/arrivals-store.ts`)

- One store and one polling loop for the whole app; opening a station never makes a request.
- Seeded from `localStorage` (validated — a stored entry may predate a schema change) so times show before the first response.
- Polls every 15 s; 2 s while the shared document is still filling after a cold start (bounded, never reset, so one silent station can't keep every tab fast-polling). Stops in hidden tabs; polls immediately on return, on `online`, and on back/forward-cache restore; a watchdog restarts a dead chain.
- Merges by newest reading per station, so a partial or empty response never wipes what's on screen.
- Readings older than 90 s are shown as *last known* (amber, with their age); older than 30 min they're dropped everywhere — server, store and render. If the poller reports the upstream down, the card says so.
- The service worker never caches `arrivals.json` (`NetworkOnly`): a cached copy's old `Date` header would wind the client's clock back and make stale times look live.

## Offline (`app/sw.ts`, `lib/offline-warm.ts`)

Everything except live times is local data, so the app is offline-first:

- The shell (`/`) is added to the Serwist precache in `next.config.ts` (a static export's `index.html` isn't in the glob manifest), next to the hashed chunks, `line-geometry.json`, icons and the MapLibre worker. Navigations are answered from the precache, with query strings ignored, so even a never-opened `/?from=…&to=…` link loads offline. Precache entries carry a per-build revision and outdated caches are cleaned up.
- The files the map cannot start without (`line-geometry.json`, the MapLibre worker, manifest, icon) are listed explicitly in `next.config.ts` with content-hash revisions. Left to the runtime cache they were stored only after a page the worker already controlled had fetched them, i.e. from a visitor's *second* load, so going offline after one visit found no map. `e2e/offline-first.spec.ts` covers offline straight after a first visit.
- The transit network does not depend on the basemap. Our layers are added at MapLibre's `style.load`, not `load` (which waits for the basemap's tiles and fonts), so on a slow connection the lines and stations draw as soon as the map code and style are in; if the basemap style cannot be fetched at all, the map falls back to a plain background (`FALLBACK_STYLE` in `components/TransitMap.tsx`) instead of showing nothing.
- The basemap is cached by a `CacheFirst` rule on `tiles.openfreemap.org` (3000 entries, 90 days). On the first idle moment after a visit, `lib/offline-warm.ts` fetches the style, sprite, Latin/Thai glyph ranges and the vector tiles covering the network (z9–13; 9 is where the map opens) and every station's surroundings (z14) — a few hundred small tiles, once, skipped on Data Saver or non-4g/cellular links — and asks for persistent storage so the browser doesn't evict them. (The sprite is also held out of the style on a normal load and attached with `setSprite` once the stations are drawn: fetched alongside the files the first draw needs, it costs the network ~0.6 s on slow 4G and ~2.5 s on 3G of bandwidth; see `components/TransitMap.tsx`.)
- `lib/arrivals-store.ts` tracks `offline` (from `navigator.onLine` and the `online`/`offline` events). While offline it makes no requests, keeps counting down last-known times, and resumes at once on `online`. The UI says "Offline" rather than blaming the source.
- `arrivals.json` is polled with `cache: "no-cache"`, so an unchanged document is a 304 revalidated against the edge ETag instead of a full download.

## Station alert (`lib/stop-alert.ts`, `lib/use-stop-alert.ts`, `lib/alert-output.ts`)

Pure target selection (`alertTargets`, `dueTarget`) is separate from the browser outputs. The destination always rings, plus optionally the station 1–3 rode stops before it and line changes; a fix within ~300–500 m (widened to its accuracy, ignored past 1 km) triggers a target once. Outputs are a synthesised Web Audio chime (no asset, no CSP change; unlocked by the tap that enables alerts), `navigator.vibrate`, an assertive on-screen alert, a service-worker notification if permitted, and a screen wake lock while a trip is watched. Nothing leaves the device.

Platform behaviour the audio code deliberately handles (each has a test):

- **iPhone silent switch.** iOS mutes Web Audio on silent unless the page declares a playback session, so `unlockAudio()` sets `navigator.audioSession.type = "playback"` (Safari 16.4+; absent elsewhere, where nothing mutes the chime).
- **Unlock inside a tap.** The `AudioContext` is created and resumed in the tap that turns alerts on (plus a one-sample silent buffer, which older iOS needs), because the chime later fires from a GPS update, not a tap. "Test sound" re-runs the unlock in its own tap.
- **Suspended or closed context.** iOS suspends the context on lock/call/Siri and can close it. A closed one is replaced on the next tap; a suspended one is resumed and the notes are scheduled only once it is `running` (a suspended clock is frozen).
- **No vibration on iPhone.** No iPhone browser (Safari, Chrome, Firefox - all WebKit) has the Vibration API; `vibrate()` is a silent no-op there. Android Chrome and Samsung Internet vibrate, but Chrome ignores it until the page has been tapped once.
- **Notifications and Wake Lock** are absent in an iPhone Safari tab (notifications need the installed app) and Wake Lock before iOS 16.4; both degrade to no-ops.

## Live train positions (`lib/live-trains.ts`, `components/live-trains-layer.ts`)

The map draws BTS Sukhumvit and Silom trains moving along the track. The feed has no positions, only "train 087 is due at Siam in 5.9 min", but the same `train_no` is listed at every station ahead of it. Each sighting is a (station, arrival time = reading timestamp + ETA) pair; the train stands at each station for the line's dwell time (`data/hop-times.json`), then eases to the next one by the next sighting's time; a station the feed skips is still stopped at, with the time shared by running times. The hop before its first sighting takes its running time from the same file. `estimateTrains` is pure (no map, no DOM); the layer converts each estimate to a point on the real curved track (`trackBetween`) about four times a second. Trains are drawn as a bold high-contrast arrow (navy, white outline, dark edge; 3:1 on any basemap) rotated to the track's bearing, with a "line · destination" text label from zoom 14 so direction never relies on shape or colour alone, plus a visually hidden list of the same trains (buttons that open the card) for screen readers and keyboard. The layer is added only after the map is idle (`startLiveTrainsWhenIdle`), so it never delays first paint. Tapping one (44 px target, station taps win) opens a card with its number, direction and next stop that follows it.

- **No extra cost.** It reads the arrivals the client already holds, so there is no new request, API route or server work. It is client CPU only (~60 stations, tens of trains).
- **Estimates, not GPS.** Positions are inferred, so they can be off by part of a hop, and a train that no station nearby lists is not drawn.
- **Honest data.** Only readings younger than `FRESH_FOR_MS` are used - extrapolating last-known times would show trains where they no longer are. A train is dropped 45 s after its last sighting, and one whose preceding stations are missing from the feed (a failed poll) is not drawn until it is within a minute of the first station that knows about it.
- **Turnarounds.** A train reaching a terminus is listed as arriving on one platform and leaving on the other; it is drawn once, as the arriving train until that has played out.
- **BTS only.** No other line has a live feed. Nothing is drawn for them rather than faking it from the timetable.

## Routing (`lib/transit-graph.ts`)

- Nodes are station codes. Ride edges come from `data/line-sequences.json`, where each line is one or more **segments** — branches share a station (SRT Light/Dark Red at Krung Thep Aphiwat, Pink's Muang Thong Thani spur at PK10), and MRT Blue is one segment that visits Tha Phra twice (trains run Lak Song → Tha Phra → round the loop → Tha Phra). A line's termini are just its segments' ends, which is also what the boarding direction and the live-arrivals platform matching use.
- Walk edges come from `data/interchanges.json` (16 curated pairs). Same-building interchanges (Siam, Tao Poon) are a single node carrying several lines.
- Dijkstra over *(station, how you arrived, line)* states, so a change of line can be charged properly. Cost is estimated minutes: per hop the scheduled running time + stop time from `data/hop-times.json` (OTP's GTFS feed, built by `scripts/build-hop-times.ts`; BTS, Gold, MRT Blue/Purple, ARL, SRT Dark Red), or for lines without usable feed times (Yellow, Pink, SRT Light Red) 0.5 min dwell + distance at 40 km/h with a 1.15 track-detour factor; 5 min per change; 3 min + 75 m/min per walk.

## Fares (`lib/fares.ts`, `lib/use-fares.ts`, `data/fares.json`)

Shown in the header and route sheet once a start and destination give a route. Computed in the browser from the route's legs and a bundled JSON file, so they cost nothing per user; the file (~65 KB) is a separate chunk, loaded the first time a route exists (`useFares`). Each fare system is charged separately: BTS (Sukhumvit, Silom and Gold share one table), MRT Blue, Purple, Yellow, Pink, the Airport Rail Link and the SRT Red Line. A walk or a change of system starts a new fare and the per-system fares are summed (no through-ticket or transfer discount is assumed). A pair the data lacks (e.g. N6, never built) shows "fare unavailable" and marks the total partial, never a guess.

Data: `scripts/scrape-fares.ts` rebuilds `data/fares.json` from public sources (see `scripts/README.md`): OTP's Namtang GTFS for BTS, Purple, Yellow, Pink and ARL (station-pair matrices, spot-checked against the operators' Royal Gazette tables), srtet.co.th for Red, and the Gazette table for Blue (the feed lags it). `.github/workflows/update-fares.yml` runs it monthly and commits to `main` only if its guards and `npm test` pass; a failure leaves the data untouched and emails the owner.

## Search and settings (`components/StationSearch.tsx`, `components/settings/`, `lib/settings-store.ts`)

- The search input is 16px (`text-base`): iOS Safari zooms the whole page when a focused input is smaller, and page zoom must stay enabled (WCAG 1.4.4), so the font size is the fix, not `maximum-scale`. `e2e/navigation.spec.ts` guards it.
- While the box is empty the panel lists every station by line (`lib/station-groups.ts`); typing switches to ranked matches.
- **Settings are lazy.** `lib/settings-store.ts` (typed defaults, allowed values/ranges, parse) is the only settings code the main bundle needs, because the map, search and arrivals code read it. The menu itself - `components/SettingsMenu.tsx` is just a button and a dialog frame - downloads `components/settings/SettingsPanel.tsx` when first opened (or on hover), and each section's rows (`components/settings/catalog/*.ts`, plain data with EN/TH text) load only when that section is expanded or searched. To add an option: add the field to `Settings`/`DEFAULT_SETTINGS` (and `CHOICES`/`RANGES` if bounded), a row in a catalog file, and wire it where it takes effect; `tests/settings-store.test.ts` checks defaults against their allowed values.
- Settings persist in `localStorage` (`bts:settings:v1`), restored in an effect after hydration (theme and text size are also applied by a tiny inline script in `app/layout.tsx` before first paint, so a saved dark theme doesn't flash light). Nothing is sent anywhere, so there is no cost. Defaults equal the pre-settings behaviour, except that while a route is shown, trains that are not on it are hidden (`otherTrains`; "grey out" and "show" are options).
- Route preferences are `findPath` options (`fewerChanges`, `avoidWalking`, `avoidLines`, `walkSpeed`, `changeMinutes`); the minutes shown never include the preference penalty.
- Route-only trains: `routeHops` / `trainOnRoute` (`lib/live-trains.ts`) match each train's heading to the route's directed hops; the layer filters or fades by the `onRoute` feature property (`components/live-trains-layer.ts`).
- **Station alert sound** (`lib/alert-output.ts`) plays the chime twice over: Web Audio, and a generated WAV through an `<audio>` element (`media-src blob:` in the CSP). On an iPhone, Web Audio can be muted by the ringer switch while media playback is not. "Test sound" reports what actually happened instead of staying silent.

### Online place search (`lib/place-search.ts`)

Below the station matches, the search box lists places (malls, hospitals, hotels, restaurants, streets, addresses) from Photon (`photon.komoot.io`, a typeahead geocoder over OpenStreetMap), limited to greater Bangkok and biased to the centre. Picking one drops a pin and a card with the nearest station and Start / Destination buttons for it. This is the **one** browser-to-third-party call, and it is deliberate: it needs the network (offline it says so and stations still work), it is debounced (350 ms, min 2 characters), cancelled when stale and cached in memory, the service worker never stores it (`app/sw.ts`, `NetworkOnly`), and it can be switched off in Settings ("Search places online"). Photon's public instance is free under fair use with no SLA; if usage ever outgrows that, move to a self-hosted Photon or a keyed provider behind a cached Worker. It adds no cost to our own infrastructure. Its origin is in the CSP `connect-src` (`public/_headers`; `e2e/platform.spec.ts` pins the list). E2E tests mock it (`servePlaces`) and block the service worker for those specs, since the worker answers cross-origin fetches where Playwright's mocking cannot reach.

## Cost model

All numbers per day unless stated; limits are Cloudflare's free plan (checked against Cloudflare's pricing docs, October 2026). None of them depends on the number of users.

| Resource | Usage | Free limit | Share |
| --- | --- | --- | --- |
| Durable Object requests (alarms + watchdog RPC) | ≈ 7,400 alarms + 1,440 cron calls ≈ 8,900 | 100,000 | ~9% |
| Durable Object duration (128 MB) | worst case awake all service hours ≈ 9,500 GB-s; billed only while active, so typically far less | 13,000 GB-s | ≤ 73% |
| Worker requests (cron) | 1,440 | 100,000 | ~1.5% |
| R2 Class A (writes) | ≤ 7,400/day ≈ 223k/month; identical documents are skipped | 1M / month | ≤ 22% |
| R2 Class B (reads) | edge revalidations go through one upper tier (Smart Tiered Cache, enabled): ≤ 8,640/day ≈ 260k/month | 10M / month | ~3% |
| Static assets | every page view | unlimited, free | — |
| CDN bandwidth / R2 egress | every client poll | free | — |
| Upstream API | ≤ 186 calls/min, constant | (their rate limit ≈ 180/min) | — |

Durable Object duration is the tightest line, and the reason two details matter: timeouts are cancelled as soon as a poll finishes (an `AbortSignal.timeout()` left a 9.5 s timer pending after every poll, keeping the object busy), and the poller backs off to a 3-station probe every few minutes when the upstream is down rather than staying awake for 31 failing calls every 10 s.

## Failure modes

| What breaks | What users see | What happens |
| --- | --- | --- |
| Upstream 5xx / timeouts | Last-known times in amber, then "BTS live times are down at the source" | After two failed cycles: state `down`, incident opened, probe 3 stations with backoff (20 s → 5 min). First answer closes the incident. |
| Upstream 429 | Some stations a few seconds older | The cycle stops sending at the first 429; the rest are stalest next time. |
| Poller alarm chain stops | Times age into "last known" | The cron watchdog re-arms it within a minute. |
| Durable Object evicted | Nothing | Readings reload from R2, health from storage; a code that already has a reading counts as tried, so the document stays "complete" (no fast-polling burst). |
| Phone offline | "Offline" notice; last-known times keep counting down; everything else works from cache | No requests while offline; immediate poll on `online`. |
| Phone flaky | Last-known times keep counting down | Retries at the normal cadence. |
| R2 origin errors | Nothing | The edge serves its last copy for up to 5 min (`stale-if-error`); clients show each reading's age. |
| Phone clock wrong | Nothing | Countdowns use the server's clock. |
| `live.` loses edge caching or gets a second CORS header | Possibly no live times (CORS) or more R2 reads | `check-live` fails within 30 minutes and GitHub emails the owner. |

## Testing

- `tests/` (Vitest): routing, data invariants, ETA formatting, payload validation, the arrivals document, track geometry, and the client store's cadence, clock and merge logic.
- `cloudflare/poller/test/` (Vitest in workerd via `@cloudflare/vitest-plugin`): the real Durable Object with a local R2 bucket and a mocked upstream — batching, 429 handling, outage backoff and recovery, skipped writes, eviction — plus pure tests of the scheduling module.
- `tests/alert-output.test.ts` also runs the alert outputs against fake browsers (iPhone iOS 16.4+ and 15-16.3, Android Chrome/Samsung Internet/vibration refused or throwing, desktop, plus failing audio APIs) - the place for behaviour that differs by iOS version or API failure.
- `e2e/alert-devices.spec.ts` (Playwright, the `alert:*` projects defined in `e2e/alert-devices.ts`; `npm run test:alert`) runs the station alert on more than 25 phone profiles in priority order: iPhone Safari and Chrome, the iPhone range (SE to 17 Pro Max), Android (Pixel, Galaxy, foldables, Samsung Internet), desktop last. iPhones run real WebKit (what Chrome on iPhone is too), Android runs Chromium. It probes Web Audio and vibration: context unlocked inside the tap, running when notes are scheduled, recovery from suspended/closed, the playback session, vibrate only where present, and the button fitting the screen. It cannot hear sound or flip the silent switch; that is the manual checklist in `docs/operations.md`.
- `e2e/` (Playwright, desktop + Pixel 7; includes offline reload after one visit, the station alert, and axe-core WCAG 2.2 AA audits) against the production build served by `wrangler dev` with the real response headers: tap a marker, search, plan a route, walking transfer, URL sync, Thai, outage message, headers/manifest. Any console error or CSP violation fails the test.

## SEO and AI discoverability

The map is a canvas, so crawlers see little on `/` by itself. Search visibility comes from static, build-time pages that cost nothing per request:

- `lib/seo.ts` is the single source: site URL, line names (EN/TH), station slugs (`siam-cen`), the curated route pairs (`HUB_CODES`), `pageMeta()` and the JSON-LD builders. `lib/llms.ts` builds `llms.txt`/`llms-full.txt` from the same data.
- `app/(content)/` holds `/lines`, `/lines/[line]`, `/stations`, `/stations/[slug]`, `/routes`, `/routes/[slug]` - `generateStaticParams` over `data/*.json`, no client JS beyond Next's. Route pages use `findPath`, so times match the app. Add a hub station to `HUB_CODES` to grow the route set (every pair of hubs becomes a page).
- `app/robots.ts`, `app/sitemap.ts` and the `llms*.txt` route handlers are `force-static`. Robots explicitly allows the AI crawlers.
- `/` carries a screen-reader-only text block (`components/SeoContent.tsx`: lines, popular routes, FAQ + `FAQPage` JSON-LD); the root layout adds `WebSite`/`WebApplication` JSON-LD and Open Graph/Twitter tags. `public/og/og-default.png` is generated by `node scripts/build-og.mjs` (set `CHROMIUM_PATH` if needed).
- Tests: `tests/seo.test.ts` (slugs, routes, JSON-LD) and `e2e/seo.spec.ts` (crawl files, sitemap URLs resolve, real 404s).

Not doable from code: verify the domain in Google Search Console / Bing Webmaster Tools and submit `https://bangkok-transit.com/sitemap.xml`. Only the apex domain should be indexed; add a `www` -> apex redirect rule in Cloudflare if both hostnames are served.
