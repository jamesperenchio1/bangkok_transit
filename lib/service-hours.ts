import serviceHours from "@/data/service-hours.json";
import type { LineKey } from "@/data/stations";

/**
 * Service windows and typical frequencies per line, in Bangkok wall-clock.
 * The file is generated/curated separately from the router's hop times: a
 * rider planning at 11pm needs to know the last train is near, and a station
 * without live data still deserves an honest frequency rather than "—".
 */
export interface LineService {
  first: string;
  last: string;
  peak: number;
  offPeak: number;
  late: number;
}

interface ServiceHoursFile {
  source: string;
  feedVersion: string | null;
  lines: Partial<Record<LineKey, LineService>>;
}

const file = serviceHours as ServiceHoursFile;

export function getService(line: LineKey | null | undefined): LineService | null {
  if (!line) return null;
  return file.lines[line] ?? null;
}

export type ServiceStatus = "running" | "ended" | "notStarted";

/** Minutes since Bangkok midnight. */
export function bangkokMinutes(now: number | Date = Date.now()): number {
  const date = typeof now === "number" ? new Date(now) : now;
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + 7 * 60) % (24 * 60);
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether the line is running right now. A window that crosses midnight
 * (05:15–00:05) is two intervals, not an empty one: that mistake would hide
 * every late-evening train.
 */
export function serviceStatus(line: LineKey | null | undefined, now: number | Date = Date.now()): ServiceStatus | null {
  const service = getService(line);
  if (!service) return null;
  const first = parseClock(service.first);
  const last = parseClock(service.last);
  if (first === null || last === null) return null;
  const minutes = bangkokMinutes(now);
  if (first <= last) {
    return minutes >= first && minutes <= last ? "running" : minutes < first ? "notStarted" : "ended";
  }
  return minutes >= first || minutes <= last ? "running" : "ended";
}

/** Minutes between trains at this hour (peak, daytime, or late evening). */
export function headwayMinutes(line: LineKey | null | undefined, now: number | Date = Date.now()): number | null {
  const service = getService(line);
  if (!service) return null;
  const minutes = bangkokMinutes(now);
  if ((minutes >= 6 * 60 && minutes < 9 * 60 + 30) || (minutes >= 16 * 60 && minutes < 20 * 60)) {
    return service.peak;
  }
  if (minutes >= 22 * 60 || minutes < 6 * 60) return service.late;
  return service.offPeak;
}

/** Expected wait for a train if no live arrival is available (uniform arrivals ⇒ half a headway). */
export function scheduledWaitMinutes(line: LineKey | null | undefined, now: number | Date = Date.now()): number | null {
  const headway = headwayMinutes(line, now);
  return headway === null ? null : Math.max(1, Math.round(headway / 2));
}

/** Localised "05:15" without inventing a date the timetable does not have. */
export function clockLabel(value: string, lang: "en" | "th"): string {
  const minutes = parseClock(value);
  if (minutes === null) return value;
  // 2026-01-01 00:00 Bangkok = 2025-12-31T17:00Z.
  const base = Date.UTC(2025, 11, 31, 17, 0);
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
  }).format(new Date(base + minutes * 60_000));
}
