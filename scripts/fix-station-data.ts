/**
 * One-off repair of data/canonical/stations.json and lines.json.
 *
 * Run with `npx tsx scripts/fix-station-data.ts`; the repaired files are committed
 * and `npm run validate-data` then keeps them repaired. Idempotent — running it
 * again on fixed data changes nothing.
 *
 * What was wrong:
 *
 *  - 35 stations had `codes: []`, including all 14 of the Sukhumvit northern
 *    extension. Live arrivals are keyed by code, so those stations could never
 *    show a train. The BTS ones are recovered by name from the schematic, which
 *    carries the operator's own codes.
 *  - Four stations existed twice, once per system, so an interchange rendered as
 *    two dots and lost half its lines.
 *  - `E2`, `BL11` and `PP16` were each assigned to two different stations.
 *  - `lines.stationIds` disagreed with `station.lineIds`.
 */
import { promises as fs } from "fs";
import path from "path";
import type { Line, Station, BtsSchematic } from "@/data/schemas";

const dir = path.join(process.cwd(), "data", "canonical");

/**
 * Same physical interchange split across two records. `into` absorbs `from`:
 * codes and lineIds are unioned, and references elsewhere are repointed.
 * Bang Son is deliberately absent — its MRT and SRT halves are ~500m apart,
 * which is a genuine walk between two stations rather than one complex.
 */
const MERGES: { from: string; into: string; reason: string }[] = [
  { from: "bts-pleonchit", into: "bts-phloen-chit", reason: "same station, romanised twice" },
  { from: "bts-krung-thon-buri-gold", into: "bts-krung-thon-buri", reason: "S7/G1 interchange" },
  { from: "arl-phaya-thai", into: "bts-phaya-thai", reason: "N2/A8 interchange" },
  { from: "srt-bang-sue", into: "mrt-bang-sue", reason: "Bang Sue Grand Station complex" },
];

/**
 * Codes held by a station that does not own them, dropped rather than corrected.
 *
 * Bang Sue is BL11 and Tao Poon is PP16, so these two are simply wrong. The
 * obvious repair — shifting each to the next number — does not work: BL12 and
 * PP15 are themselves occupied by stations that are also numbered one too low,
 * and the underlying MRT data is too damaged to renumber from (duplicate station
 * records for Nonthaburi Civic Center and Bang Son, a Thai string in an English
 * name field, a Purple-line code on a Blue-line station, and a scrambled roster).
 *
 * Assigning a number we cannot source would be inventing transit data, so these
 * are left uncoded alongside the other MRT stations that have no code yet. The
 * MRT network needs a proper import before its codes can be trusted; nothing in
 * the route map depends on them, since live arrivals are BTS-only.
 */
const DROP_CODES: Record<string, string> = {
  "mrt-kamphaeng-phet": "BL11",
  "mrt-bang-son": "PP16",
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as T;
}

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const stations = await readJson<Station[]>("stations.json");
  const lines = await readJson<Line[]>("lines.json");
  const schematic = await readJson<BtsSchematic>("bts-schematic.json");

  const byId = new Map(stations.map((s) => [s.id, s]));
  const changes: string[] = [];

  // 1. Release the codes held by the wrong station, before anything keys on them.
  for (const [id, wrong] of Object.entries(DROP_CODES)) {
    const station = byId.get(id);
    if (!station || !station.codes.includes(wrong)) continue;
    station.codes = station.codes.filter((c) => c !== wrong);
    changes.push(`drop ${id}: ${wrong} (belongs to another station)`);
  }

  // 2. Fold duplicate records together.
  const removed = new Set<string>();
  for (const { from, into, reason } of MERGES) {
    const src = byId.get(from);
    const dst = byId.get(into);
    if (!src || !dst) continue;
    dst.codes = [...new Set([...dst.codes, ...src.codes])];
    dst.lineIds = [...new Set([...dst.lineIds, ...src.lineIds])];
    removed.add(from);
    changes.push(`merge ${from} -> ${into} (${reason})`);
  }

  let merged = stations.filter((s) => !removed.has(s.id));

  // 3. Recover missing BTS codes by name. The schematic carries the operator's
  //    own codes, so this restores them from an authoritative source rather
  //    than inventing anything.
  const codeByName = new Map<string, string>();
  for (const line of schematic.lines) {
    for (const st of line.stations) {
      if (st.hasLiveArrivals) codeByName.set(normalize(st.nameEn), st.code);
    }
  }

  const taken = new Set(merged.flatMap((s) => s.codes));
  for (const station of merged) {
    if (station.codes.length > 0) continue;
    const code = codeByName.get(normalize(station.nameEn));
    if (!code || taken.has(code)) continue;
    station.codes = [code];
    taken.add(code);
    changes.push(`code ${station.id}: ${code}`);
  }

  // 4. An interchange is just a station on more than one line. Deriving it
  //    keeps the flag true by construction instead of hand-maintained.
  for (const station of merged) {
    const isInterchange = station.lineIds.length > 1;
    if (station.isInterchange !== isInterchange) {
      station.isInterchange = isInterchange;
    }
  }

  merged = merged.map((s) => ({ ...s, isInterchange: s.lineIds.length > 1 }));

  // 5. Make each line's roster agree with the stations that claim it, keeping
  //    the line's existing order and appending anything it had missed.
  const liveIds = new Set(merged.map((s) => s.id));
  for (const line of lines) {
    const claimed = merged.filter((s) => s.lineIds.includes(line.id)).map((s) => s.id);
    const claimedSet = new Set(claimed);
    const kept = line.stationIds.filter((id) => liveIds.has(id) && claimedSet.has(id));
    const added = claimed.filter((id) => !kept.includes(id));
    const next = [...kept, ...added];
    if (next.length !== line.stationIds.length || next.some((id, i) => id !== line.stationIds[i])) {
      changes.push(`line ${line.id}: ${line.stationIds.length} -> ${next.length} stations`);
      line.stationIds = next;
    }
  }

  // 6. Repoint every reference to a station that was merged away. These ids appear
  //    across facilities, exits, parking, places, alerts and bus routes under
  //    several different key names, so rewrite by value rather than by field.
  const redirect = new Map(MERGES.map((m) => [m.from, m.into]));
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") return redirect.get(value) ?? value;
    if (Array.isArray(value)) return [...new Set(value.map(rewrite) as unknown[])];
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
    }
    return value;
  };

  // Merging can leave two records describing the same station; keep the first.
  const dedupeByStation = (rows: { stationId?: string }[]) => {
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (!row.stationId || seen.has(row.stationId)) return Boolean(!row.stationId);
      seen.add(row.stationId);
      return true;
    });
  };

  for (const file of ["facilities.json", "exits.json", "parking.json"]) {
    const rows = rewrite(await readJson<{ stationId?: string }[]>(file)) as { stationId?: string }[];
    const deduped = dedupeByStation(rows);
    if (deduped.length !== rows.length) changes.push(`${file}: dropped ${rows.length - deduped.length} duplicate rows`);
    await writeJson(file, deduped);
  }

  for (const file of ["places.json", "alerts.json", "bus_routes.json", "boat_routes.json"]) {
    await writeJson(file, rewrite(await readJson<unknown>(file)));
  }

  await writeJson("stations.json", merged);
  await writeJson("lines.json", lines);

  console.log(changes.length ? changes.map((c) => `  ${c}`).join("\n") : "  no changes");
  console.log(`\n${merged.length} stations, ${merged.filter((s) => s.codes.length).length} with codes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
