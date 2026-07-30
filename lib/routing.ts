import type { Station, Line, BoatRoute, BusRoute } from "@/data/schemas";
import { buildGraph } from "@/lib/graph";

export interface RouteSegment {
  mode: "rail" | "walk" | "boat" | "bus";
  fromId: string;
  toId: string;
  fromNameEn: string;
  fromNameTh: string;
  toNameEn: string;
  toNameTh: string;
  lineId?: string;
  routeId?: string;
  timeSeconds: number;
  distance: number;
  fare: number;
}

export interface RouteOption {
  type: "fastest" | "cheapest" | "fewestTransfers" | "accessible" | "luggage";
  totalTimeSeconds: number;
  totalFare: number;
  transfers: number;
  segments: RouteSegment[];
}

interface State {
  node: string;
  lineId?: string;
}

function computeFare(mode: string, lineId: string | undefined, distanceMeters: number): number {
  const distanceKm = distanceMeters / 1000;
  if (mode === "boat") return 15;
  if (mode === "bus") return 8;
  if (lineId?.startsWith("bts")) {
    if (distanceKm <= 1) return 17;
    if (distanceKm <= 4) return 24;
    if (distanceKm <= 8) return 30;
    if (distanceKm <= 12) return 37;
    if (distanceKm <= 16) return 42;
    return 45;
  }
  if (lineId?.startsWith("mrt")) {
    if (distanceKm <= 1) return 17;
    if (distanceKm <= 4) return 22;
    if (distanceKm <= 8) return 28;
    if (distanceKm <= 12) return 34;
    if (distanceKm <= 16) return 40;
    return 45;
  }
  if (lineId?.startsWith("arl")) {
    if (distanceKm <= 4) return 15;
    if (distanceKm <= 8) return 25;
    if (distanceKm <= 12) return 30;
    return 45;
  }
  if (lineId?.startsWith("srt")) {
    return Math.min(42, 14 + Math.ceil(distanceKm) * 2);
  }
  return 0;
}

function dijkstra(
  graph: ReturnType<typeof buildGraph>,
  startId: string,
  goalId: string,
  options: { transferPenaltySeconds?: number; avoidStairs?: boolean } = {}
): { segments: RouteSegment[]; totalTime: number; totalFare: number; transfers: number } | null {
  const { nodes, edges } = graph;
  const { transferPenaltySeconds = 180 } = options;

  const adjacency = new Map<string, { edge: ReturnType<typeof buildGraph>["edges"][0]; to: string }[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push({ edge, to: edge.to });
  }

  const dist = new Map<string, { time: number; fare: number; transfers: number; prev?: string; prevLine?: string; edge?: ReturnType<typeof buildGraph>["edges"][0] }>();
  const pq: { state: string; time: number }[] = [];

  const startState = `${startId}::`;
  dist.set(startState, { time: 0, fare: 0, transfers: 0 });
  pq.push({ state: startState, time: 0 });

  while (pq.length > 0) {
    pq.sort((a, b) => a.time - b.time);
    const current = pq.shift()!;
    const currentData = dist.get(current.state)!;
    if (currentData.time < current.time) continue;

    const [nodeId, currentLineId = ""] = current.state.split("::");
    if (nodeId === goalId) {
      // Reconstruct path
      const segments: RouteSegment[] = [];
      let state = current.state;
      let totalFare = 0;
      let totalTime = 0;
      let transfers = 0;
      const visited = new Set<string>();

      while (state !== startState) {
        if (visited.has(state)) break;
        visited.add(state);
        const data = dist.get(state)!;
        if (!data.edge || !data.prev) break;
        const fromNode = nodes.get(data.edge.from)!;
        const toNode = nodes.get(data.edge.to)!;
        const segmentFare = computeFare(data.edge.mode, data.edge.lineId, data.edge.distance);
        segments.unshift({
          mode: data.edge.mode,
          fromId: data.edge.from,
          toId: data.edge.to,
          fromNameEn: fromNode.nameEn,
          fromNameTh: fromNode.nameTh,
          toNameEn: toNode.nameEn,
          toNameTh: toNode.nameTh,
          lineId: data.edge.lineId,
          routeId: data.edge.routeId,
          timeSeconds: data.edge.timeSeconds,
          distance: data.edge.distance,
          fare: segmentFare,
        });
        totalFare += segmentFare;
        totalTime += data.edge.timeSeconds;
        if (data.prevLine && data.edge.lineId && data.prevLine !== data.edge.lineId) {
          transfers++;
          totalTime += transferPenaltySeconds;
        }
        state = data.prev;
      }

      return { segments, totalTime, totalFare, transfers };
    }

    const neighbors = adjacency.get(nodeId) || [];
    for (const { edge, to } of neighbors) {
      const nextLineId = edge.mode === "rail" ? edge.lineId || "" : currentLineId;
      const isTransfer = edge.mode === "rail" && currentLineId && nextLineId !== currentLineId;
      const addedTime = edge.timeSeconds + (isTransfer ? transferPenaltySeconds : 0);
      const addedFare = computeFare(edge.mode, edge.lineId, edge.distance);
      const nextState = `${to}::${nextLineId}`;
      const nextTime = currentData.time + addedTime;
      const nextFare = currentData.fare + addedFare;
      const nextTransfers = currentData.transfers + (isTransfer ? 1 : 0);

      const existing = dist.get(nextState);
      if (!existing || nextTime < existing.time) {
        dist.set(nextState, {
          time: nextTime,
          fare: nextFare,
          transfers: nextTransfers,
          prev: current.state,
          prevLine: currentLineId,
          edge,
        });
        pq.push({ state: nextState, time: nextTime });
      }
    }
  }

  return null;
}

