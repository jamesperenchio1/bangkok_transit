# Operations

Everything that runs in production, what's configured outside the repo, and how to tell what's wrong.

## What's deployed

| Piece | Where | Deployed by |
| --- | --- | --- |
| Site (static export + paid API) | Worker `bangkok-transit`, static assets plus a small Worker that runs only for `/api/*` (`wrangler.jsonc`, `worker/`), on `bangkok-transit.com` and `www.` | Cloudflare Workers Builds, repo root, on push to `main` |
| Poller | Worker `bangkok-transit-poller` with the `ArrivalsPoller` Durable Object and a `* * * * *` cron (`cloudflare/poller/wrangler.jsonc`) | Cloudflare Workers Builds, root `cloudflare/poller`, on push to `main` |
| Live document | R2 bucket `bts-live`, object `arrivals.json`, custom domain `live.bangkok-transit.com` | Written by the poller |

Every other branch (e.g. a PR) is deployed by Workers Builds as a **Worker Preview** (`npx wrangler preview`), which is why both `wrangler.jsonc` files carry an empty `previews` block — without it those builds fail. A site Preview gets its own URL, posted on the PR. A poller Preview is inert: Previews inherit no bindings (so it can't write the production R2 document), get their own Durable Object namespace, and Cron Triggers only fire production.

Both builds use Node 22 (`.node-version`). The site's `wrangler.jsonc` runs `npm run build` itself, so Workers Builds needs no build command. The poller has `workers_dev` and preview URLs off: its only entry points are the cron and the alarm.

## Configuration that lives in the Cloudflare dashboard

None of this is in code, so `scripts/check-live.mjs` checks the effects of each item.

1. **R2 custom domain** — bucket `bts-live` → Settings → Custom Domains → `live.bangkok-transit.com`.
2. **Edge caching for `live.`** — `cf-cache-status` must be `HIT`/`EXPIRED`/`REVALIDATED`, never `DYNAMIC`. (JSON isn't cached by default; a Cache Rule "eligible for cache" on hostname `live.bangkok-transit.com` that respects origin `Cache-Control` does it.) Without it every client poll becomes an R2 read.
3. **CORS Transform Rule** — Rules → Transform Rules → Modify Response Header, hostname `live.bangkok-transit.com`: set `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Date, Age`.
4. **No CORS policy on the R2 bucket.** With both, responses can carry two `Access-Control-Allow-Origin` headers and browsers reject them.
5. **Smart Tiered Cache** (on, free) — Caching → Tiered Cache → Smart Tiered Cache. Edge locations then revalidate against one upper tier instead of each hitting R2, so R2 reads stay flat regardless of where users are.
6. **Early Hints** (on, free) — Speed → Settings → Content Optimization → Early Hints. The home page carries `Link` headers in `public/_headers` (preconnect to the tile host, preload of the map style and `line-geometry.json`). With the toggle on, Cloudflare caches those headers and sends them as a `103 Early Hints` response while it is still producing the page, so the browser starts those downloads before the HTML arrives; the headers also work as plain headers with it off, just later. It needs HTTP/2 or HTTP/3 and Chrome 94+ (others ignore the 103). Cloudflare only generates a 103 for pages with no file extension or `.html`, status 200/301/302, with `Link` headers of `preload`/`preconnect` — the home page `/` qualifies. It costs nothing and adds no Worker requests. To confirm it is on, after one warm-up request: `curl -sv --http2 https://bangkok-transit.com/ -o /dev/null 2>&1 | grep -iE "< HTTP/2 103|< link"` should show a `103` line before the `200`. A 103 is not guaranteed on every request (Cloudflare skips it when the page is served before the lookup finishes), so a few tries may be needed. `check-live` verifies the headers, not the toggle.

## Paid API (x402)

`https://bangkok-transit.com/api/v1` sells data to AI agents per call (design and rules: `docs/architecture.md#paid-api-x402`). Only `/api/*` runs a Worker; keep `assets.run_worker_first` in `wrangler.jsonc` exactly `["/api/*"]`.

**State today: TEST MODE.** `X402_NETWORK` is `eip155:84532` (Base Sepolia) and the facilitator is `https://x402.org/facilitator`, which is testnet-only. Payments are test USDC with no monetary value. The wallet that receives them is `X402_PAY_TO` in `wrangler.jsonc`; only the public address is in the repo, the private key never is.

Prices live in one table, `PAID_ENDPOINTS` in `lib/paid-api.ts` (arrivals $0.002, route $0.005, station $0.001, line $0.001). Change a price there; `public/openapi.json` and `llms.txt` are tested against it, so a mismatch fails CI.

**Check it by hand**

```bash
curl -s https://bangkok-transit.com/api/v1 | jq '{testnet: .payments.testnet, payTo: .payments.payTo, prices: [.endpoints[].price]}'
curl -si 'https://bangkok-transit.com/api/v1/route?from=N8&to=CEN' | head -12   # HTTP 402 + payment-required header, no data
```

`npm run check:live` asserts the same (the index is 200 with the prices; a paid route is 402, never 200).

**Try a real payment on the test network.** Use a throwaway key, never your wallet's. Get test ETH and test USDC for it from the Base Sepolia faucets (Circle's USDC faucet), then:

```ts
// npm i @x402/fetch @x402/evm viem   (in a scratch folder, not this repo)
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
const client = new x402Client().register("eip155:*", new ExactEvmScheme(privateKeyToAccount(process.env.TEST_KEY as `0x${string}`)));
const res = await wrapFetchWithPayment(fetch, client)("https://bangkok-transit.com/api/v1/route?from=N8&to=A08");
console.log(res.status, await res.json(), res.headers.get("payment-response"));
```

A 200 plus a `payment-response` header with a transaction hash means the whole path works. The payment shows up on https://sepolia.basescan.org under your wallet address.

**Going live (real money) is a deliberate change, not a switch:**

1. Pick a **production facilitator**. The x402.org one does not support Base mainnet and will fail route setup if you only change the network. Options listed by x402: Coinbase's CDP facilitator (`https://api.cdp.coinbase.com/platform/v2/x402`, needs a CDP account and API key) or PayAI (`https://facilitator.payai.network`); read the provider's current terms and fees first. **Nothing here has been tested against a mainnet facilitator or with real money.**
2. If the facilitator needs an API key, add it as a Workers secret (`npx wrangler secret put FACILITATOR_API_KEY`), never in `wrangler.jsonc` or git, and pass auth headers in `worker/app.ts` (`HTTPFacilitatorClient({ createAuthHeaders })`, keyed `verify` / `settle` / `supported`). The code sends no facilitator auth today.
3. In `wrangler.jsonc` set `X402_NETWORK` to `eip155:8453` and `X402_FACILITATOR_URL` to the new facilitator. Check `https://bangkok-transit.com/api/v1` now says `testnet: false`.
4. Make one real small purchase yourself and confirm USDC arrives in your wallet.
5. **Check the data terms first.** Arrivals come from a third-party feed (`bts-api.topmile.com`, read only by the poller). Selling data derived from it may be restricted by that provider's terms, which this repo does not contain. If in doubt, remove the `arrivals` entry from `PAID_ENDPOINTS` and its route in `worker/app.ts` (route planning and station/line facts come from this repo's own data).

