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
