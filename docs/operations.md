# Operations

Everything that runs in production, what's configured outside the repo, and how to tell what's wrong.

## What's deployed

| Piece | Where | Deployed by |
| --- | --- | --- |
| Site (static export) | Worker `bangkok-transit`, static assets only, on `bangkok-transit.com` and `www.` (`wrangler.jsonc`) | Cloudflare Workers Builds, repo root, on push to `main` |
| Poller | Worker `bangkok-transit-poller` with the `ArrivalsPoller` Durable Object and a `* * * * *` cron (`cloudflare/poller/wrangler.jsonc`) | Cloudflare Workers Builds, root `cloudflare/poller`, on push to `main` |
| Live document | R2 bucket `bts-live`, object `arrivals.json`, custom domain `live.bangkok-transit.com` | Written by the poller |

Both builds use Node 22 (`.node-version`). The site's `wrangler.jsonc` runs `npm run build` itself, so Workers Builds needs no build command. The poller has `workers_dev` and preview URLs off: its only entry points are the cron and the alarm.

## Configuration that lives in the Cloudflare dashboard

None of this is in code, so `scripts/check-live.mjs` checks the effects of each item.

1. **R2 custom domain** — bucket `bts-live` → Settings → Custom Domains → `live.bangkok-transit.com`.
2. **Edge caching for `live.`** — `cf-cache-status` must be `HIT`/`EXPIRED`/`REVALIDATED`, never `DYNAMIC`. (JSON isn't cached by default; a Cache Rule "eligible for cache" on hostname `live.bangkok-transit.com` that respects origin `Cache-Control` does it.) Without it every client poll becomes an R2 read.
3. **CORS Transform Rule** — Rules → Transform Rules → Modify Response Header, hostname `live.bangkok-transit.com`: set `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Date, Age`.
4. **No CORS policy on the R2 bucket.** With both, responses can carry two `Access-Control-Allow-Origin` headers and browsers reject them.
5. **Smart Tiered Cache** (recommended, free) — Caching → Tiered Cache → Smart Tiered Caching Topology. Edge locations then revalidate against one upper tier instead of each hitting R2, so R2 reads stay flat regardless of where users are.

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

## Local

```bash
npm start                                   # build + serve out/ like production (port 8787)
cd cloudflare/poller && npm run dev         # poller with a local R2; GET /__scheduled fires the cron
NEXT_PUBLIC_ARRIVALS_URL=http://localhost:8800/arrivals.json npm run dev   # site against a local document
```