**Protect the free tier (recommended, dashboard).** Every request to `/api/*`, including unpaid ones that just get a 402, is one Worker invocation; Cloudflare's free plan allows 100,000 a day and ~10 ms CPU each (a route search measured ~2 ms). Add a rate-limiting rule: Security → WAF → Rate limiting rules → expression `starts_with(http.request.uri.path, "/api/")`, e.g. 60 requests per minute per IP, action Block. Without it, someone hammering `/api/*` can use up the day's Worker requests; the rest of the site keeps working (static assets are not metered), but the paid API would stop until midnight UTC, or you move to the $5/month Workers plan.

**Failure behaviour.** Facilitator down or slow (10 s timeout): paid calls answer 503, serve nothing, charge nothing. Bad config (`X402_*` invalid): every `/api/*` route answers 503. Neither can ever serve paid data for free.

## Is it healthy?

```bash
npm run check:live
```

Prints the live document's state and exits non-zero on any problem. The same script runs every 30 minutes in GitHub Actions (`live-check.yml`); a failed run emails the repo owner. Scheduled workflows are disabled after 60 days without repo activity — re-enable from the Actions tab.

By hand:

```bash
curl -sD - -o /dev/null -H 'Origin: https://bangkok-transit.com' https://live.bangkok-transit.com/arrivals.json
curl -s https://live.bangkok-transit.com/arrivals.json | jq '{complete, status, poll}'
curl -s https://bts-api.topmile.com/health; curl -s -o /dev/null -w '%{http_code}\n' https://bts-api.topmile.com/arrivals/CEN
```

