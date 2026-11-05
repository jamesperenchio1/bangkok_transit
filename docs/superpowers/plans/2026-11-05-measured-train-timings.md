# Measured Train Timings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live train layer's assumed stop and running times (OTP timetable figures) with times measured from the real arrivals feed, and record the rule change that allows per-rider writes.

**Architecture:** The poller Durable Object already sees every reading. A pure `StopObserver` turns successive raw readings into "train X stood at station S from A to L" and "train X ran from S to S' in R ms" events. A `TimingStore` (Durable Object SQLite) keeps a 5-second-bucket histogram per station and per hop and rolls it up hourly into `timings.json` on R2 (same CDN path as `arrivals.json`). The browser fetches that file once, and `estimateTrains` prefers a measured value once it has `MIN_SAMPLES` samples, otherwise the schedule. Rider reports (the Reports Worker and tap UI) are a **separate plan** (`2026-11-05-rider-reports.md`) that starts after the verification items in the spec are checked.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Object SQLite (`ctx.storage.sql`), R2, Vitest (+ `@cloudflare/vitest-plugin` for the poller), Next.js 16 static export, Zustand/MapLibre (unchanged).

Spec: `docs/superpowers/specs/2026-11-05-real-timings-and-rider-reports-design.md`.

## Global Constraints

- Nothing per-user may call `bts-api.topmile.com`; only `cloudflare/poller` does (unchanged).
- Reads stay CDN-cached static files. `timings.json` is one R2 object, `Cache-Control: public, max-age=0, s-maxage=3600`.
- The poller's entry module (`cloudflare/poller/src/index.ts`) may export only the Durable Object class and the default handler; put anything else in other files. `npm run smoke` (in `cloudflare/poller`) guards this.
- Timers in the poller must be cancellable; add no `AbortSignal.timeout()`.
- `lib/timings.ts` and `lib/live-lines.ts` must stay free of runtime-specific imports (browser and Worker both import them).
- Upstream `timestamp`s are UTC without a `Z`; always parse by appending `Z` (see `ageMs` in `lib/bts.ts`).
- "Honest live data": a value is `measured` only if it has at least `MIN_SAMPLES = 30` samples; otherwise the schedule figure is used.
- Match the surrounding comment style: explain *why*, especially for workarounds. Strict TypeScript. No AI features.
- Zero failing tests before a commit: `npm run lint`, `npm run typecheck`, `npm test`, and in `cloudflare/poller` `npm run typecheck && npm test && npm run smoke`.
- Free-tier numbers (D1 / Durable Object rows written per day) are **unverified**; Task 6 adds a counter so they can be checked against Cloudflare's current docs before the reports plan builds on them.

## Precondition

The live train layer on branch `claude/live-map-ai-routing-feasibility-173c88` must be green on the full e2e suite and merged first (it is the code Task 7 modifies). Do not start Task 3 until `lib/live-trains.ts` is on the working branch.

## File Structure

| File | Responsibility |
| --- | --- |
| `AGENTS.md`, `docs/architecture.md` | Task 1: the changed rule; Task 8: the measured-timings section |
| `scripts/measure/record-feed.mjs`, `scripts/measure/analyze-feed.mjs` | Task 2: record and inspect the real feed (no upstream calls) |
| `lib/live-lines.ts` (new) | Task 3: `TrainLine`, `SEQUENCE`, `lineOf` shared by the estimator and the observer |
| `lib/timings.ts` (new) | Task 4: histogram median, keys, document type + validator |
| `cloudflare/poller/src/observations.ts` (new) | Task 5: `StopObserver` (pure) |
| `cloudflare/poller/src/timing-store.ts` (new) | Task 6: SQLite histogram + rollup |
| `cloudflare/poller/src/index.ts` | Task 6: wire observer, store, hourly publish |
| `lib/arrivals-url.ts`, `lib/timings-client.ts` (new), `lib/live-trains.ts`, `components/live-trains-layer.ts` | Task 7: fetch and use measured timings |

---

### Task 1: Record the rule change

**Files:**
- Modify: `AGENTS.md` (Non-negotiables, first bullet)
- Modify: `docs/architecture.md` (Goals item 2; the sentence "nothing per-user may talk to it either")
- Modify (outside the repo): `/Users/jamesperenchio/.claude/projects/-Users-jamesperenchio-Desktop-AI-Coding-Projects-bangkok-transit/memory/arrivals-architecture.md`
- Create (outside the repo): `.../memory/per-rider-writes-allowed.md`; add a pointer line to `.../memory/MEMORY.md`

**Interfaces:**
- Produces: the wording every later plan cites ("per-rider writes allowed through the one reports Worker, capped to the free tier").

- [ ] **Step 1: Edit the first non-negotiable in `AGENTS.md`**

