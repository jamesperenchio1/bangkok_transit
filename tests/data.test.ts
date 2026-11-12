import { describe, expect, it } from "vitest";
import { liveStations, stations, stationsByCode, type LineKey } from "@/data/stations";
import lineSequences from "@/data/line-sequences.json";
import interchanges from "@/data/interchanges.json";
import hopTimes from "@/data/hop-times.json";
import { haversineMeters } from "@/lib/line-geometry";
import { LINE_COLORS } from "@/lib/line-colors";

/**
 * The station data and line sequences are hand-maintained and the routing
 * graph trusts them completely, so these invariants are what stands between
 * a typo and a wrong route.
 */

const sequences = lineSequences as Record<LineKey, string[][]>;
const meters = (a: string, b: string) => {
  const sa = stationsByCode.get(a)!;
  const sb = stationsByCode.get(b)!;
  return haversineMeters([sa.lat, sa.lon], [sb.lat, sb.lon]);
};
const shareLine = (a: string, b: string) =>
  stationsByCode.get(a)!.lines.some((la) => stationsByCode.get(b)!.lines.some((lb) => la.line === lb.line));

// Real hops longer than 4 km: the Airport Rail Link and SRT Red Line run
// long stretches between stations. Anything else that long is a data error.
const LONG_HOPS = new Set([
  "A03-A04", "A04-A05", "A05-A06", "A06-A07",
  "RD01-RD02", "RD02-RD03", "RD04-RD01", "RD11-RD12",
]);

describe("stations", () => {
  it("has unique codes", () => {
    expect(new Set(stations.map((s) => s.code)).size).toBe(stations.length);
  });

  it("has real coordinates inside Greater Bangkok", () => {
    for (const s of stations) {
      expect(s.lat, s.code).toBeGreaterThan(13.4);
      expect(s.lat, s.code).toBeLessThan(14.2);
      expect(s.lon, s.code).toBeGreaterThan(100.2);
      expect(s.lon, s.code).toBeLessThan(100.9);
    }
  });

  it("has an English and a Thai name, each in its own script", () => {
    for (const s of stations) {
      expect(s.nameEn, s.code).toMatch(/^[\x20-\x7e]+$/);
      expect(s.nameTh, s.code).toMatch(/[฀-๿]/);
    }
  });

  it("marks exactly the 60 BTS Sukhumvit/Silom stations as live", () => {
    expect(liveStations).toHaveLength(60);
    for (const s of liveStations) {
      expect(s.lines.every((l) => l.line === "sukhumvit" || l.line === "silom"), s.code).toBe(true);
    }
  });

  it("does not list N6 Sena Ruam, a BTS station that was planned and never built", () => {
    // The upstream API still serves arrivals for it, and the old BTS numbering
    // skips it (N5 is followed by N7). Listing it drew a station that does not
    // exist and put a phantom stop in every Sukhumvit route.
    expect(stationsByCode.has("N6")).toBe(false);
    expect(sequences.sukhumvit.some((seg) => seg.some((_, i) => seg[i] === "N7" && (seg[i + 1] === "N5" || seg[i - 1] === "N5")))).toBe(true);
  });

  it("only uses lines that have a brand color", () => {
    for (const s of stations) for (const l of s.lines) expect(LINE_COLORS[l.line], s.code).toBeDefined();
  });
});

describe("line sequences", () => {
  it("only references existing stations, on the line they claim", () => {
    for (const [line, segments] of Object.entries(sequences) as [LineKey, string[][]][]) {
      for (const code of segments.flat()) {
        const s = stationsByCode.get(code);
        expect(s, `${line}: ${code}`).toBeDefined();
        expect(s!.lines.map((l) => l.line), `${line}: ${code}`).toContain(line);
      }
    }
  });

  it("puts every station on every line it serves", () => {
    for (const s of stations) {
      for (const { line } of s.lines) {
        expect(sequences[line].flat(), `${s.code} on ${line}`).toContain(s.code);
      }
    }
  });

  it("connects each line's segments into one piece", () => {
    for (const [line, segments] of Object.entries(sequences)) {
      const [first, ...rest] = segments;
      const seen = new Set(first);
      for (const segment of rest) {
        expect(segment.some((c) => seen.has(c)), `${line} branch ${segment[0]}`).toBe(true);
        segment.forEach((c) => seen.add(c));
      }
    }
  });

  it("has no implausibly long hop between adjacent stops", () => {
    for (const [line, segments] of Object.entries(sequences)) {
      for (const segment of segments) {
        for (let i = 0; i < segment.length - 1; i++) {
          const hop = `${segment[i]}-${segment[i + 1]}`;
          const reverse = `${segment[i + 1]}-${segment[i]}`;
          const limit = LONG_HOPS.has(hop) || LONG_HOPS.has(reverse) ? 12_000 : 4_000;
          expect(meters(segment[i], segment[i + 1]), `${line} ${hop}`).toBeLessThan(limit);
        }
      }
    }
  });
});

