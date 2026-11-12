import { readFileSync } from "node:fs";
import path from "node:path";

import { stations } from "@/data/stations";
import { LINE_COLORS } from "@/lib/line-colors";
import type { LineSegments } from "@/lib/line-geometry";

const SIZE = 1000;
const PADDING = 0.04;

function round(value: number): string {
  return value.toFixed(1);
}

/**
 * Renders the whole rail network as inline SVG at build time. The browser
 * paints it from the HTML before any map JavaScript runs, so the first frame
 * is the network even on a slow connection. It is removed once the real map
 * reports its first paint.
 */
export function renderNetworkSvg(): string {
  let geometry: LineSegments = {};
  try {
    geometry = JSON.parse(
      readFileSync(path.join(process.cwd(), "public", "line-geometry.json"), "utf8"),
    ) as LineSegments;
  } catch {
    return "";
  }

  if (stations.length === 0) return "";

  const lats = stations.map((station) => station.lat);
  const lons = stations.map((station) => station.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lonSpan = Math.max(maxLon - minLon, 0.01);
  const padLat = latSpan * PADDING;
  const padLon = lonSpan * PADDING;

  const project = (lat: number, lon: number): [number, number] => [
    ((lon - minLon + padLon) / (lonSpan + padLon * 2)) * SIZE,
    ((maxLat - lat + padLat) / (latSpan + padLat * 2)) * SIZE,
  ];

  const lines: string[] = [];
  for (const [line, segments] of Object.entries(geometry)) {
    const color = LINE_COLORS[line as keyof typeof LINE_COLORS] ?? "#666";
    for (const segment of segments) {
      if (segment.length < 2) continue;
      const points = segment
        .map(([lat, lon]) => {
          const [x, y] = project(lat, lon);
          return `${round(x)},${round(y)}`;
        })
        .join(" ");
      lines.push(
        `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`,
      );
    }
  }

  const dots = stations
    .map((station) => {
      const [x, y] = project(station.lat, station.lon);
      const color = station.lines[0]
        ? (LINE_COLORS[station.lines[0].line] ?? "#666")
        : "#666";
      return `<circle cx="${round(x)}" cy="${round(y)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Bangkok rail network">${lines.join("")}${dots}</svg>`;
}
