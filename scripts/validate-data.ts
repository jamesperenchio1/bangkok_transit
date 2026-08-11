import {
  OperatorSchema,
  LineSchema,
  StationSchema,
  ExitSchema,
  FacilitySchema,
  TimetableSchema,
  FareSchema,
  ParkingSchema,
  PlaceSchema,
  AlertSchema,
  BoatRouteSchema,
  BusRouteSchema,
  LineGeometrySchema,
} from "@/data/schemas";
import { getAllData } from "@/lib/data";
import { btsSchematic } from "@/lib/bts";

async function validate() {
  const data = await getAllData();
  const errors: string[] = [];

  const validateItems = <T>(name: string, items: T[], schema: { parse: (v: T) => unknown }) => {
    for (let i = 0; i < items.length; i++) {
      try {
        schema.parse(items[i]);
      } catch (e) {
        errors.push(`${name}[${i}]: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  validateItems("operators", data.operators, OperatorSchema);
  validateItems("lines", data.lines, LineSchema);
  validateItems("stations", data.stations, StationSchema);
  validateItems("exits", data.exits, ExitSchema);
  validateItems("facilities", data.facilities, FacilitySchema);
  validateItems("timetables", data.timetables, TimetableSchema);
  validateItems("fares", data.fares, FareSchema);
  validateItems("parking", data.parking, ParkingSchema);
  validateItems("places", data.places, PlaceSchema);
  validateItems("alerts", data.alerts, AlertSchema);
  validateItems("boatRoutes", data.boatRoutes, BoatRouteSchema);
  validateItems("busRoutes", data.busRoutes, BusRouteSchema);

  try {
    LineGeometrySchema.parse(data.lineGeometry);
  } catch (e) {
    errors.push(`lineGeometry: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Cross-reference checks
  const stationIds = new Set(data.stations.map((s) => s.id));
  const lineIds = new Set(data.lines.map((l) => l.id));

  for (const lineId of Object.keys(data.lineGeometry)) {
    if (!lineIds.has(lineId)) {
      errors.push(`lineGeometry references unknown line ${lineId}`);
    }
  }

  for (const station of data.stations) {
    for (const lineId of station.lineIds) {
      if (!lineIds.has(lineId)) {
        errors.push(`station ${station.id} references unknown line ${lineId}`);
      }
    }
  }

  for (const line of data.lines) {
    for (const stationId of line.stationIds) {
      if (!stationIds.has(stationId)) {
        errors.push(`line ${line.id} references unknown station ${stationId}`);
      }
    }
  }

  // A station code must identify exactly one station: live arrivals are looked up
  // by code, so a duplicate silently sends riders another station's trains. Three
  // of these were live in the data (E2, BL11, PP16) before this check existed.
  const stationsByCode = new Map<string, string[]>();
  for (const station of data.stations) {
    for (const code of station.codes) {
      stationsByCode.set(code, [...(stationsByCode.get(code) ?? []), station.id]);
    }
  }
  for (const [code, owners] of stationsByCode) {
    if (owners.length > 1) {
      errors.push(`code ${code} is claimed by ${owners.length} stations: ${owners.join(", ")}`);
    }
  }

  // Every station the live API serves must be reachable in our own data, or its
  // arrivals can never be shown. This is what regressed when 14 Sukhumvit
  // stations were left with an empty `codes` array.
  const knownCodes = new Set(data.stations.flatMap((s) => s.codes));
  const unreachable = btsSchematic.lines
    .flatMap((l) => l.stations)
    .filter((s) => s.hasLiveArrivals && !knownCodes.has(s.code));
  for (const station of unreachable) {
    errors.push(`live station ${station.code} (${station.nameEn}) has no entry in stations.json`);
  }

  // Both directions of the line/station relationship have to agree, or a station
  // shows on a line that does not list it (and drops out of routing).
  for (const line of data.lines) {
    const declared = new Set(line.stationIds);
    for (const station of data.stations) {
      const claimsLine = station.lineIds.includes(line.id);
      if (claimsLine && !declared.has(station.id)) {
        errors.push(`station ${station.id} claims line ${line.id}, which does not list it`);
      }
      if (!claimsLine && declared.has(station.id)) {
        errors.push(`line ${line.id} lists station ${station.id}, which does not claim it`);
      }
    }
  }

  // Not an error: the MRT network has no trustworthy code source yet, and
  // guessing would be worse than leaving them blank. Surfaced so the gap stays
  // visible instead of looking intentional.
  const uncoded = data.stations.filter((s) => s.codes.length === 0);
  if (uncoded.length) {
    console.warn(
      `\n${uncoded.length} stations have no code (no authoritative source; not used by live arrivals):`
    );
    console.warn(`  ${uncoded.map((s) => s.id).join(", ")}\n`);
  }

  for (const exit of data.exits) {
    if (!stationIds.has(exit.stationId)) {
      errors.push(`exit references unknown station ${exit.stationId}`);
    }
  }

  for (const facility of data.facilities) {
    if (!stationIds.has(facility.stationId)) {
      errors.push(`facility references unknown station ${facility.stationId}`);
    }
  }

  for (const parking of data.parking) {
    if (!stationIds.has(parking.stationId)) {
      errors.push(`parking references unknown station ${parking.stationId}`);
    }
  }

  for (const timetable of data.timetables) {
    if (!lineIds.has(timetable.lineId)) {
      errors.push(`timetable references unknown line ${timetable.lineId}`);
    }
  }

  if (errors.length > 0) {
    console.error("Data validation failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log("Data validation passed.");
}

validate();
