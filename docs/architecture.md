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

## Routing (`lib/transit-graph.ts`)

- Nodes are station codes. Ride edges come from `data/line-sequences.json`, where each line is one or more **segments** — branches share a station (SRT Light/Dark Red at Krung Thep Aphiwat, Pink's Muang Thong Thani spur at PK10), and MRT Blue is one segment that visits Tha Phra twice (trains run Lak Song → Tha Phra → round the loop → Tha Phra). A line's termini are just its segments' ends, which is also what the boarding direction and the live-arrivals platform matching use.
- Walk edges come from `data/interchanges.json` (16 curated pairs). Same-building interchanges (Siam, Tao Poon) are a single node carrying several lines.
- Dijkstra over *(station, how you arrived, line)* states, so a change of line can be charged properly. Cost is estimated minutes: per hop 0.5 min dwell + distance at 40 km/h with a 1.15 track-detour factor; 5 min per change; 3 min + 75 m/min per walk.

## Cost model

All numbers per day unless stated; limits are Cloudflare's free plan (checked against Cloudflare's pricing docs, October 2026). None of them depends on the number of users.

| Resource | Usage | Free limit | Share |
| --- | --- | --- | --- |
| Durable Object requests (alarms + watchdog RPC) | ≈ 7,400 alarms + 1,440 cron calls ≈ 8,900 | 100,000 | ~9% |
| Durable Object duration (128 MB) | worst case awake all service hours ≈ 9,500 GB-s; billed only while active, so typically far less | 13,000 GB-s | ≤ 73% |
| Worker requests (cron) | 1,440 | 100,000 | ~1.5% |
| R2 Class A (writes) | ≤ 7,400/day ≈ 223k/month; identical documents are skipped | 1M / month | ≤ 22% |
| R2 Class B (reads) | edge revalidations: ≤ 8,640 per edge location per day; with Smart Tiered Cache one upper tier ≈ 260k/month | 10M / month | ~3% |
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
| Durable Object evicted | Nothing | Readings reload from R2, health from storage. |
| Phone offline / flaky | Last-known times keep counting down | Retries at the normal cadence; immediate poll on `online`. |
| Phone clock wrong | Nothing | Countdowns use the server's clock. |
| `live.` loses edge caching or gets a second CORS header | Possibly no live times (CORS) or more R2 reads | `check-live` fails within 30 minutes and GitHub emails the owner. |

## Testing

- `tests/` (Vitest): routing, data invariants, ETA formatting, payload validation, the arrivals document, track geometry, and the client store's cadence, clock and merge logic.
- `cloudflare/poller/test/` (Vitest in workerd via `@cloudflare/vitest-plugin`): the real Durable Object with a local R2 bucket and a mocked upstream — batching, 429 handling, outage backoff and recovery, skipped writes, eviction — plus pure tests of the scheduling module.
- `e2e/` (Playwright, desktop + Pixel 7) against the production build served by `wrangler dev` with the real response headers: tap a marker, search, plan a route, walking transfer, URL sync, Thai, outage message, headers/manifest. Any console error or CSP violation fails the test.