Replace the bullet that starts `- **Costs must not scale with users.**` (the whole bullet, through `...Keep the Cloudflare free-tier numbers in `docs/architecture.md#cost-model` true.`) with:

```markdown
- **Costs must not scale with users - but riders may write.** Page views are
  static assets and live data is one CDN-cached file written by one Durable
  Object. Per-rider *writes* (rider reports) are allowed only through the one
  reports Worker, with hard daily caps sized to the Cloudflare free tier: over
  the cap a report is dropped with an honest message, never billed. Reads stay
  CDN-cached files. Don't add other API routes, per-user fetches to the
  upstream, or anything that needs a paid plan. Keep the free-tier numbers in
  `docs/architecture.md#cost-model` true.
```

Leave the next bullet (`**Never per-user calls to bts-api.topmile.com.**`) unchanged.

- [ ] **Step 2: Edit `docs/architecture.md`**

Replace Goals item 2:

```markdown
2. **Running cost that doesn't grow with users** — and is $0 at any realistic traffic. Reads are CDN-cached files; the only per-rider writes are rider reports, through one Worker with hard daily caps on the free tier.
```

In "The constraint that shapes everything", the sentence `So the browser can't talk to it, and nothing per-user may talk to it either:` stays (it is about the *upstream*). No other edit.

- [ ] **Step 3: Update the memory notes**

In `memory/arrivals-architecture.md`, replace the `**Why:**` and `**How to apply:**` paragraphs with:

```markdown
**Why:** James wants the app to stay on free tiers ("free for >100 users") and reads must never scale with users. On 2026-11-05 he scrapped the older "nothing per-user may reach a server" rule so riders can submit train reports; see [[per-rider-writes-allowed]].

**How to apply:** never propose per-user *upstream* calls, other API routes, or paid services. Per-rider writes are fine only through the one reports Worker with hard free-tier caps. Full cost model and failure modes are in `docs/architecture.md`; dashboard-only config in `docs/operations.md`. The poller entry module may export only the DO class + default handler - `npm run smoke` guards it.
```

Create `memory/per-rider-writes-allowed.md`:

```markdown
---
name: per-rider-writes-allowed
description: The "no per-user server work" rule was scrapped on 2026-11-05; rider reports may write to one capped Worker
metadata:
  type: project
---

On 2026-11-05 James scrapped the rule that nothing per-user may reach a server, so riders can tap "on time / late / wrong train" on a live train and the app can learn real timings. Chosen: stay on the Cloudflare free tier with hard daily caps (drop over the cap, never bill); reports kept privately first, public accuracy badge later (>= 5 reports).

**Why:** no official or GPS source of BTS train positions exists (searched 2026-11-05), so measured timings plus rider reports are the way to make the train animation honest.

**How to apply:** per-rider writes only via the reports Worker; reads stay CDN-cached files; still never call bts-api.topmile.com per user. Design: docs/superpowers/specs/2026-11-05-real-timings-and-rider-reports-design.md. See [[arrivals-architecture]].
```

Add to `memory/MEMORY.md`:

```markdown
- [Per-rider writes allowed](per-rider-writes-allowed.md) — rule scrapped 2026-11-05; rider reports via one capped free-tier Worker.
```

- [ ] **Step 4: Commit the repo changes**

```bash
git add AGENTS.md docs/architecture.md
git commit -m "docs: allow per-rider writes through one capped Worker

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Record the real feed and confirm what a listed train means

The whole plan rests on one hypothesis (H1): **the feed keeps listing a train on a platform after its predicted arrival (ETA ≤ 0, `status: "arriving"`) until it pulls out, so the time between predicted arrival and disappearance is the stop time.** Evidence so far is only that a snapshot showed ETAs of -0.34 to -0.43 min with `arriving`. This task checks H1 on real data before any detector is written.

**Files:**
- Create: `scripts/measure/record-feed.mjs`
- Create: `scripts/measure/analyze-feed.mjs`

**Interfaces:**
- Produces: a go/no-go decision on H1, and an `n` of how many dwell samples a 15-minute recording yields (used to sanity-check `MIN_SAMPLES`).

- [ ] **Step 1: Write the recorder**

`scripts/measure/record-feed.mjs` (reads the CDN copy only - it never touches `bts-api.topmile.com`):

```js
#!/usr/bin/env node
// Records the published arrivals.json (the CDN copy every rider reads - never
// the upstream API) every 10 s into a JSONL file, one snapshot per line.
// Usage: node scripts/measure/record-feed.mjs <out.jsonl> [minutes=15]
import { appendFileSync } from "node:fs";

const [, , out, minutes = "15"] = process.argv;
if (!out) {
  console.error("usage: record-feed.mjs <out.jsonl> [minutes]");
  process.exit(2);
}
const URL = process.env.ARRIVALS_URL ?? "https://live.bangkok-transit.com/arrivals.json";
const until = Date.now() + Number(minutes) * 60_000;
let n = 0;
while (Date.now() < until) {
  try {
    const res = await fetch(URL, { cache: "no-store" });
    if (res.ok) {
      const doc = await res.json();
      appendFileSync(out, JSON.stringify({ fetchedAt: Date.now(), arrivals: doc.arrivals }) + "\n");
      n++;
    }
  } catch {
    // A missed snapshot just leaves a gap.
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
console.log(`recorded ${n} snapshots to ${out}`);
```

- [ ] **Step 2: Write the analyzer**

`scripts/measure/analyze-feed.mjs` - applies the intended detector rule to the recording and prints evidence for H1:

```js
#!/usr/bin/env node
// Prints, for each (station, direction, train) seen near a platform, how the
// feed treated it: the last ETA it was listed with, how long after its
// predicted arrival it stayed listed, and the implied stop time.
// Usage: node scripts/measure/analyze-feed.mjs <recording.jsonl>
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const utc = (iso) => Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);

// One entry per distinct station reading (the CDN serves the same reading until it is refreshed).
const seenReading = new Map(); // station -> last readAt
const tracks = new Map(); // key -> { readAt, predictedAt, eta, status, firstNear }
const samples = [];

for (const row of rows) {
  for (const [code, reading] of Object.entries(row.arrivals)) {
    const readAt = utc(reading.timestamp);
    if (!(readAt > (seenReading.get(code) ?? -Infinity))) continue;
    seenReading.set(code, readAt);
    const listed = new Set();
    for (const p of reading.platforms) {
      for (const t of p.trains) {
        const eta = t.eta_precise ?? t.eta_minutes;
        if (typeof eta !== "number") continue;
        const key = `${code}|${p.direction_key}|${t.train_no}`;
        listed.add(key);
        tracks.set(key, { code, dir: p.direction_key, train: t.train_no, readAt, predictedAt: readAt + eta * 60_000, eta, status: t.status });
      }
    }
    for (const [key, tr] of [...tracks]) {
      if (tr.code !== code || listed.has(key)) continue;
      tracks.delete(key);
      const leftAt = (tr.readAt + readAt) / 2;
      samples.push({ ...tr, goneAt: readAt, dwellS: (leftAt - tr.predictedAt) / 1000 });
    }
  }
}

const near = samples.filter((s) => s.eta <= 0.75);
const approaching = samples.filter((s) => s.eta > 0.75);
const dwell = near.map((s) => s.dwellS).filter((d) => d >= 0 && d <= 300).sort((a, b) => a - b);
const median = (a) => (a.length ? a[Math.floor(a.length / 2)] : NaN);
console.log(`tracks that vanished: ${samples.length}`);
console.log(`  last listed at ETA <= 0.75 min (at the platform): ${near.length}`);
console.log(`  last listed at ETA  > 0.75 min (list cut short?) : ${approaching.length}`);
console.log(`  plausible dwell samples (0-300 s): ${dwell.length}, median ${median(dwell).toFixed(0)} s`);
console.log(`  last statuses at the platform:`, Object.fromEntries(near.reduce((m, s) => m.set(s.status, (m.get(s.status) ?? 0) + 1), new Map())));
console.log("first 15 samples:");
for (const s of near.slice(0, 15)) {
  console.log(`  ${s.code} ${s.dir} #${s.train} lastEta=${s.eta.toFixed(2)} ${s.status} dwell=${s.dwellS.toFixed(0)}s`);
}
```

- [ ] **Step 3: Record 15 minutes of the live feed**

Run (during service hours, 05:15-00:30 Bangkok):

```bash
node scripts/measure/record-feed.mjs /private/tmp/claude-501/feed-recording.jsonl 15
```

Expected: `recorded ~90 snapshots to ...`. (Run it in the background; do not poll.)

- [ ] **Step 4: Analyze and decide**

```bash
node scripts/measure/analyze-feed.mjs /private/tmp/claude-501/feed-recording.jsonl
```

**Decision rule.** H1 holds if at least 70 % of vanished tracks were last listed at ETA <= 0.75 min **and** the median plausible dwell is between 10 s and 120 s with at least 60 plausible samples. Then continue to Task 3.

If H1 fails (most trains vanish while still approaching, or dwells cluster at or below 0 s): **stop and report to the user.** The fallback design is to drop stop-time measurement and measure only running times from arrival predictions (arrival = last predicted time before the train leaves the list); do not continue Tasks 5-7 as written without that decision.

- [ ] **Step 5: Commit the tools**

```bash
git add scripts/measure
git commit -m "chore: tools to record and inspect the published arrivals feed

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Share the line sequences between the estimator and the observer

**Files:**
- Create: `lib/live-lines.ts`
- Modify: `lib/live-trains.ts:1-30` and `lib/live-trains.ts` (the `lineOf` function)
- Test: existing `tests/live-trains.test.ts` (must still pass unchanged)

**Interfaces:**
- Produces: `export type TrainLine = "sukhumvit" | "silom"`, `export const TRAIN_LINES: TrainLine[]`, `export const SEQUENCE: Record<TrainLine, string[]>`, `export function lineOf(directionKey: string): TrainLine | null`.

- [ ] **Step 1: Create `lib/live-lines.ts`**

```ts
import lineSequences from "@/data/line-sequences.json";

/**
 * The two BTS lines the live feed covers, and each one's ordered stop list.
 * Shared by the browser's train estimator (lib/live-trains.ts) and the
 * poller's observer (cloudflare/poller/src/observations.ts); kept free of
 * runtime-specific imports so both can use it.
 */
export type TrainLine = "sukhumvit" | "silom";
export const TRAIN_LINES: TrainLine[] = ["sukhumvit", "silom"];

const sequences = lineSequences as Record<string, string[][]>;

/** The one ordered stop list per live line (both are single-segment). */
export const SEQUENCE: Record<TrainLine, string[]> = {
  sukhumvit: sequences.sukhumvit[0],
  silom: sequences.silom[0],
};

/** The line whose stop list contains a platform's `direction_key` (its terminus code). */
export function lineOf(directionKey: string): TrainLine | null {
  return TRAIN_LINES.find((l) => SEQUENCE[l].includes(directionKey)) ?? null;
}
```

Note: the poller imports with relative paths, not the `@/` alias. Check `cloudflare/poller/tsconfig.json` and `vitest.config.ts` for an alias; **if there is none**, write the import in this file as `import lineSequences from "../data/line-sequences.json";` instead (relative imports work in both the Next build and the poller).

- [ ] **Step 2: Use it in `lib/live-trains.ts`**

Delete these lines near the top:

```ts
import lineSequences from "@/data/line-sequences.json";
```
```ts
export type TrainLine = "sukhumvit" | "silom";
const TRAIN_LINES: TrainLine[] = ["sukhumvit", "silom"];
const sequences = lineSequences as Record<string, string[][]>;

/** The one ordered stop list per live line (both are single-segment). */
const SEQUENCE: Record<TrainLine, string[]> = {
  sukhumvit: sequences.sukhumvit[0],
  silom: sequences.silom[0],
};
```
and the function:
```ts
function lineOf(directionKey: string): TrainLine | null {
  return TRAIN_LINES.find((l) => SEQUENCE[l].includes(directionKey)) ?? null;
}
```

Add at the top:

```ts
import { lineOf, SEQUENCE, type TrainLine } from "./live-lines";

export type { TrainLine };
```

(`components/live-trains-layer.ts` imports `type TrainLine` from `@/lib/live-trains`; the re-export keeps that working.)

- [ ] **Step 3: Verify nothing changed**

Run: `npx vitest run tests/live-trains.test.ts && npm run typecheck`
Expected: 17 tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/live-lines.ts lib/live-trains.ts
git commit -m "refactor: share the live line sequences with the poller

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Timing histograms and the published document

**Files:**
- Create: `lib/timings.ts`
- Test: `tests/timings.test.ts`

**Interfaces:**
- Produces (all exported from `lib/timings.ts`):
  - `BUCKET_MS = 5_000`, `MIN_SAMPLES = 30`
  - `interface Timing { medianMs: number; samples: number }`
  - `interface TimingsDocument { generatedAt: string; dwell: Record<string, Timing>; run: Record<string, Timing> }`
  - `interface HistogramRow { bucket: number; count: number }`
  - `hopKey(a, b): string` (sorted, `"A|B"`), `dwellKey(line, station): string` (`"sukhumvit:N9"`), `runKey(line, a, b): string` (`"sukhumvit:N10|N9"`)
  - `medianFromHistogram(rows: HistogramRow[]): Timing | null`
  - `isTimingsDocument(v: unknown): v is TimingsDocument`

- [ ] **Step 1: Write the failing tests**

`tests/timings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUCKET_MS, dwellKey, hopKey, isTimingsDocument, medianFromHistogram, runKey } from "@/lib/timings";

describe("medianFromHistogram", () => {
  it("has no median without samples", () => {
    expect(medianFromHistogram([])).toBeNull();
    expect(medianFromHistogram([{ bucket: 3, count: 0 }])).toBeNull();
  });

  it("returns the centre of the bucket holding the median, and the sample count", () => {
    // Four samples: one in 10-15 s, three in 30-35 s. The median is in the second.
    expect(medianFromHistogram([{ bucket: 2, count: 1 }, { bucket: 6, count: 3 }])).toEqual({
      medianMs: 6.5 * BUCKET_MS,
      samples: 4,
    });
  });

  it("does not depend on the order of the rows", () => {
    const rows = [{ bucket: 6, count: 3 }, { bucket: 2, count: 1 }];
    expect(medianFromHistogram(rows)).toEqual(medianFromHistogram([...rows].reverse()));
  });
});

describe("keys", () => {
  it("names a hop the same way in both directions", () => {
    expect(hopKey("N9", "N10")).toBe("N10|N9");
    expect(hopKey("N10", "N9")).toBe("N10|N9");
    expect(runKey("sukhumvit", "N9", "N10")).toBe("sukhumvit:N10|N9");
  });

  it("keeps the same station on two lines apart", () => {
    expect(dwellKey("silom", "CEN")).not.toBe(dwellKey("sukhumvit", "CEN"));
  });
});

describe("isTimingsDocument", () => {
  const good = {
    generatedAt: "2026-11-05T12:00:00.000Z",
    dwell: { "sukhumvit:N9": { medianMs: 32_500, samples: 40 } },
    run: { "sukhumvit:N10|N9": { medianMs: 62_500, samples: 35 } },
  };

  it("accepts a well-formed document", () => {
    expect(isTimingsDocument(good)).toBe(true);
    expect(isTimingsDocument({ ...good, dwell: {}, run: {} })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTimingsDocument(null)).toBe(false);
    expect(isTimingsDocument({ ...good, dwell: undefined })).toBe(false);
    expect(isTimingsDocument({ ...good, run: { x: { medianMs: -1, samples: 40 } } })).toBe(false);
    expect(isTimingsDocument({ ...good, run: { x: { medianMs: 99_999_999, samples: 40 } } })).toBe(false);
    expect(isTimingsDocument({ ...good, dwell: { x: { medianMs: 30_000, samples: 0.5 } } })).toBe(false);
    expect(isTimingsDocument({ ...good, generatedAt: 5 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/timings.test.ts`
Expected: FAIL (cannot resolve `@/lib/timings`).

- [ ] **Step 3: Implement `lib/timings.ts`**

```ts
/**
 * Measured stop and running times, published by the poller as `timings.json`
 * (R2 -> CDN, like arrivals.json) and read once per visit by the browser.
 * Kept free of runtime-specific imports: both the Worker and the browser use it.
 *
 * The poller keeps a histogram per station (stop time) and per hop (running
 * time) in 5 s buckets rather than raw samples: one row write per observation,
 * and a rollup that reads a few thousand rows however long it has been running.
 */

/** Histogram resolution; also the best accuracy a median can claim. */
export const BUCKET_MS = 5_000;
/** A measured value is only used (and only published) with at least this many samples. */
export const MIN_SAMPLES = 30;
/** Nothing real is longer than this; a larger "median" means corrupt data. */
const MAX_MEDIAN_MS = 30 * 60_000;

export interface Timing {
  medianMs: number;
  samples: number;
}

export interface TimingsDocument {
  /** When the rollup ran (ISO, UTC). */
  generatedAt: string;
  /** Stop time per `dwellKey(line, station)`. */
  dwell: Record<string, Timing>;
  /** Running time per `runKey(line, a, b)`, both directions pooled. */
  run: Record<string, Timing>;
}

export interface HistogramRow {
  bucket: number;
  count: number;
}

/** A hop between two stations, named the same whichever way the train goes. Matches data/hop-times.json. */
export function hopKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The same station on two lines (Siam) is two platforms with their own habits. */
export const dwellKey = (line: string, station: string): string => `${line}:${station}`;
export const runKey = (line: string, a: string, b: string): string => `${line}:${hopKey(a, b)}`;

/** The median as the centre of the bucket that holds it, or null with no samples. */
export function medianFromHistogram(rows: HistogramRow[]): Timing | null {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return null;
  let seen = 0;
  for (const row of [...rows].sort((a, b) => a.bucket - b.bucket)) {
    seen += row.count;
    if (seen * 2 >= total) return { medianMs: (row.bucket + 0.5) * BUCKET_MS, samples: total };
  }
  return null;
}

function isTimingMap(v: unknown): v is Record<string, Timing> {
  if (!v || typeof v !== "object") return false;
  return Object.values(v).every((t) => {
    if (!t || typeof t !== "object") return false;
    const { medianMs, samples } = t as Timing;
    return (
      Number.isFinite(medianMs) && medianMs >= 0 && medianMs <= MAX_MEDIAN_MS && Number.isInteger(samples) && samples >= 1
    );
  });
}

export function isTimingsDocument(v: unknown): v is TimingsDocument {
  if (!v || typeof v !== "object") return false;
  const d = v as Partial<TimingsDocument>;
  return typeof d.generatedAt === "string" && isTimingMap(d.dwell) && isTimingMap(d.run);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/timings.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/timings.ts tests/timings.test.ts
git commit -m "feat: timing histograms and the timings.json document type

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `StopObserver` - readings in, stop and run events out

**Files:**
- Create: `cloudflare/poller/src/observations.ts`
- Test: `cloudflare/poller/test/observations.test.ts`

**Interfaces:**
- Consumes: `Arrivals` from `lib/bts`; `lineOf`, `SEQUENCE`, `TrainLine` from `lib/live-lines` (Task 3).
- Produces (exported from `observations.ts`):
  - `interface StopEvent { line: TrainLine; station: string; trainNo: string; arrivedAt: number; leftAt: number }`
  - `interface RunEvent { line: TrainLine; from: string; to: string; runMs: number }`
  - `interface Observation { stops: StopEvent[]; runs: RunEvent[] }`
  - `class StopObserver { observe(fresh: Record<string, Arrivals>): Observation }` - feed it the **raw** readings from one poll (`fresh` in `poll()`), never the merged/carried-over ones (carry-over re-times old trains and would invent stops).
  - constants `AT_PLATFORM_MIN = 0.75`, `MAX_DWELL_MS = 300_000`, `MIN_RUN_MS = 10_000`, `MAX_RUN_MS = 600_000`.

- [ ] **Step 1: Write the failing tests**

`cloudflare/poller/test/observations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Arrivals } from "../../../lib/bts";
import { StopObserver } from "../src/observations";

// The upstream stamps payloads in UTC without a "Z".
const T0 = Date.UTC(2026, 10, 5, 11, 0, 0);
const naive = (ms: number) => new Date(ms).toISOString().replace("Z", "");

/** One station's reading at `readAt` with the given trains on the platform towards `directionKey`. */
function reading(code: string, readAt: number, trains: { train: string; eta: number }[], directionKey = "E23"): Arrivals {
  return {
    station: { code, name_en: code, name_th: code, line_color: "#000" },
    platforms: [
      {
        platform: "1",
        line_color: "#000",
        line_id: 1,
        direction: directionKey,
        direction_key: directionKey,
        trains: trains.map((t) => ({
          train_no: t.train,
          destination: directionKey,
          destination_key: directionKey,
          eta_minutes: Math.round(t.eta),
          eta_precise: t.eta,
          status: t.eta <= 0.5 ? "arriving" : "pending",
        })),
      },
    ],
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: "",
    timestamp: naive(readAt),
  };
}

const at = (seconds: number) => T0 + seconds * 1000;

describe("StopObserver", () => {
  it("measures a stop from the predicted arrival to the middle of the gap in which the train left", () => {
    const o = new StopObserver();
    expect(o.observe({ N9: reading("N9", at(0), [{ train: "087", eta: 0.1 }]) })).toEqual({ stops: [], runs: [] });
    expect(o.observe({ N9: reading("N9", at(20), [{ train: "087", eta: -0.2 }]) })).toEqual({ stops: [], runs: [] });
    // Gone by the next reading: it left between +20 s and +40 s.
    const { stops } = o.observe({ N9: reading("N9", at(40), []) });
    expect(stops).toEqual([{ line: "sukhumvit", station: "N9", trainNo: "087", arrivedAt: at(8), leftAt: at(30) }]);
  });

  it("ignores a train that drops off the list while still approaching", () => {
    const o = new StopObserver();
    o.observe({ N9: reading("N9", at(0), [{ train: "087", eta: 3 }]) });
    expect(o.observe({ N9: reading("N9", at(20), []) })).toEqual({ stops: [], runs: [] });
  });

  it("does not take a re-delivered old reading for a departure", () => {
    const o = new StopObserver();
    o.observe({ N9: reading("N9", at(20), [{ train: "087", eta: 0.1 }]) });
    // The CDN/upstream can hand back an older (or the same) reading.
    expect(o.observe({ N9: reading("N9", at(10), []) })).toEqual({ stops: [], runs: [] });
    expect(o.observe({ N9: reading("N9", at(20), []) })).toEqual({ stops: [], runs: [] });
  });

  it("measures the run between two adjacent stops in the train's direction", () => {
    const o = new StopObserver();
    o.observe({ N10: reading("N10", at(0), [{ train: "087", eta: 0.1 }]) });
    o.observe({ N10: reading("N10", at(20), [{ train: "087", eta: -0.2 }]) });
    o.observe({ N10: reading("N10", at(40), []) }); // left N10 at +30 s
    o.observe({ N9: reading("N9", at(80), [{ train: "087", eta: 0.3 }]) });
    o.observe({ N9: reading("N9", at(100), [{ train: "087", eta: -0.1 }]) }); // arrived at +94 s
    const { stops, runs } = o.observe({ N9: reading("N9", at(120), []) });
    expect(stops).toHaveLength(1);
    expect(runs).toEqual([{ line: "sukhumvit", from: "N10", to: "N9", runMs: 64_000 }]);
  });

  it("does not call two stops that are not neighbours a run", () => {
    const o = new StopObserver();
    o.observe({ N11: reading("N11", at(0), [{ train: "087", eta: 0.1 }]) });
    o.observe({ N11: reading("N11", at(20), []) });
    o.observe({ N9: reading("N9", at(80), [{ train: "087", eta: 0.1 }]) });
    expect(o.observe({ N9: reading("N9", at(100), []) }).runs).toEqual([]);
  });

  it("does not pair a train with a neighbour behind it", () => {
    // Toward Kheha (E23) trains go N9 -> N10, not N10 -> N9... so a stop at N9
    // then one at N8 (the neighbour on the wrong side) is not a run.
    const o = new StopObserver();
    o.observe({ N9: reading("N9", at(0), [{ train: "087", eta: 0.1 }]) });
    o.observe({ N9: reading("N9", at(20), []) });
    o.observe({ N8: reading("N8", at(80), [{ train: "087", eta: 0.1 }]) });
    expect(o.observe({ N8: reading("N8", at(100), []) }).runs).toEqual([]);
  });

  it("ignores platforms and stations it does not know", () => {
    const o = new StopObserver();
    o.observe({ N9: reading("N9", at(0), [{ train: "087", eta: 0.1 }], "NOPE") });
    expect(o.observe({ N9: reading("N9", at(20), [], "NOPE") })).toEqual({ stops: [], runs: [] });
    o.observe({ ZZ: reading("ZZ", at(0), [{ train: "087", eta: 0.1 }]) });
    expect(o.observe({ ZZ: reading("ZZ", at(20), []) })).toEqual({ stops: [], runs: [] });
  });
});
```

(Direction check for the "behind it" test: the Sukhumvit stop list runs N24 ... N1, CEN, E1 ... E23, so toward E23 the index grows and N9 → N8 goes the wrong way; N10 → N9 is the right way. Confirm with `grep -n '"N10"\|"N9"' data/line-sequences.json` before relying on it.)

- [ ] **Step 2: Run to confirm failure**

Run: `cd cloudflare/poller && npx vitest run test/observations.test.ts`
Expected: FAIL (cannot find `../src/observations`).

- [ ] **Step 3: Implement `observations.ts`**

```ts
import type { Arrivals } from "../../../lib/bts";
import { lineOf, SEQUENCE, type TrainLine } from "../../../lib/live-lines";

/**
 * Turns successive raw station readings into measured stops and runs.
 *
 * What the feed does (checked against a recording, see
 * scripts/measure/analyze-feed.mjs): a train stays on a platform's list past
 * its predicted arrival, with ETA <= 0 and status "arriving", until it pulls
 * out. So "predicted arrival" (reading time + last ETA) to "the reading in
 * which it is gone" brackets the stop. A train that vanishes while still
 * minutes away is a list cut short, not a departure, and is ignored.
 *
 * Feed it the raw readings of one poll, never the merged ones: carry-over in
 * mergeArrivals re-times old trains and would invent stops. Pure and
 * runtime-free so it is unit-tested without a Worker.
 */

/** A train listed this close (minutes) to a platform is at it, not just approaching. */
export const AT_PLATFORM_MIN = 0.75;
/** Longer than this is not a stop (a held or terminated train); drop the sample. */
export const MAX_DWELL_MS = 5 * 60_000;
/** A run outside this window is a missed station or a reused train number. */
export const MIN_RUN_MS = 10_000;
export const MAX_RUN_MS = 10 * 60_000;
/** A track not refreshed this long belongs to a station we stopped hearing from. */
const TRACK_TTL_MS = 15 * 60_000;

export interface StopEvent {
  line: TrainLine;
  station: string;
  trainNo: string;
  /** When it reached the platform (epoch ms): the last predicted arrival. */
  arrivedAt: number;
  /** When it pulled out: midway between the last reading listing it and the first without it. */
  leftAt: number;
}

export interface RunEvent {
  line: TrainLine;
  from: string;
  to: string;
  /** Left `from` to reached `to`. */
  runMs: number;
}

export interface Observation {
  stops: StopEvent[];
  runs: RunEvent[];
}

interface Track {
  line: TrainLine;
  station: string;
  trainNo: string;
  directionKey: string;
  readAt: number;
  predictedAt: number;
  etaMin: number;
}

interface LastStop {
  station: string;
  leftAt: number;
}

export class StopObserver {
  private tracks = new Map<string, Track>();
  /** Newest reading time seen per station; an older or repeated one is ignored. */
  private lastRead = new Map<string, number>();
  private lastStop = new Map<string, LastStop>();

  observe(fresh: Record<string, Arrivals>): Observation {
    const out: Observation = { stops: [], runs: [] };
    let newest = 0;
    for (const [code, reading] of Object.entries(fresh)) {
      const readAt = Date.parse(reading.timestamp.endsWith("Z") ? reading.timestamp : `${reading.timestamp}Z`);
      if (!Number.isFinite(readAt)) continue;
      // The upstream may hand back the reading we already have; its trains
      // are not "gone", we just haven't heard anything new.
      if (readAt <= (this.lastRead.get(code) ?? -Infinity)) continue;
      this.lastRead.set(code, readAt);
      newest = Math.max(newest, readAt);

      const listed = new Set<string>();
      for (const platform of reading.platforms) {
        const line = lineOf(platform.direction_key);
        if (!line || !SEQUENCE[line].includes(code)) continue;
        for (const train of platform.trains) {
          const eta = train.eta_precise ?? train.eta_minutes;
          if (typeof eta !== "number" || !Number.isFinite(eta)) continue;
          const key = `${code}|${platform.direction_key}|${train.train_no}`;
          listed.add(key);
          this.tracks.set(key, {
            line,
            station: code,
            trainNo: train.train_no,
            directionKey: platform.direction_key,
            readAt,
            predictedAt: readAt + eta * 60_000,
            etaMin: eta,
          });
        }
      }

      for (const [key, track] of this.tracks) {
        if (track.station !== code || listed.has(key)) continue;
        this.tracks.delete(key);
        this.finish(track, readAt, out);
      }
    }
    if (newest > 0) this.forget(newest);
    return out;
  }

  private finish(track: Track, goneAt: number, out: Observation): void {
    if (track.etaMin > AT_PLATFORM_MIN) return;
    const leftAt = (track.readAt + goneAt) / 2;
    const arrivedAt = track.predictedAt;
    const dwell = leftAt - arrivedAt;
    if (dwell < 0 || dwell > MAX_DWELL_MS) return;
    const { line, station, trainNo, directionKey } = track;
    out.stops.push({ line, station, trainNo, arrivedAt, leftAt });

    const seq = SEQUENCE[line];
    const here = seq.indexOf(station);
    const target = seq.indexOf(directionKey);
    const heading = target > here ? 1 : target < here ? -1 : 0;
    const trainKey = `${line}|${trainNo}|${directionKey}`;
    const previous = this.lastStop.get(trainKey);
    if (previous && heading !== 0 && here - seq.indexOf(previous.station) === heading) {
      const runMs = arrivedAt - previous.leftAt;
      if (runMs >= MIN_RUN_MS && runMs <= MAX_RUN_MS) out.runs.push({ line, from: previous.station, to: station, runMs });
    }
    this.lastStop.set(trainKey, { station, leftAt });
  }

  /** Drop state nothing will ever finish, so a long-lived Durable Object does not grow. */
  private forget(now: number): void {
    for (const [key, track] of this.tracks) if (now - track.readAt > TRACK_TTL_MS) this.tracks.delete(key);
    for (const [key, stop] of this.lastStop) if (now - stop.leftAt > TRACK_TTL_MS) this.lastStop.delete(key);
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd cloudflare/poller && npx vitest run test/observations.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cloudflare/poller/src/observations.ts cloudflare/poller/test/observations.test.ts
git commit -m "feat(poller): observe real stop and run times from successive readings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Store histograms in the Durable Object and publish `timings.json`

**Files:**
- Create: `cloudflare/poller/src/timing-store.ts`
- Modify: `cloudflare/poller/src/index.ts` (imports; two private fields; constructor; `poll()`; new `publishTimings`)
- Modify: `cloudflare/poller/src/schedule.ts` (one exported constant)
- Test: `cloudflare/poller/test/timing-store.test.ts`; extend `cloudflare/poller/test/poller.test.ts`

**Interfaces:**
- Consumes: `Observation` (Task 5); `BUCKET_MS`, `MIN_SAMPLES`, `dwellKey`, `runKey`, `medianFromHistogram`, `TimingsDocument` (Task 4).
- Produces: `class TimingStore { constructor(sql: SqlStorage); record(o: Observation): number; rollup(now: number): TimingsDocument; readonly rowsWritten: number }`; `TIMINGS_KEY = "timings.json"` exported from `schedule.ts`.

- [ ] **Step 1: Write the failing store test**

`cloudflare/poller/test/timing-store.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MIN_SAMPLES } from "../../../lib/timings";
import { TimingStore } from "../src/timing-store";

let n = 0;
const freshStub = () => env.POLLER.get(env.POLLER.idFromName(`store-${++n}`));

const stop = (station: string, dwellMs: number) => ({
  line: "sukhumvit" as const,
  station,
  trainNo: "087",
  arrivedAt: 0,
  leftAt: dwellMs,
});

describe("TimingStore", () => {
  it("rolls observations up into medians, and publishes only those with enough samples", async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      const store = new TimingStore(state.storage.sql);
      store.record({
        stops: [...Array(MIN_SAMPLES + 10)].map(() => stop("N9", 30_000)),
        runs: [...Array(MIN_SAMPLES + 5)].map(() => ({ line: "sukhumvit" as const, from: "N10", to: "N9", runMs: 64_000 })),
      });
      // Too few samples to be believed.
      store.record({ stops: [...Array(5)].map(() => stop("N8", 30_000)), runs: [] });

      const doc = store.rollup(Date.UTC(2026, 10, 5, 12));
      expect(doc.generatedAt).toBe("2026-11-05T12:00:00.000Z");
      expect(doc.dwell).toEqual({ "sukhumvit:N9": { medianMs: 32_500, samples: MIN_SAMPLES + 10 } });
      expect(doc.run).toEqual({ "sukhumvit:N10|N9": { medianMs: 62_500, samples: MIN_SAMPLES + 5 } });
    });
  });

  it("keeps counting across rollups and instances (it lives in storage)", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, (_instance, state) => {
      new TimingStore(state.storage.sql).record({ stops: [...Array(MIN_SAMPLES)].map(() => stop("N9", 30_000)), runs: [] });
    });
    await runInDurableObject(stub, (_instance, state) => {
      // A new instance (as after an eviction) sees what the old one wrote.
      expect(new TimingStore(state.storage.sql).rollup(0).dwell["sukhumvit:N9"].samples).toBe(MIN_SAMPLES);
    });
  });

  it("counts the rows it writes, so the daily budget can be watched", async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      const store = new TimingStore(state.storage.sql);
      expect(store.record({ stops: [stop("N9", 30_000), stop("N9", 31_000)], runs: [] })).toBe(2);
      expect(store.rowsWritten).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cloudflare/poller && npx vitest run test/timing-store.test.ts`
Expected: FAIL (cannot find `../src/timing-store`).

- [ ] **Step 3: Implement `timing-store.ts`**

```ts
import {
  BUCKET_MS,
  MIN_SAMPLES,
  dwellKey,
  medianFromHistogram,
  runKey,
  type HistogramRow,
  type Timing,
  type TimingsDocument,
} from "../../../lib/timings";
import type { Observation } from "./observations";

/**
 * Stop and running times as histograms in the Durable Object's own SQLite
 * storage: one upserted row per (kind, key, 5 s bucket), so each observation
 * writes one row and the rollup reads a few thousand however long it has
 * run. Raw events would be ~20,000 row writes a day and a rollup that scans
 * them all.
 */
export class TimingStore {
  /** Rows written since this instance was created; logged hourly to check the daily budget. */
  rowsWritten = 0;

  constructor(private sql: SqlStorage) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS hist (
         kind TEXT NOT NULL, key TEXT NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL,
         PRIMARY KEY (kind, key, bucket)
       )`,
    );
  }

  /** Records an observation; returns the rows written. */
  record({ stops, runs }: Observation): number {
    let written = 0;
    const bump = (kind: "dwell" | "run", key: string, ms: number) => {
      this.sql.exec(
        `INSERT INTO hist (kind, key, bucket, n) VALUES (?, ?, ?, 1)
         ON CONFLICT (kind, key, bucket) DO UPDATE SET n = n + 1`,
        kind,
        key,
        Math.floor(ms / BUCKET_MS),
      );
      written++;
    };
    for (const s of stops) bump("dwell", dwellKey(s.line, s.station), s.leftAt - s.arrivedAt);
    for (const r of runs) bump("run", runKey(r.line, r.from, r.to), r.runMs);
    this.rowsWritten += written;
    return written;
  }

  /** The published document: medians for every key with at least MIN_SAMPLES. */
  rollup(now: number): TimingsDocument {
    const grouped: Record<"dwell" | "run", Map<string, HistogramRow[]>> = { dwell: new Map(), run: new Map() };
    for (const row of this.sql.exec<{ kind: "dwell" | "run"; key: string; bucket: number; n: number }>(
      "SELECT kind, key, bucket, n FROM hist",
    )) {
      const rows = grouped[row.kind].get(row.key) ?? [];
      rows.push({ bucket: row.bucket, count: row.n });
      grouped[row.kind].set(row.key, rows);
    }
    const settle = (map: Map<string, HistogramRow[]>): Record<string, Timing> => {
      const out: Record<string, Timing> = {};
      for (const [key, rows] of map) {
        const timing = medianFromHistogram(rows);
        if (timing && timing.samples >= MIN_SAMPLES) out[key] = timing;
      }
      return out;
    };
    return { generatedAt: new Date(now).toISOString(), dwell: settle(grouped.dwell), run: settle(grouped.run) };
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd cloudflare/poller && npx vitest run test/timing-store.test.ts`
Expected: PASS (3 tests). If `sql.exec` rejects the generic `<{...}>` type argument, remove the type argument and cast each row: `const r = row as {...}`.

- [ ] **Step 5: Write the failing publish test**

In `cloudflare/poller/test/poller.test.ts`, add to the imports `import { isTimingsDocument } from "../../../lib/timings";` and `TIMINGS_KEY` to the `../src/schedule` import; in `afterEach` add `await env.LIVE.delete(TIMINGS_KEY);`; then add inside `describe("ArrivalsPoller", ...)`:

```ts
  it("publishes timings.json on its first poll, cached for an hour", async () => {
    mockUpstream(ok);
    const stub = freshPoller();
    await arm(stub);
    await runDurableObjectAlarm(stub);

    const object = await env.LIVE.get(TIMINGS_KEY);
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.cacheControl).toBe("public, max-age=0, s-maxage=3600");
    const doc = await object!.json();
    expect(isTimingsDocument(doc)).toBe(true);
    // Nothing measured yet, so nothing is claimed.
    expect(doc).toMatchObject({ dwell: {}, run: {} });
  });

  it("does not rewrite timings.json on every alarm", async () => {
    mockUpstream(ok);
    const stub = freshPoller();
    await arm(stub);
    await runDurableObjectAlarm(stub);
    const first = (await env.LIVE.get(TIMINGS_KEY))!.etag;
    await runDurableObjectAlarm(stub);
    expect((await env.LIVE.get(TIMINGS_KEY))!.etag).toBe(first);
  });
```

Run: `cd cloudflare/poller && npx vitest run test/poller.test.ts -t timings`
Expected: FAIL (`TIMINGS_KEY` is not exported / no object).

- [ ] **Step 6: Wire the store into the Durable Object**

In `cloudflare/poller/src/schedule.ts`, below `DOCUMENT_KEY`:

```ts
/** The measured-timings document (served as live.<domain>/timings.json). */
export const TIMINGS_KEY = "timings.json";
/** Timings change slowly: roll up and publish hourly, and let the edge hold one copy that long. */
export const TIMINGS_EVERY_MS = 60 * 60_000;
```

In `cloudflare/poller/src/index.ts`:

1. Add imports and extend the `./schedule` import list with `TIMINGS_EVERY_MS` and `TIMINGS_KEY`:

```ts
import { StopObserver } from "./observations";
import { TimingStore } from "./timing-store";
```

2. Add fields and a constructor to `ArrivalsPoller` (after the `tried` field):

```ts
  /** Turns raw readings into measured stops and runs (in memory; an eviction loses a few minutes of tracks). */
  private observer = new StopObserver();
  private store: TimingStore;
  /** When timings.json was last published; 0 after an eviction, which republishes at once. */
  private lastTimingsAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new TimingStore(ctx.storage.sql);
  }