The document's fields:

- `status.state` — `ok`, `degraded` (some stations failing) or `down` (whole cycles failing; the poller is probing with backoff). `since`, `lastSuccessAt`, and `incidents` (last 10 outages with start/end) answer "since when?".
- `poll` — the last *written* poll: how many stations it tried, how many answered, and why each failure failed (`500`, `429`, `timeout`, `deadline`, `skipped`, `malformed`). While nothing changes (overnight, during an outage) the document isn't rewritten, so `poll.at` can be minutes old — that's expected.
- `complete` — clients fast-poll until this is true.

Poller logs (`console.warn("upstream failures")`, state transitions) are in the Cloudflare dashboard → Workers → `bangkok-transit-poller` → Logs (observability is enabled), or live with `npx wrangler tail` from `cloudflare/poller`.

## Runbook

| Symptom | Check | Fix |
| --- | --- | --- |
| "Down at the source" in the app | `curl` the upstream directly | Nothing to do on our side; the poller recovers by itself on the first successful probe. |
| Times old everywhere, `status` ok, `poll.at` old during the day | Logs for errors; does the alarm exist? | The cron watchdog should re-arm within a minute. Redeploying the poller also restarts it. |
| No live times at all, console shows a CORS error | `check-live` (ACAO header count, exposed headers) | Remove any CORS policy from the R2 bucket; check the Transform Rule. |
| `check-live`: not edge-cached | `cf-cache-status` on `live.` | Restore the Cache Rule. |
| A deploy broke the site | Workers → `bangkok-transit` → Deployments | Roll back to the previous version there, then fix forward. |

## Real-phone check: station alert sound and vibration

The automated matrix (`npm run test:alert`) proves the code unlocks, resumes and schedules the chime correctly on every phone profile, but a headless browser can't hear it. Before announcing a change to `lib/alert-output.ts`, `lib/use-stop-alert.ts` or the alert controls, try it on real phones (open the app, plan a route, switch on *Alert me near my stop*, expand the options, tap *Test sound*):

| Phone | Expect |
| --- | --- |
| iPhone, Safari, ringer switch on silent | Chime plays (the playback session overrides the switch). No vibration - iPhones don't offer it to web pages. |
| iPhone, Safari, ringer on | Chime plays at media volume. |
| iPhone, Chrome | Same as Safari. |
| iPhone, after locking and unlocking the screen, then tapping *Test sound* | Chime plays (suspended context resumes). |
| Android, Chrome, ringer on | Chime plays and the phone vibrates. |
| Android, Chrome, on vibrate/silent | Vibrates; chime follows media volume. |
| Android, Samsung Internet | Chime plays and the phone vibrates. |
| Any phone, media volume at zero | Nothing audible - the on-screen alert still shows; this is expected. |

If a phone is silent, first check media volume (not ringer volume), then Bluetooth routing, then open a page in the same browser that plays audio to rule out the device.

## Local

```bash
npm start                                   # build + serve out/ like production (port 8787)
cd cloudflare/poller && npm run dev         # poller with a local R2; GET /__scheduled fires the cron
NEXT_PUBLIC_ARRIVALS_URL=http://localhost:8800/arrivals.json npm run dev   # site against a local document
npx playwright install chromium webkit      # once: the alert matrix needs WebKit for iPhones
npm run test:alert -- --workers=3            # every phone profile; add --project=alert:iphone15-safari to run one
```
