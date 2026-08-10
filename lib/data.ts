import { promises as fs } from "fs";
import path from "path";
import {
  Operator,
  Line,
  Station,
  Exit,
  Facility,
  Timetable,
  Fare,
  Parking,
  Place,
  Alert,
  BoatRoute,
  BusRoute,
  LineGeometry,
} from "@/data/schemas";

const dataDir = path.join(process.cwd(), "data", "canonical");

async function readJson<T>(file: string): Promise<T> {
  const filePath = path.join(dataDir, file);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function getOperators(): Promise<Operator[]> {
  return readJson<Operator[]>("operators.json");
}

export async function getLines(): Promise<Line[]> {
  return readJson<Line[]>("lines.json");
}

export async function getStations(): Promise<Station[]> {
  return readJson<Station[]>("stations.json");
}

export async function getExits(): Promise<Exit[]> {
  return readJson<Exit[]>("exits.json");
}

export async function getFacilities(): Promise<Facility[]> {
  return readJson<Facility[]>("facilities.json");
}

export async function getTimetables(): Promise<Timetable[]> {
  return readJson<Timetable[]>("timetables.json");
}

export async function getFares(): Promise<Fare[]> {
  return readJson<Fare[]>("fares.json");
}

export async function getParking(): Promise<Parking[]> {
  return readJson<Parking[]>("parking.json");
}

export async function getPlaces(): Promise<Place[]> {
  return readJson<Place[]>("places.json");
}

export async function getAlerts(): Promise<Alert[]> {
  return readJson<Alert[]>("alerts.json");
}

export async function getBoatRoutes(): Promise<BoatRoute[]> {
  return readJson<BoatRoute[]>("boat_routes.json");
}

export async function getBusRoutes(): Promise<BusRoute[]> {
  return readJson<BusRoute[]>("bus_routes.json");
}

export async function getLineGeometry(): Promise<LineGeometry> {
  try {
    return await readJson<LineGeometry>("line_geometry.json");
  } catch {
    // Not scraped yet — map falls back to straight station-to-station lines.
    return {};
  }
}

export async function getAllData() {
  const [
    operators,
    lines,
    stations,
    exits,
    facilities,
    timetables,
    fares,
    parking,
    places,
    alerts,
    boatRoutes,
    busRoutes,
    lineGeometry,
  ] = await Promise.all([
    getOperators(),
    getLines(),
    getStations(),
    getExits(),
    getFacilities(),
    getTimetables(),
    getFares(),
    getParking(),
    getPlaces(),
    getAlerts(),
    getBoatRoutes(),
    getBusRoutes(),
    getLineGeometry(),
  ]);

  return {
    operators,
    lines,
    stations,
    exits,
    facilities,
    timetables,
    fares,
    parking,
    places,
    alerts,
    boatRoutes,
    busRoutes,
    lineGeometry,
  };
}

export function getStationById(stations: Station[], id: string): Station | undefined {
  return stations.find((s) => s.id === id);
}

export function getLineById(lines: Line[], id: string): Line | undefined {
  return lines.find((l) => l.id === id);
}

export function getExitsByStationId(exits: Exit[], stationId: string): Exit | undefined {
  return exits.find((e) => e.stationId === stationId);
}

export function getFacilityByStationId(facilities: Facility[], stationId: string): Facility | undefined {
  return facilities.find((f) => f.stationId === stationId);
}

export function getParkingByStationId(parking: Parking[], stationId: string): Parking | undefined {
  return parking.find((p) => p.stationId === stationId);
}

export function getPlacesByStationId(places: Place[], stationId: string): Place[] {
  return places.filter((p) => p.nearbyStationIds.includes(stationId));
}

export function getAlertsForStation(alerts: Alert[], stationId: string): Alert[] {
  return alerts.filter((a) => a.stationIds.includes(stationId) || a.lineIds.length === 0);
}

export function getAlertsForLine(alerts: Alert[], lineId: string): Alert[] {
  return alerts.filter((a) => a.lineIds.includes(lineId));
}