```

3. In `poll()`, directly after `this.arrivals = mergeArrivals(previous, fresh, now);` add:

```ts
    // Measured timings are a side product: whatever goes wrong here must never
    // stop the arrivals document from being published below.
    try {
      this.store.record(this.observer.observe(fresh));
      await this.publishTimings(now);
    } catch (err) {
      console.error("timings failed", err);
    }
```

4. Add the method next to `previous()`:

```ts
  /** Rolls the histograms up and publishes them, at most once an hour. */
  private async publishTimings(now: number): Promise<void> {
    if (now - this.lastTimingsAt < TIMINGS_EVERY_MS) return;
    this.lastTimingsAt = now;
    const document = this.store.rollup(now);
    await this.env.LIVE.put(TIMINGS_KEY, JSON.stringify(document), {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: `public, max-age=0, s-maxage=${TIMINGS_EVERY_MS / 1000}`,
      },
    });
    console.log("timings published", {
      dwell: Object.keys(document.dwell).length,
      run: Object.keys(document.run).length,
      rowsWrittenSinceStart: this.store.rowsWritten,
    });
  }
```

Note the test "does not rewrite timings.json on every alarm" passes because `lastTimingsAt` gates it (second alarm is within the hour).

- [ ] **Step 7: Run the poller's whole gate**

Run: `cd cloudflare/poller && npm run typecheck && npm test && npm run smoke`
Expected: typecheck clean, all tests pass, smoke boots the Worker (the entry module still exports only the class and the default handler).

- [ ] **Step 8: Commit**

```bash
git add cloudflare/poller
git commit -m "feat(poller): keep timing histograms and publish timings.json hourly

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The browser prefers measured timings