describe("interchanges", () => {
  it("joins distinct stations on different lines within a short walk", () => {
    for (const { a, b } of interchanges) {
      expect(stationsByCode.has(a), a).toBe(true);
      expect(stationsByCode.has(b), b).toBe(true);
      expect(shareLine(a, b), `${a}-${b}`).toBe(false);
      expect(meters(a, b), `${a}-${b}`).toBeLessThan(600);
    }
  });

  it("doesn't miss any station pair close enough to obviously be one", () => {
    const listed = new Set(interchanges.flatMap(({ a, b }) => [`${a}-${b}`, `${b}-${a}`]));
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        const [a, b] = [stations[i].code, stations[j].code];
        if (shareLine(a, b) || meters(a, b) > 300) continue;
        expect(listed.has(`${a}-${b}`), `${a}-${b} is ${Math.round(meters(a, b))} m apart`).toBe(true);
      }
    }
  });
});

describe("station positions agree with independent sources", () => {
  // Stations whose position was checked against the official Namtang GTFS feed
  // and Wikipedia, which agree with each other. PP06 was 474 m out (it sat 747 m
  // from Sai Ma and 1,665 m from Bang Rak Yai instead of ~1,200 m from both).
  const VERIFIED: Record<string, [number, number]> = {
    PP06: [13.874895, 100.455992], // MRT Bang Rak Noi Tha It
  };
  it("keeps verified stations within 100 m of the reference point", () => {
    for (const [code, [lat, lon]] of Object.entries(VERIFIED)) {
      const s = stationsByCode.get(code)!;
      expect(haversineMeters([s.lat, s.lon], [lat, lon]), code).toBeLessThan(100);
    }
  });
});

