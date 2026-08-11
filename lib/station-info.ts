import {
  getStations,
  getFacilities,
  getExits,
  getTimetables,
  getLines,
} from "@/lib/data";
import { btsSchematic } from "@/lib/bts";

/**
 * The static half of a station panel: everything that isn't live arrivals.
 *
 * Built server-side and keyed by station code, because shipping the raw files
 * would mean sending stations.json (48KB) and facilities.json (40KB) to every
 * visitor to display at most one station's worth of it. Only fields the panel
 * actually renders are projected, and absent data is omitted rather than sent
 * as nulls — most stations have no facilities record at all.
 */
export interface StationInfo {
  nameEn: string;
  nameTh: string;
  lineNames: string[];
  /** Present only where we hold a facilities record. */
  access?: {
    stepFree: boolean;
    elevators: number;
    escalators: number;
    toilets: boolean;
    babyChanging: boolean;
  };
  exits?: { number: string; landmarksEn: string[]; landmarksTh: string[]; stepFree: boolean }[];
  firstTrain?: string;
  lastTrain?: string;
}

export type StationInfoMap = Record<string, StationInfo>;

export async function getStationInfoByCode(): Promise<StationInfoMap> {
  const [stations, facilities, exits, timetables, lines] = await Promise.all([
    getStations(),
    getFacilities(),
    getExits(),
    getTimetables(),
    getLines(),
  ]);

  const stationByCode = new Map(stations.flatMap((s) => s.codes.map((c) => [c, s] as const)));
  const facilityById = new Map(facilities.map((f) => [f.stationId, f]));
  const exitsById = new Map(exits.map((e) => [e.stationId, e]));
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const out: StationInfoMap = {};

  for (const line of btsSchematic.lines) {
    for (const schematicStation of line.stations) {
      if (out[schematicStation.code]) continue;

      const station = stationByCode.get(schematicStation.code);
      const info: StationInfo = {
        // The schematic carries the operator's own spellings, so prefer them and
        // fall back to canonical data only for stations not on the BTS map.
        nameEn: schematicStation.nameEn || station?.nameEn || schematicStation.code,
        nameTh: schematicStation.nameTh || station?.nameTh || "",
        lineNames: (station?.lineIds ?? [])
          .map((id) => lineById.get(id)?.nameEn)
          .filter((n): n is string => Boolean(n)),
      };

      const facility = station ? facilityById.get(station.id) : undefined;
      if (facility) {
        info.access = {
          stepFree: facility.disabledAccess,
          elevators: facility.elevators,
          escalators: facility.escalators,
          toilets: facility.toilets,
          babyChanging: facility.babyChanging,
        };
      }

      const exit = station ? exitsById.get(station.id) : undefined;
      if (exit?.exits.length) {
        info.exits = exit.exits.map((e) => ({
          number: e.number,
          landmarksEn: e.landmarksEn,
          landmarksTh: e.landmarksTh,
          stepFree: e.hasElevator,
        }));
      }

      // Timetables are per line and direction and list only a few reference
      // stations, so take the widest span across this station's lines.
      //
      // First and last are collected separately and never sorted together: the
      // last train leaves after midnight (00:15), so a plain lexical sort ranks
      // it *before* the 05:15 first train and the range renders backwards. Late
      // times are pushed past midnight before being compared.
      const forStation = station
        ? timetables.filter((tt) => station.lineIds.includes(tt.lineId))
        : [];
      const firsts = forStation
        .map((tt) => tt.firstTrain.find((f) => f.stationId === station!.id)?.time)
        .filter((t): t is string => Boolean(t));
      const lasts = forStation
        .map((tt) => tt.lastTrain.find((f) => f.stationId === station!.id)?.time)
        .filter((t): t is string => Boolean(t));

      const minutesOf = (time: string) => {
        const [h, m] = time.split(":").map(Number);
        return h * 60 + m;
      };
      /** Times before 03:00 belong to the small hours of the following day. */
      const asLate = (time: string) => {
        const mins = minutesOf(time);
        return mins < 3 * 60 ? mins + 24 * 60 : mins;
      };

      if (firsts.length) {
        info.firstTrain = firsts.reduce((a, b) => (minutesOf(a) <= minutesOf(b) ? a : b));
      }
      if (lasts.length) {
        info.lastTrain = lasts.reduce((a, b) => (asLate(a) >= asLate(b) ? a : b));
      }

      out[schematicStation.code] = info;
    }
  }

  return out;
}