**Files:**
- Modify: `lib/arrivals-url.ts` (add `TIMINGS_URL`)
- Create: `lib/timings-client.ts`
- Modify: `lib/live-trains.ts` (`hopMs`, `dwellMs`, `estimateTrains` signature and three call sites)
- Modify: `components/live-trains-layer.ts` (`startLiveTrains` loads timings; `frame()` passes them)
- Test: `tests/timings-client.test.ts`; extend `tests/live-trains.test.ts`; stub `timings.json` in e2e

**Interfaces:**
- Consumes: `TimingsDocument`, `Timing`, `MIN_SAMPLES`, `dwellKey`, `runKey`, `isTimingsDocument` (Task 4).
- Produces: `TIMINGS_URL`; `loadTimings(signal?: AbortSignal): Promise<TimingsDocument | null>`; `getTimings(): TimingsDocument | null`; `estimateTrains(arrivals, now, timings?: TimingsDocument | null)`.

- [ ] **Step 1: Write the failing estimator tests**

Append to `tests/live-trains.test.ts` (add `import type { TimingsDocument } from "@/lib/timings";` at the top):

```ts
describe("estimateTrains with measured timings", () => {
  const doc = () => docOf(heading("N9", 0.1), heading("N8", 1.4));
  const withTimings = (t: Partial<TimingsDocument>): TimingsDocument => ({
    generatedAt: "2026-11-05T12:00:00.000Z",
    dwell: {},
    run: {},
    ...t,
  });

  it("uses a measured stop time instead of the timetable's", () => {
    // Timetable: 30 s at N9, so +46 s is already on the way to N8.
    expect(estimateTrains(doc(), T0 + 46_000)[0]).toMatchObject({ fromCode: "N9", toCode: "N8" });
    // Measured: riders' trains stand 60 s there, so it is still at the platform.
    const measured = withTimings({ dwell: { "sukhumvit:N9": { medianMs: 60_000, samples: 50 } } });
    expect(estimateTrains(doc(), T0 + 46_000, measured)[0]).toMatchObject({ fromCode: "N9", toCode: "N9" });
  });

  it("ignores a measurement with too few samples", () => {
    const thin = withTimings({ dwell: { "sukhumvit:N9": { medianMs: 60_000, samples: 5 } } });
    expect(estimateTrains(doc(), T0 + 46_000, thin)[0]).toMatchObject({ fromCode: "N9", toCode: "N8" });
  });

  it("uses a measured running time for the hop before the first sighting", () => {
    // Only N9 is known (due at +60 s); N10 -> N9 measured at 40 s. With the
    // timetable's 30 s stop at N10 the train left N10 at +20 s, so +40 s is
    // halfway along the hop.
    const measured = withTimings({ run: { "sukhumvit:N10|N9": { medianMs: 40_000, samples: 50 } } });
    expect(estimateTrains(docOf(heading("N9", 1)), T0 + 40_000, measured)[0]).toMatchObject({
      fromCode: "N10",
      toCode: "N9",
      fraction: 0.5,
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/live-trains.test.ts -t "measured timings"`
Expected: FAIL (the first test's second assertion: `estimateTrains` ignores a third argument; TypeScript may also flag the arity).

- [ ] **Step 3: Teach the estimator about measured timings**

In `lib/live-trains.ts`:

1. Add the import:

```ts
import { MIN_SAMPLES, dwellKey, runKey, type Timing, type TimingsDocument } from "./timings";
```

2. Replace `hopMs` and `dwellMs` (keep the `HopTable` type) with:

```ts
/** A measured figure, once it has enough samples to be believed; otherwise the schedule is used. */
function measured(timing: Timing | undefined): number | null {
  return timing && timing.samples >= MIN_SAMPLES ? timing.medianMs : null;
}

/** How long a train stands at `station`: measured, else the timetable's median stop. */
function dwellMs(line: TrainLine, station: string, timings: TimingsDocument | null | undefined): number {
  const table = (hopTimes.lines as Record<string, HopTable>)[line];
  return measured(timings?.dwell[dwellKey(line, station)]) ?? (table ? table.dwell * 60_000 : FALLBACK_DWELL_MS);
}

/**
 * Time from reaching `from` to reaching `to`: the stop at `from` plus the
 * run. Measured when we have enough samples, else the timetable's.
 */
function hopMs(line: TrainLine, from: string, to: string, timings: TimingsDocument | null | undefined): number {
  const table = (hopTimes.lines as Record<string, HopTable>)[line];
  const scheduled = table?.hops[from < to ? `${from}|${to}` : `${to}|${from}`];
  const run = measured(timings?.run[runKey(line, from, to)]) ?? (scheduled === undefined ? null : scheduled * 60_000);
  return run === null ? FALLBACK_HOP_MS : run + dwellMs(line, from, timings);
}
```

(Delete the old `hopMs` and `dwellMs`. `FALLBACK_DWELL_MS`, `FALLBACK_HOP_MS` and the `HopTable` type already exist in the file.)

3. Change the signature and the three call sites:

```ts
export function estimateTrains(
  arrivals: Record<string, Arrivals>,
  now: number,
  timings?: TimingsDocument | null,
): TrainEstimate[] {
```
- `hopMs(group.line, stationAt(prevU), stationAt(first.u))` → `hopMs(group.line, stationAt(prevU), stationAt(first.u), timings)`
- in the gap expansion: `hopMs(group.line, stationAt(k), stationAt(k + 1))` → `hopMs(group.line, stationAt(k), stationAt(k + 1), timings)`
- `dwellMs(group.line)` → `dwellMs(group.line, stationAt(here.u), timings)`

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/live-trains.test.ts`
Expected: PASS (20 tests: the 17 existing + 3 new).

- [ ] **Step 5: Write the failing loader test**

`tests/timings-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTimings, loadTimings } from "@/lib/timings-client";

