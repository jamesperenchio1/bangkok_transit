// Markdown twins of the content pages, for agents that would rather read
// clean text than strip a page's HTML. Built at build time from the same data
// and helpers as the pages (lib/seo.ts), so they cannot drift, and served as
// static files under /md/ (app/md/[...path]/route.ts). Every page advertises
// its twin with <link rel="alternate" type="text/markdown"> (pageMeta) and the
// home page with a Link header (public/_headers).
//
// Why twins and not `Accept: text/markdown` on the same URL: the site is static
// assets only, which are routed by path, so negotiating on a header would need a
// Worker on every page view (see docs/architecture.md, "Agent discovery").
import { shownCode, stations, stationsByCode } from "@/data/stations";
import interchanges from "@/data/interchanges.json";
import { findPath } from "@/lib/transit-graph";
import {
  HOME_FAQ, LINES, SITE_DESCRIPTION, SITE_URL, absoluteUrl, describeRoute, lineBranches, lineStations, lineTermini,
  linePath, mapLink, markdownPath, neighbours, routePairs, routePairsBySlug, stationLines, stationPath,
  stationSlug,
  type LineInfo,
} from "@/lib/seo";
import type { Station } from "@/data/stations";

const md = (htmlPath: string) => absoluteUrl(markdownPath(htmlPath));
const html = (htmlPath: string) => absoluteUrl(htmlPath);

const stationLink = (s: Station) => `[${s.nameEn}](${md(stationPath(s))})`;
const lineLink = (l: LineInfo) => `[${l.nameEn}](${md(linePath(l))})`;

/** Every twin starts the same way, so an agent always knows where the canonical page is. */
function page(title: string, htmlPath: string, body: string): string {
  return `# ${title}\n\nCanonical page: ${html(htmlPath)}\n\n${body.trim()}\n`;
}

export function homeMarkdown(): string {
  const lines = LINES.map(
    (l) => `- ${lineLink(l)}: ${lineStations(l.key).length} stations, ${lineTermini(l.key).map((s) => s.nameEn).join(" – ")}`,
  );
  const faq = HOME_FAQ.map((f) => `### ${f.q}\n\n${f.a}`);
  return page(
    "Bangkok Transit: BTS, MRT and rail map with live arrivals",
    "/",
    `${SITE_DESCRIPTION}

The interactive map and route planner is a web app at ${SITE_URL}/ (links accept \`?from=CODE&to=CODE\`). The pages below are the same facts as plain text.

## Lines
${lines.join("\n")}

## Index pages
- [All lines](${md("/lines")})
- [All stations](${md("/stations")})
- [Popular routes](${md("/routes")})

## Frequently asked questions
${faq.join("\n\n")}`,
  );
}

export function linesIndexMarkdown(): string {
  const rows = LINES.map(
    (l) => `- ${lineLink(l)} (${l.nameTh}): ${lineStations(l.key).length} stations, ${lineTermini(l.key).map((s) => s.nameEn).join(" – ")}${l.live ? ", live arrivals" : ""}`,
  );
  return page("Bangkok rail lines", "/lines", `${LINES.length} operating lines.\n\n${rows.join("\n")}`);
}

export function stationsIndexMarkdown(): string {
  const sections = LINES.map((l) => {
    const rows = lineStations(l.key).map((s) => `- ${stationLink(s)} (${s.nameTh}), ${shownCode(s)}`);
    return `## ${l.nameEn}\n${rows.join("\n")}`;
  });
  return page("Bangkok rail stations", "/stations", `${stations.length} stations. Interchange stations appear under each line they serve.\n\n${sections.join("\n\n")}`);
}

export function routesIndexMarkdown(): string {
  const rows = routePairs.map((p) => `- [${p.from.nameEn} to ${p.to.nameEn}](${md(`/routes/${p.slug}`)})`);
  return page("Bangkok BTS and MRT routes between major stations", "/routes", `${routePairs.length} step-by-step routes between airports, interchanges and busy stations.\n\n${rows.join("\n")}`);
}

export function lineMarkdown(line: LineInfo): string {
  const list = lineStations(line.key);
  const termini = lineTermini(line.key);
  const branches = lineBranches(line.key);
  const row = (s: Station) => {
    const others = stationLines(s).filter((l) => l.key !== line.key);
    return `- ${shownCode(s)} ${stationLink(s)} (${s.nameTh})${others.length ? `, interchange: ${others.map((o) => o.nameEn).join(", ")}` : ""}`;
  };
  const stationsBlock =
    branches.length > 1
      ? branches
          .map((b) => `### ${b[0].nameEn} to ${b[b.length - 1].nameEn}\n${b.map(row).join("\n")}`)
          .join("\n\n")
      : list.map(row).join("\n");
  return page(
    `${line.nameEn} (${line.nameTh})`,
    linePath(line),
    `The ${line.nameEn} has ${list.length} stations. Terminal stations: ${termini.map((s) => s.nameEn).join(", ")}. ${
      line.live
        ? "Live train arrivals are available at every station on this line."
        : "Live arrivals are not available for this line; the map and route planner still cover it."
    }

Plan a route on the map: ${absoluteUrl(mapLink())}

## Stations${branches.length > 1 ? " by branch" : " in order"}
${stationsBlock}`,
  );
}