export function findRoutes(
  stations: Station[],
  lines: Line[],
  boatRoutes: BoatRoute[],
  busRoutes: BusRoute[],
  fromId: string,
  toId: string
): RouteOption[] {
  const graph = buildGraph(stations, lines, boatRoutes, busRoutes);
  const options: RouteOption[] = [];

  const fastest = dijkstra(graph, fromId, toId, { transferPenaltySeconds: 180 });
  if (fastest) {
    options.push({
      type: "fastest",
      totalTimeSeconds: fastest.totalTime,
      totalFare: fastest.totalFare,
      transfers: fastest.transfers,
      segments: fastest.segments,
    });
  }

  const cheapest = dijkstra(graph, fromId, toId, { transferPenaltySeconds: 60 });
  if (cheapest && cheapest.totalFare < (fastest?.totalFare ?? Infinity)) {
    options.push({
      type: "cheapest",
      totalTimeSeconds: cheapest.totalTime,
      totalFare: cheapest.totalFare,
      transfers: cheapest.transfers,
      segments: cheapest.segments,
    });
  }

  const fewest = dijkstra(graph, fromId, toId, { transferPenaltySeconds: 600 });
  if (fewest && fewest.transfers < (fastest?.transfers ?? Infinity)) {
    options.push({
      type: "fewestTransfers",
      totalTimeSeconds: fewest.totalTime,
      totalFare: fewest.totalFare,
      transfers: fewest.transfers,
      segments: fewest.segments,
    });
  }

  return options;
}

export function resolveNameToStationId(
  name: string,
  stations: Station[],
  places: { id: string; nameEn: string; nameTh: string; nearbyStationIds: string[] }[]
): string | null {
  const normalized = name.trim().toLowerCase();
  const station = stations.find(
    (s) =>
      s.nameEn.toLowerCase() === normalized ||
      s.nameTh.toLowerCase() === normalized ||
      s.codes.some((c) => c.toLowerCase() === normalized)
  );
  if (station) return station.id;

  const place = places.find(
    (p) => p.nameEn.toLowerCase() === normalized || p.nameTh.toLowerCase() === normalized
  );
  return place?.nearbyStationIds[0] || null;
}