const good = {
  generatedAt: "2026-11-05T12:00:00.000Z",
  dwell: { "sukhumvit:N9": { medianMs: 32_500, samples: 40 } },
  run: {},
};

afterEach(() => vi.restoreAllMocks());

describe("loadTimings", () => {
  it("loads, validates and keeps the published document", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(good));
    expect(await loadTimings()).toEqual(good);
    expect(getTimings()).toEqual(good);
  });

  it("falls back quietly (null) on a bad body, an error status or a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ nope: true }));
    expect(await loadTimings()).toBeNull();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("no", { status: 503 }));
    expect(await loadTimings()).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    expect(await loadTimings()).toBeNull();
  });

  it("keeps the last good document when a later load fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(good));
    await loadTimings();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    await loadTimings();
    expect(getTimings()).toEqual(good);
  });
});
```

Run: `npx vitest run tests/timings-client.test.ts`
Expected: FAIL (cannot resolve `@/lib/timings-client`).

- [ ] **Step 6: Implement the loader**

Add to `lib/arrivals-url.ts`:

```ts

/**
 * Measured stop and running times, published hourly by the same poller to
 * the same bucket (see lib/timings.ts). One request per visit; if it fails
 * the timetable's figures stay in use.
 */
export const TIMINGS_URL =
  process.env.NEXT_PUBLIC_TIMINGS_URL ?? "https://live.bangkok-transit.com/timings.json";
