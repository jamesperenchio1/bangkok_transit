// Plain-text site summaries for AI assistants (llmstxt.org convention), built
// from the same data as the pages so they can never drift.
import { stations } from "@/data/stations";
import {
  LINES, SITE_DESCRIPTION, SITE_URL, absoluteUrl, linePath, lineStations, lineTermini, routePairs, stationPath,
} from "@/lib/seo";

export function llmsTxt(): string {
  const lines = LINES.map(
    (l) => `- [${l.nameEn}](${absoluteUrl(linePath(l))}): ${lineStations(l.key).length} stations, ${lineTermini(l.key).map((s) => s.nameEn).join(" – ")}`,
  );
  return `# Bangkok Transit

> ${SITE_DESCRIPTION}

Bangkok Transit (${SITE_URL}) is a free, installable web map of every operating rail line in Bangkok: ${LINES.length} lines and ${stations.length} stations. It plans routes between any two stations (line changes, walking transfers, direction to board, estimated minutes) and shows live arrivals for BTS Sukhumvit and Silom stations. Station names are in English and Thai. Travel times are estimates, not timetables. No account, no ads.

## Lines
${lines.join("\n")}

## Key pages
- [Interactive map and route planner](${SITE_URL}/): pick a start and destination; links accept ?from=CODE&to=CODE
- [All lines](${SITE_URL}/lines)
- [All stations](${SITE_URL}/stations)
- [Popular routes](${SITE_URL}/routes): ${routePairs.length} step-by-step routes between major stations and airports

## Optional
- [Full station and route index](${SITE_URL}/llms-full.txt)
- [Sitemap](${SITE_URL}/sitemap.xml)
`;
}

export function llmsFullTxt(): string {
  const sections = LINES.map((l) => {
    const rows = lineStations(l.key).map((s) => `- ${s.nameEn} (${s.nameTh}), ${s.code}: ${absoluteUrl(stationPath(s))}`);
    return `## ${l.nameEn} (${l.nameTh})\n${absoluteUrl(linePath(l))}\n${rows.join("\n")}`;
  });
  const routes = routePairs.map((p) => `- ${p.from.nameEn} to ${p.to.nameEn}: ${absoluteUrl(`/routes/${p.slug}`)}`);
  return `# Bangkok Transit: full index\n\n> ${SITE_DESCRIPTION}\n\n${sections.join("\n\n")}\n\n## Routes\n${routes.join("\n")}\n`;
}