export function stationMarkdown(s: Station): string {
  const lines = stationLines(s);
  const next = neighbours(s.code);
  const transfers = (interchanges as { a: string; b: string }[])
    .filter((i) => i.a === s.code || i.b === s.code)
    .map((i) => stationsByCode.get(i.a === s.code ? i.b : i.a))
    .filter((x): x is Station => !!x);
  const routes = routePairs.filter((p) => p.from.code === s.code || p.to.code === s.code).slice(0, 12);
  const sections = [
    `## Neighbouring stations\n${next.map(({ line, station }) => `- ${stationLink(station)} (${line.nameEn})`).join("\n")}`,
    transfers.length
      ? `## Walking interchanges\n${transfers.map((t) => `- ${stationLink(t)} (${stationLines(t).map((l) => l.nameEn).join(", ")})`).join("\n")}`
      : "",
    routes.length
      ? `## Popular routes\n${routes.map((p) => `- [${p.from.nameEn} to ${p.to.nameEn}](${md(`/routes/${p.slug}`)})`).join("\n")}`
      : "",
  ].filter(Boolean);
  return page(
    `${s.nameEn} station (${s.nameTh})`,
    stationPath(s),
    `${s.nameEn} (${shownCode(s)}) is on the ${lines.map(lineLink).join(" and ")} in Bangkok. ${
      s.hasLiveArrivals ? "Live train arrivals are shown on the map." : "Live arrivals are not available for this line."
    }

Plan a route from here: ${absoluteUrl(mapLink(s))}

${sections.join("\n\n")}

Coordinates: ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`,
  );
}

export function routeMarkdown(slug: string): string | null {
  const pair = routePairsBySlug.get(slug);
  const path = pair && findPath(pair.from.code, pair.to.code);
  if (!pair || !path) return null;
  const steps = [`Start at ${pair.from.nameEn}.`, ...describeRoute(path)];
  const changes = path.changes === 0 ? "no changes" : `${path.changes} ${path.changes === 1 ? "change" : "changes"}`;
  return page(
    `${pair.from.nameEn} to ${pair.to.nameEn} by BTS and MRT`,
    `/routes/${pair.slug}`,
    `${pair.from.nameEn} (${pair.from.nameTh}) to ${pair.to.nameEn} (${pair.to.nameTh}): about ${Math.round(path.minutes)} minutes (${path.stops} stops, ${changes}${
      path.walkMeters > 0 ? `, ${Math.round(path.walkMeters / 10) * 10} m of walking` : ""
    }), not counting the wait for the first train. The same line sequence works in reverse.

From: ${stationLink(pair.from)}. To: ${stationLink(pair.to)}.

## Step by step
${steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}

Show this route on the map: ${absoluteUrl(mapLink(pair.from, pair.to))}

Times are estimates from track distance and typical train speed, not a timetable.`,
  );
}

/**
 * Every twin, keyed by the path segments after /md/ (the last one ends in
 * `.md`). Used by the static route handler to emit one file each, and by the
 * tests to check there is a twin for every sitemap page.
 */
export function markdownPages(): { segments: string[]; body: string }[] {
  const out: { segments: string[]; body: string }[] = [
    { segments: ["index.md"], body: homeMarkdown() },
    { segments: ["lines.md"], body: linesIndexMarkdown() },
    { segments: ["stations.md"], body: stationsIndexMarkdown() },
    { segments: ["routes.md"], body: routesIndexMarkdown() },
  ];
  for (const l of LINES) out.push({ segments: ["lines", `${l.slug}.md`], body: lineMarkdown(l) });
  for (const s of stations) out.push({ segments: ["stations", `${stationSlug(s)}.md`], body: stationMarkdown(s) });
  for (const p of routePairs) {
    const body = routeMarkdown(p.slug);
    if (body) out.push({ segments: ["routes", `${p.slug}.md`], body });
  }
  return out;
}

let byPath: Map<string, string> | null = null;

/** The twin for `/md/<segments>`, or null. Built once, then looked up. */
export function markdownFor(segments: string[]): string | null {
  byPath ??= new Map(markdownPages().map((p) => [p.segments.join("/"), p.body]));
  return byPath.get(segments.join("/")) ?? null;
}