```

`lib/timings-client.ts`:

```ts
import { TIMINGS_URL } from "./arrivals-url";
import { isTimingsDocument, type TimingsDocument } from "./timings";

let current: TimingsDocument | null = null;

/** The latest measured timings this visit has loaded, or null (use the timetable). */
export function getTimings(): TimingsDocument | null {
  return current;
}

/**
 * Fetches timings.json once. A bad body, an error status or no network leaves
 * whatever was loaded before in place and returns null - the estimator then
 * falls back to the timetable, so this never needs to surface an error.
 */
export async function loadTimings(signal?: AbortSignal): Promise<TimingsDocument | null> {
  try {
    const res = await fetch(TIMINGS_URL, { cache: "no-cache", signal });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isTimingsDocument(json)) return null;
    current = json;
    return json;
  } catch {
    return null;
  }
}
```

Run: `npx vitest run tests/timings-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Use it in the layer**

In `components/live-trains-layer.ts`:

```ts
import { getTimings, loadTimings } from "@/lib/timings-client";
```

In `startLiveTrains`, before `const reduced = ...`:

```ts
  // One request for measured stop/run times; until it lands (or if it fails)
  // the estimator uses the timetable's figures.
  const timingsRequest = new AbortController();
  void loadTimings(timingsRequest.signal);
```

