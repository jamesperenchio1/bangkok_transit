# Real train timings and rider reports

Status: design approved 2026-11-05. Implementation plan to follow.

## Why

The live train layer (`lib/live-trains.ts`) places BTS trains from the arrivals
feed, but two of its inputs are assumptions rather than measurements: the stop
time at each station (30 s, the median scheduled stop in OTP's GTFS timetable)
and the running time between stations (also timetable). No official or GPS
source of train positions exists (searched 2026-11-05; BTS and OTP publish a
static GTFS only, and the live arrivals feed is a third-party API). The way to
make the animation honest is to measure the real system and ask riders.

## Rule change

The old non-negotiable, "nothing per-user may reach a server that does work",
is replaced by:

- Per-rider **writes** are allowed, but only through one small Worker
  (`report.bangkok-transit.com`) with hard daily caps, so the project stays on
  Cloudflare's free tier and the bill still cannot grow with traffic.
- **Reads** stay CDN-cached static files, as today, so reading costs the same
  for one rider or a million.
- Nothing per-user ever calls `bts-api.topmile.com`. Only `cloudflare/poller`
  does.
- Over a cap, reports are dropped with an honest message; nothing is billed.

`AGENTS.md`, `docs/architecture.md` (goals, cost model) and the project memory
notes are updated in the first implementation step.

## Parts

### 1. Poller measures real timings (no users involved)

The poller already sees every arrival. It additionally detects, per train and
station, when the train actually arrived (the feed's `arriving` status and ETAs
reaching zero) and when it left (it appears at the next station). Events are
stored in the poller Durable Object's SQLite storage and rolled up into a
published `timings.json` on R2 (same CDN path as `arrivals.json`) holding, per
line and hop, the measured median running time and the median stop time at each
station, with sample counts.

The app uses a measured value for a hop or station only once it has enough
samples, and otherwise falls back to the OTP schedule. Every value is labelled
`measured` or `schedule` in the data, so the docs and any UI can say which.

### 2. Reports Worker

A separate Worker (not the poller: its entry may export only the Durable
Object class and the default handler) at `report.bangkok-transit.com`, backed by
D1.

- Request: train number, line, verdict (`ontime`, `late`, `wrong_train`,
  `not_here`), the client's own estimate at that moment (heading, fraction,
  predicted arrival), a random device ID kept in the browser.
- No accounts. No location stored.
- Validation: known line and train number format, timestamp within a couple of
  minutes of server time, verdict from the fixed list.
- Abuse limits: an invisible Cloudflare Turnstile check, a per-device daily
  limit, and a global daily cap sized under the free-tier write limits.
- Retention: reports older than 90 days are deleted by a scheduled job.

### 3. Train card taps

The tap card (`components/live-trains-layer.ts`) gains three buttons, each at
least 44 px: On time, Late, Wrong train. One tap sends and shows a thanks. One
report per train per few minutes per device (kept in `localStorage`). Offline:
no queue; the button explains it needs a connection.

### 4. Aggregation and use

Every 15 minutes the reports Worker rolls the last hour into a cached
`reports-summary.json`. The train card shows "riders say on time" only once a
train has at least 5 reports; below that nothing is claimed. A private script
(`scripts/analyze-reports.ts`) compares predicted, reported and measured
timings for tuning `lib/live-trains.ts`.

## Privacy

Random device ID, no login, no location, 90-day retention, and a short note in
the app saying so.

## Build order

1. Fix the failing e2e tests and ship the current train layer.
2. Rule change in docs and notes; poller measurement and `timings.json`.
3. Reports Worker and the tap UI.
4. Summary badge, then tune the estimator from the data.

## To verify before building

- Free-tier limits for D1 and Durable Object SQLite rows written per day
  (check Cloudflare's current docs; size the caps from them).
- That `report.bangkok-transit.com` can be added alongside `live.`, and the CSP
  `connect-src` and CORS changes it needs.
- Turnstile's free-tier terms and its CSP requirements.
- What the feed's `arriving` status and zero ETAs really mean at a platform
  (stopped vs approaching), by recording a few minutes of readings.
