// Synthetic arrivals documents for the Cloudflare-poller CDN shape:
//   { arrivals: { CODE: Arrivals }, complete: boolean }
// The live client reads ARRIVALS_URL cross-origin and learns server time from
// the response `Date` + `Age` headers, so the harness supplies those on fulfill.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIONS = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../data/stations.json"), "utf8"),
);

export const stations = STATIONS;
export const liveCodes = STATIONS.filter((s) => s.hasLiveArrivals).map((s) => s.code);
export const byCode = new Map(STATIONS.map((s) => [s.code, s]));

// Two notional line ends per line, used to fabricate platform direction_keys.
const LINE_ENDS = {
  sukhumvit: ["N24", "E23"],
  silom: ["W1", "S12"],
  gold: ["G1", "G3"],
  yellow: ["YL01", "YL23"],
  pink: ["PK01", "PK30"],
  blue: ["BL01", "BL38"],
  purple: ["PP01", "PP16"],
  arl: ["A01", "A08"],
  srtRed: ["RD01", "RD13"],
};

function naiveUtc(ms) {
  // Upstream emits naive UTC (no trailing Z). Reproduce that exactly.
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "");
}

function trains(direction) {
  const base = direction === 0 ? 1 : 2;
  return [0, 1, 2].map((i) => ({
    train_no: `${100 + i}`,
    destination: direction === 0 ? "Terminus A" : "Terminus B",
    destination_key: direction === 0 ? "endA" : "endB",
    eta_minutes: base + i * 3,
    // Minutes, not a clock time: the app multiplies the ETA by 60_000 to get
    // milliseconds (lib/format-eta.ts), so a timestamp string here would be
    // NaN and blank the station card.
    eta_precise: base + i * 3 + 0.5,
    status: i === 0 ? "approaching" : "on_time",
  }));
}

export function makeArrival(code, opts = {}) {
  const {
    ageMs = 0,
    serviceActive = true,
    nextService = "05:30",
    emptyPlatforms = false,
    lineEnds,
  } = opts;
  const st = byCode.get(code);
  if (!st) throw new Error(`unknown station code ${code}`);
  const line = st.lines[0]?.line ?? "sukhumvit";
  const ends = lineEnds || LINE_ENDS[line] || LINE_ENDS.sukhumvit;
  const ts = naiveUtc(Date.now() - ageMs);

  const platforms = emptyPlatforms
    ? []
    : [0, 1].map((d) => ({
        platform: d === 0 ? "1" : "2",
        line_color: st.lines[0]?.color ?? "#76b729",
        line_id: line,
        direction: d === 0 ? `${ends[0]}  |  Outbound` : `${ends[1]}  |  Inbound`,
        direction_key: ends[d],
        trains: trains(d),
      }));

  return {
    station: { code, name_en: st.nameEn, name_th: st.nameTh, line_color: st.lines[0]?.color ?? "#76b729" },
    platforms,
    near_end_of_service: false,
    service_active: serviceActive,
    next_service: nextService,
    server_time: ts,
    timestamp: ts,
  };
}

export function makeDoc({ codes = liveCodes, complete = true, ...opts } = {}) {
  const arrivals = {};
  for (const code of codes) arrivals[code] = makeArrival(code, opts);
  return { arrivals, complete };
}

// Named fixture modes used by scenarios. Each returns a doc + whether it is
// "complete" so the fast-poll path can be exercised.
export const modes = {
  // fully fresh, all stations, complete
  normal: () => ({ doc: makeDoc({ complete: true }), complete: true }),

  // partial payload -> client should fast-poll (2s) until complete or 15 tries
  partial: (fraction = 0.5) => {
    const codes = liveCodes.slice(0, Math.max(1, Math.floor(liveCodes.length * fraction)));
    return { doc: makeDoc({ codes, complete: false }), complete: false };
  },

  // data present but stale (older than FRESH_FOR_MS=90s, younger than drop 30m)
  stale: (ageMs = 5 * 60_000) => ({ doc: makeDoc({ ageMs, complete: true }), complete: true }),

  // service not running -> StationEta shows "Not running — next ~HH:MM"
  notRunning: (next = "05:30") => ({
    doc: makeDoc({ serviceActive: false, nextService: next, complete: true }),
    complete: true,
  }),

  // service on, zero platforms -> "No live arrivals right now"
  empty: () => ({ doc: makeDoc({ emptyPlatforms: true, complete: true }), complete: true }),

  // empty object with complete:true -> stations have no data at all
  none: () => ({ doc: { arrivals: {}, complete: true }, complete: true }),
};

export function docFor(mode, arg) {
  if (typeof mode === "function") return mode(arg);
  if (modes[mode]) return modes[mode](arg);
  return modes.normal();
}