In `frame()`: `estimateTrains(useArrivalsStore.getState().map, serverNow())` → `estimateTrains(useArrivalsStore.getState().map, serverNow(), getTimings())`.

In the returned cleanup function, add `timingsRequest.abort();` as its first line.

- [ ] **Step 8: Keep the e2e suite offline-safe**

Run: `grep -rn "live.bangkok-transit.com\|arrivals.json" e2e | head`
Wherever the e2e helpers route `arrivals.json` to a fixture, add a sibling route that answers `**/timings.json` with `{ "generatedAt": "2026-11-05T12:00:00.000Z", "dwell": {}, "run": {} }` so a test never depends on the real CDN (follow the existing `page.route` pattern exactly). If a test asserts "no failed requests", this prevents a new failure.

- [ ] **Step 9: Run the site's gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add lib components e2e tests
git commit -m "feat: use measured stop and run times when the poller has them

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Document it, verify end to end, and check the free-tier budget

**Files:**
- Modify: `docs/architecture.md` (new section after "Live train positions"; cost-model rows)
- Modify: `README.md` (one sentence, only if the live-trains sentence needs it)

- [ ] **Step 1: Add the architecture section**

After the "Live train positions" section in `docs/architecture.md`, add:

```markdown
## Measured timings (`cloudflare/poller/src/observations.ts`, `timing-store.ts`, `lib/timings.ts`)

The train layer's stop and running times start as the OTP timetable's (a published schedule, not measured). The poller improves on them by watching the real feed: a `StopObserver` reads each poll's *raw* readings, and a train that stays listed past its predicted arrival until it pulls out gives a stop time (predicted arrival to the middle of the gap in which it vanished); two adjacent stops of the same train give a running time. Observations go into per-station and per-hop 5-second histograms in the Durable Object's SQLite storage (one upserted row per observation). Once an hour a rollup publishes `timings.json` to R2 (`s-maxage=3600`, same CDN path as `arrivals.json`) with the median and sample count of every key that has at least 30 samples. The browser fetches it once per visit; `estimateTrains` uses a measured figure when present and the timetable's otherwise.

- **Honest.** A figure is only published, and only used, with at least 30 samples. A train that drops off a platform list while still minutes away is a list cut short, not a departure, and is ignored. Resolution is the poll cadence (about 20 s per station), so a median is good to roughly 10 s.
- **No user cost.** It is one background writer; riders only read the cached file. Writes are one row per observation and 24 R2 writes a day.
- **Not yet split by time of day.** Peak and off-peak stops differ; the histograms pool all hours.
```

