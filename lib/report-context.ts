/**
 * Builds the context bundle attached to a "not right?" report.
 *
 * Pure-ish: callers pass what they know (station codes, route summary, map
 * provider) and the builder fills in the rest from the browser. Keeping this
 * in one place means station cards, the route sheet and the global button all
 * produce the same, comparable report.
 *
 * No network calls: the bundle is only ever handed to copy/mailto/GitHub.
 */
export interface ReportContextInput {
  category: string;
  details?: string;
  pageUrl?: string;
  lang?: "en" | "th";
  mapProvider?: "standard" | "google" | null;
  startCode?: string | null;
  destinationCode?: string | null;
  focusStationCode?: string | null;
  routeMinutes?: number | null;
  routeChanges?: number | null;
  arrivalsAgeMs?: number | null;
  includeDevice?: boolean;
  appVersion?: string;
}

export interface ReportContext {
  category: string;
  details: string;
  pageUrl: string;
  timestamp: string;
  lang: "en" | "th";
  mapProvider: "standard" | "google" | null;
  startCode: string | null;
  destinationCode: string | null;
  focusStationCode: string | null;
  routeMinutes: number | null;
  routeChanges: number | null;
  arrivalsAgeMs: number | null;
  online: boolean;
  includeDevice: boolean;
  userAgent: string | null;
  appVersion: string;
}

export const REPORT_CATEGORIES = [
  "route",
  "station",
  "live",
  "map",
  "search",
  "other",
] as const;

export function buildReportContext(input: ReportContextInput): ReportContext {
  const lang: "en" | "th" =
    input.lang ?? (typeof document !== "undefined" && document.documentElement.lang === "th" ? "th" : "en");
  return {
    category: input.category,
    details: (input.details ?? "").trim(),
    pageUrl:
      input.pageUrl ??
      (typeof window !== "undefined" ? window.location.href : ""),
    timestamp: new Date().toISOString(),
    lang,
    mapProvider: input.mapProvider ?? null,
    startCode: input.startCode ?? null,
    destinationCode: input.destinationCode ?? null,
    focusStationCode: input.focusStationCode ?? null,
    routeMinutes: input.routeMinutes ?? null,
    routeChanges: input.routeChanges ?? null,
    arrivalsAgeMs: input.arrivalsAgeMs ?? null,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    includeDevice: input.includeDevice ?? true,
    userAgent: input.includeDevice === false ? null : (typeof navigator !== "undefined" ? navigator.userAgent : null),
    appVersion: input.appVersion ?? "unknown",
  };
}

export function formatReport(ctx: ReportContext): string {
  const lines: string[] = [];
  lines.push("Bangkok Transit — issue report");
  lines.push("");
  lines.push(`Category: ${ctx.category}`);
  if (ctx.details) {
    lines.push("");
    lines.push("Details:");
    lines.push(ctx.details);
  }
  lines.push("");
  lines.push("Context:");
  lines.push(`- URL: ${ctx.pageUrl}`);
  lines.push(`- Time: ${ctx.timestamp}`);
  lines.push(`- Language: ${ctx.lang}`);
  lines.push(`- Map: ${ctx.mapProvider ?? "n/a"}`);
  if (ctx.startCode) lines.push(`- Start: ${ctx.startCode}`);
  if (ctx.destinationCode) lines.push(`- Destination: ${ctx.destinationCode}`);
  if (ctx.focusStationCode) lines.push(`- Focused station: ${ctx.focusStationCode}`);
  if (ctx.routeMinutes != null) lines.push(`- Route: ~${ctx.routeMinutes} min, ${ctx.routeChanges ?? 0} changes`);
  if (ctx.arrivalsAgeMs != null) lines.push(`- Arrivals age: ${Math.round(ctx.arrivalsAgeMs / 1000)}s`);
  lines.push(`- Online: ${ctx.online}`);
  if (ctx.includeDevice && ctx.userAgent) lines.push(`- User agent: ${ctx.userAgent}`);
  lines.push(`- App version: ${ctx.appVersion}`);
  return lines.join("\n");
}

export function reportMailto(ctx: ReportContext): string {
  const subject = encodeURIComponent(`Bangkok Transit issue: ${ctx.category}`);
  const body = encodeURIComponent(formatReport(ctx));
  return `mailto:hello@bangkok-transit.com?subject=${subject}&body=${body}`;
}

export function reportGithubUrl(ctx: ReportContext): string {
  const title = encodeURIComponent(`Issue report: ${ctx.category}`);
  const body = encodeURIComponent(formatReport(ctx));
  return `https://github.com/jamesperenchio1/bangkok_transit/issues/new?title=${title}&body=${body}`;
}
