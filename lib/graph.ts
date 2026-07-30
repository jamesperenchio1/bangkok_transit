import type { Station, Line, BoatRoute, BusRoute } from "@/data/schemas";
import { haversine } from "@/lib/geo";

export interface GraphNode {
  id: string;
  type: "station" | "pier" | "bus_stop";
  nameEn: string;
  nameTh: string;
  lat: number;
  lng: number;
  lineIds?: string[];
  routeId?: string;
  connectedStationIds?: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  mode: "rail" | "walk" | "boat" | "bus";
  lineId?: string;
  routeId?: string;
  distance: number;
  timeSeconds: number;
  fare: number;
}

export function buildGraph(
  stations: Station[],
  lines: Line[],
  boatRoutes: BoatRoute[],
  busRoutes: BusRoute[]
) {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const station of stations) {
    nodes.set(station.id, {
      id: station.id,
      type: "station",
      nameEn: station.nameEn,
      nameTh: station.nameTh,
      lat: station.lat,
      lng: station.lng,
      lineIds: station.lineIds,
    });
  }

  const lineMap = new Map(lines.map((l) => [l.id, l]));
  const stationMap = new Map(stations.map((s) => [s.id, s]));

  // Rail edges from line station ordering
  for (const line of lines) {
    if (line.stationIds.length < 2) continue;
    const speedKmh =
      line.mode === "arl" ? 80 : line.mode === "srt" ? 70 : line.mode === "mrt" ? 50 : 45;

    for (let i = 0; i < line.stationIds.length - 1; i++) {
      const fromId = line.stationIds[i];
      const toId = line.stationIds[i + 1];
      const from = stationMap.get(fromId);
      const to = stationMap.get(toId);
      if (!from || !to) continue;

      const dist = haversine(from.lat, from.lng, to.lat, to.lng);
      const timeSeconds = (dist / 1000 / speedKmh) * 3600 + 60;

      edges.push({
        from: fromId,
        to: toId,
        mode: "rail",
        lineId: line.id,
        distance: dist,
        timeSeconds,
        fare: 0,
      });
      edges.push({
        from: toId,
        to: fromId,
        mode: "rail",
        lineId: line.id,
        distance: dist,
        timeSeconds,
        fare: 0,
      });
    }
  }

  // Boat piers
  for (const route of boatRoutes) {
    for (let i = 0; i < route.piers.length; i++) {
      const pier = route.piers[i];
      const pierId = `pier-${route.id}-${i}`;
      nodes.set(pierId, {
        id: pierId,
        type: "pier",
        nameEn: pier.nameEn,
        nameTh: pier.nameTh,
        lat: pier.lat,
        lng: pier.lng,
        routeId: route.id,
        connectedStationIds: pier.connectedStationIds,
      });

      for (const stationId of pier.connectedStationIds) {
        const station = nodes.get(stationId);
        if (!station) continue;
        const dist = haversine(pier.lat, pier.lng, station.lat, station.lng);
        edges.push({
          from: stationId,
          to: pierId,
          mode: "walk",
          distance: dist,
          timeSeconds: dist / 1.2 + 60,
          fare: 0,
        });
        edges.push({
          from: pierId,
          to: stationId,
          mode: "walk",
          distance: dist,
          timeSeconds: dist / 1.2 + 60,
          fare: 0,
        });
      }

      if (i > 0) {
        const prev = route.piers[i - 1];
        const prevId = `pier-${route.id}-${i - 1}`;
        const dist = haversine(prev.lat, prev.lng, pier.lat, pier.lng);
        edges.push({
          from: prevId,
          to: pierId,
          mode: "boat",
          routeId: route.id,
          distance: dist,
          timeSeconds: (dist / 1000 / 20) * 3600 + 120,
          fare: 15,
        });
        edges.push({
          from: pierId,
          to: prevId,
          mode: "boat",
          routeId: route.id,
          distance: dist,
          timeSeconds: (dist / 1000 / 20) * 3600 + 120,
          fare: 15,
        });
      }
    }
  }

  // Bus stops
  for (const route of busRoutes) {
    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i];
      const stopId = `bus-${route.id}-${i}`;
      nodes.set(stopId, {
        id: stopId,
        type: "bus_stop",
        nameEn: stop.nameEn,
        nameTh: stop.nameTh,
        lat: stop.lat,
        lng: stop.lng,
        routeId: route.id,
        connectedStationIds: stop.connectedStationIds,
      });

      for (const stationId of stop.connectedStationIds) {
        const station = nodes.get(stationId);
        if (!station) continue;
        const dist = haversine(stop.lat, stop.lng, station.lat, station.lng);
        edges.push({
          from: stationId,
          to: stopId,
          mode: "walk",
          distance: dist,
          timeSeconds: dist / 1.2 + 60,
          fare: 0,
        });
        edges.push({
          from: stopId,
          to: stationId,
          mode: "walk",
          distance: dist,
          timeSeconds: dist / 1.2 + 60,
          fare: 0,
        });
      }

      if (i > 0) {
        const prev = route.stops[i - 1];
        const prevId = `bus-${route.id}-${i - 1}`;
        const dist = haversine(prev.lat, prev.lng, stop.lat, stop.lng);
        edges.push({
          from: prevId,
          to: stopId,
          mode: "bus",
          routeId: route.id,
          distance: dist,
          timeSeconds: (dist / 1000 / 25) * 3600 + 60,
          fare: 8,
        });
        edges.push({
          from: stopId,
          to: prevId,
          mode: "bus",
          routeId: route.id,
          distance: dist,
          timeSeconds: (dist / 1000 / 25) * 3600 + 60,
          fare: 8,
        });
      }
    }
  }

  return { nodes, edges, lineMap };
}