In the Cost model table, add rows (fill the "Usage" column from Step 3 below, not from a guess):

```markdown
| R2 writes for `timings.json` | 24 | (Class A free allowance) | negligible |
| Durable Object SQLite rows written (timing histograms) | _measured, see Step 3_ | _check Cloudflare's current docs_ | _computed_ |
```

- [ ] **Step 2: Run every gate**

```bash
npm run lint && npm run typecheck && npm test
cd cloudflare/poller && npm run typecheck && npm test && npm run smoke && cd ..
```

Then the full end-to-end suite (stop any local `npm start` first - the suite rebuilds `out/`; use `--workers=3`):

```bash
npm run test:e2e -- --workers=3
```

Expected: everything green. If anything fails, fix the cause; do not commit or merge with a failing test.

- [ ] **Step 3: Measure the write budget against reality (after deploying)**

After this is deployed and the poller has run for a day, read the hourly `timings published` log lines (`rowsWrittenSinceStart`) in the Worker's observability logs and sum a day's rows. Put the measured number, and the Cloudflare docs' current free-tier row limit with its URL, into the cost-model row from Step 1. If the daily total exceeds 50 % of the limit, stop and raise it with the user before building the reports plan on the same free tier.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md README.md
git commit -m "docs: measured timings and their cost

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (spec section 1 and "Rule change"; later parts are the second plan):**
- Rule change → Task 1.
- Poller detects arrivals/departures → Tasks 2 (validate the premise), 5.
- Store events, roll up into `timings.json` on R2 → Tasks 4, 6.
- App uses measured once enough samples, else schedule; values labelled → Tasks 4, 7 (provenance is "present in `timings.json` means measured"; the document only ever contains measured keys).
- "To verify before building": feed semantics → Task 2; D1/DO row limits → Task 8 Step 3 (counter in Task 6). The D1, subdomain/CSP and Turnstile items belong to the reports plan.
- Reports Worker, tap UI, summary badge, analysis script, privacy note → **`2026-11-05-rider-reports.md`** (not in this plan by design).

**Placeholder scan:** the only deliberately open values are the cost-model row's measured usage and the free-tier limit, which Task 8 Step 3 fills from real data and Cloudflare's current docs; Task 3 Step 1 has an explicit either/or on the import path with the check that decides it.

**Type consistency:** `TrainLine`/`SEQUENCE`/`lineOf` (Task 3) are what Tasks 5 and 7 import. `Observation { stops, runs }` (Task 5) is what `TimingStore.record` takes (Task 6). `dwellKey(line, station)` and `runKey(line, a, b)` (Task 4) are used by the store (Task 6) and the estimator (Task 7) with the same argument order; `hopKey` order matches `data/hop-times.json` (`"N10|N9"`). `MIN_SAMPLES` is the single threshold used by the store and the client. `estimateTrains`'s third parameter is optional so existing callers and tests are unchanged.