describe("official station codes", () => {
  // The operators' own codes (Wikipedia station lists for MRT Blue, the Airport
  // Rail Link and the SRT Red lines; EBM's Yellow Line page gives Lat Phrao as
  // BL15). The ids in stations.json are NOT these and must not change (they
  // are in shared links and page URLs); `displayCode` is what riders see.
  const OFFICIAL: Record<string, string> = {
    "Tha Phra": "BL01", "Charan Sanitwong 13": "BL02", "Fai Chai": "BL03", "Bang Khun Non": "BL04",
    "Bang Yi Khan": "BL05", Sirindhorn: "BL06", "Bang Phlat": "BL07", "Bang O": "BL08", "Bang Pho": "BL09",
    "Tao Poon": "BL10 / PP16", "Bang Sue": "BL11", "Kamphaeng Phet": "BL12", "Chatuchak Park": "BL13",
    "Phahon Yothin": "BL14", "Lat Phrao": "BL15", Ratchadaphisek: "BL16", Sutthisan: "BL17",
    "Huai Khwang": "BL18", "Thailand Cultural Centre": "BL19", "Phra Ram 9": "BL20", Phetchaburi: "BL21",
    Sukhumvit: "BL22", "Queen Sirikit National Convention Centre": "BL23", "Khlong Toei": "BL24",
    Lumphini: "BL25", "Si Lom": "BL26", "Sam Yan": "BL27", "Hua Lamphong": "BL28", "Wat Mangkon": "BL29",
    "Sam Yot": "BL30", "Sanam Chai": "BL31", Itsaraphap: "BL32", "Bang Phai": "BL33", "Bang Wa": "BL34",
    "Phetkasem 48": "BL35", "Phasi Charoen": "BL36", "Bang Khae": "BL37", "Lak Song": "BL38",
    Suvarnabhumi: "A1", "Lat Krabang": "A2", "Ban Thap Chang": "A3", "Hua Mak": "A4", Ramkhamhaeng: "A5",
    Makkasan: "A6", Ratchaprarop: "A7", "Phaya Thai": "A8",
    "Krung Thep Aphiwat (Bang Sue Grand)": "RN01 / RW01", Chatuchak: "RN02", "Wat Samian Nari": "RN03",
    "Bang Khen": "RN04", "Thung Song Hong": "RN05", "Lak Si": "RN06", "Kan Kheha": "RN07", "Don Mueang": "RN08",
    "Lak Hok": "RN09", Rangsit: "RN10", "Bang Son": "RW02", "Bang Bamru": "RW05", "Taling Chan": "RW06",
  };
  const OPERATOR_LINES = new Set<LineKey>(["blue", "arl", "srtDarkRed", "srtLightRed"]);

  it("shows the operator's code for every Blue, ARL and SRT Red station", () => {
    const seen = new Set<string>();
    for (const s of stations.filter((x) => x.lines.some((l) => OPERATOR_LINES.has(l.line)))) {
      // Bang Son and Lak Si also exist as Purple / Pink stations under other names' codes; match by line.
      const onOperatorLine = s.lines.every((l) => OPERATOR_LINES.has(l.line)) || s.code === "BL31";
      if (!onOperatorLine) continue;
      expect(OFFICIAL[s.nameEn], `${s.code} ${s.nameEn} is not in the official list`).toBeDefined();
      expect(s.displayCode, `${s.code} ${s.nameEn}`).toBe(OFFICIAL[s.nameEn]);
      seen.add(s.nameEn);
    }
    expect([...seen].sort()).toEqual(Object.keys(OFFICIAL).sort());
  });

  it("never reuses a displayed code on two stations of one operator", () => {
    const owner = new Map<string, string>();
    for (const s of stations) {
      for (const code of (s.displayCode ?? s.code).split("/").map((c) => c.trim())) {
        expect(owner.has(code), `${code}: ${owner.get(code)} and ${s.code}`).toBe(false);
        owner.set(code, s.code);
      }
    }
  });

  it("keeps the ids stable: Tha Phra is still BL07 internally", () => {
    expect(stationsByCode.get("BL07")!.nameEn).toBe("Tha Phra");
    expect(stationsByCode.get("BL07")!.displayCode).toBe("BL01");
  });

  it("spells Si Iam with a capital i, not a lowercase L", () => {
    expect(stationsByCode.get("YL17")!.nameEn).toBe("Si Iam");
  });
});

describe("hop times", () => {
  const tables = hopTimes.lines as Record<string, { dwell: number; hops: Record<string, number> }>;
  const hopKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const adjacent = (line: LineKey) =>
    new Set(sequences[line].flatMap((seg) => seg.slice(0, -1).map((c, i) => hopKey(c, seg[i + 1]))));

  // Yellow and Pink are placeholders in the feed (uniform times); they must
  // stay on the distance formula.
  const SCHEDULED: LineKey[] = ["sukhumvit", "silom", "gold", "blue", "purple", "arl", "srtDarkRed", "srtLightRed"];

  it("only covers lines with trustworthy feed times", () => {
    expect(Object.keys(tables).sort()).toEqual([...SCHEDULED].sort());
  });

  it("names only hops that are adjacent in line-sequences.json", () => {
    for (const [line, table] of Object.entries(tables)) {
      const valid = adjacent(line as LineKey);
      for (const key of Object.keys(table.hops)) expect(valid.has(key), `${line} ${key}`).toBe(true);
    }
  });

  it("has a time for every hop of the lines it covers", () => {
    for (const line of SCHEDULED) {
      for (const key of adjacent(line)) {
        expect(tables[line].hops[key], `${line} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("has plausible running and stop times", () => {
    for (const [line, table] of Object.entries(tables)) {
      expect(table.dwell, line).toBeGreaterThanOrEqual(0.25);
      expect(table.dwell, line).toBeLessThanOrEqual(2);
      for (const [key, minutes] of Object.entries(table.hops)) {
        expect(minutes, `${line} ${key}`).toBeGreaterThanOrEqual(0.5);
        expect(minutes, `${line} ${key}`).toBeLessThanOrEqual(8); // Light Red Bang Son - Bang Bamru is 7
      }
    }
  });
});
