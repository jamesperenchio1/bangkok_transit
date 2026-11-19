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

export function infoMarkdown(): string {
  return page(
    "Bangkok transit rules, fares and etiquette",
    "/info",
    `Each operator sets its own rules, fares and ticket conditions. Checked 12 November 2026; confirm current fares and notices at the station.

## Quick comparison
| Operator | Hours | Paid-area limit | Children | Food and drink | Pets and bikes |
| --- | --- | --- | --- | --- | --- |
| BTS | 06:00–24:00 | 300 minutes | Under 90 cm | No food or drink in the paid area or on trains | Guide dogs only; standard bikes in limited windows, foldables anytime |
| MRT Blue / Purple | 06:00–24:00 | 180 minutes | Under 90 cm, carried through the gate | No food, drinks or snacks in the paid area | No pets, no bicycles |
| SRT Red | 05:30–24:00 | 120 minutes | 4 years or under and 90 cm or under | Follow station notices | Follow station notices |
| Airport Rail Link | About 05:30–24:00 | Check station notices | 90 cm or under with an adult | Follow station notices | Follow station notices |

## BTS
Trains run 06:00–24:00. Children under 90 cm travel free and are carried through the gate. The paid-area limit is 300 minutes; overstaying is charged the maximum single-journey fare. Eating and drinking are not allowed in the paid area or on trains. Pets are not allowed except guide dogs. Smoking, weapons, dangerous goods, alcohol, loud devices, selling, begging, leaflets and loitering are prohibited.

Standard bicycles are allowed on weekdays 06:00–06:30 and 22:00–24:00, and on weekends and public holidays 06:00–09:00 and 22:00–24:00. Foldables are allowed during all operating hours. Fold at ground level, use the right side of the stairs, leave the bike in front of the manual gate, ask staff, and hold it at all times. Riding inside is prohibited.

Single Journey tickets are valid on the purchase date only. Leaving the paid area at the same station within five minutes can be refunded at the ticket office. A lost ticket is charged the maximum fare, and fare evasion can be fined up to 20 times the maximum fare. A negative Rabbit balance blocks travel until top-up.

Fines: damaging or defacing system property up to 5,000 THB; spitting, littering, smoking or unauthorised selling up to 2,000 THB; animals, unreasonable noise, alcohol or lewd behaviour up to 500 THB; deliberate pushing, panic or disturbance up to 1 month or 1,000 THB, or both.

## MRT Blue and Purple
BEM operates the Blue and Purple lines. A Single Journey Token is valid only on the issue date and at the issuing station, and must be returned at the destination gate. The paid-area limit is 180 minutes; overstaying is charged the maximum fare.

Food, drinks and snacks are not allowed anywhere in the paid area. Pets, bicycles and roller shoes are not allowed. Queue behind the yellow line, let passengers leave first, hold a rail or strap, and do not lean on or block the doors. Lift luggage above the gate and pass one person at a time.

Contactless EMV bank cards charge the standard adult fare, one card per traveller. Tap the same card in and out; forgetting to tap out or using a different card charges the maximum fare. Mastercard may show a 1 THB pre-authorisation on first use. Ticket offices do not top up bank cards, and disputes must be raised within 14 days.

## SRT Red
Trains run 05:30–24:00. Fares are 1.50 THB per kilometre: 12–42 THB for adults, 11–38 THB for students and 6–21 THB for seniors. Children aged four or under and 90 cm or under travel free. Disabled passengers travel free with a government-issued disability card.

The paid-area limit is 120 minutes; overstaying is charged the maximum fare. Single Journey tokens are valid on the purchase date and are not refundable. A stored-value card costs 300 THB (200 THB value, 50 THB deposit, 50 THB issuance). A 30-day, 30-trip card costs 800 THB. A through ticket is available between Rangsit and Taling Chan; change platforms at Krung Thep Aphiwat.

## Airport Rail Link
Phaya Thai to Suvarnabhumi, eight stations, fares 15–45 THB. Trains run from about 05:30 to 24:00, with the last train often leaving before midnight. Children 90 cm or under travel free with an adult.

Rabbit cards are not accepted. Contactless EMV bank cards have been accepted at all eight stations since 8 November 2025; each traveller needs their own card and must tap the same card in and out. The Airport Rail Link charges a separate fare from BTS and MRT, even at interchanges such as Phaya Thai, Makkasan and Hua Mak.

## Across operators
There is no single Bangkok transit ticket. BTS, MRT, SRT Red and the Airport Rail Link each charge their own fare. From December 2025 to November 2026, MRT Purple and SRT Red journeys paid with a contactless EMV Visa, Mastercard or UnionPay card are capped at 40 THB per day for unlimited journeys; the cap applies to each line or both together, and a lower actual fare is charged as normal.

## Official sources
- [BTS FAQ](https://www.bts.co.th/eng/faq/faq-howto.html) and [BTS regulations](https://www.bts.co.th/eng/service/AnnouncementandRegulations.html)
- [BTS ticket conditions](https://btsapp1.bts.co.th/website/eng/tickets/ticket-conditions.html)
- [BEM terms of use](https://metro.bemplc.co.th/Terms-of-Use?lang=en) and [ticket types](https://metro.bemplc.co.th/Ticket-Type?lang=en)
- [SRT Red FAQ](https://www.srtet.co.th/en/faq), [ticket types](https://www.srtet.co.th/en/ticket-types) and [fares](https://www.srtet.co.th/en/fare-information)
- [MRTA daily fare policy](https://www.mrta.co.th/en/ticket-transaction)`,
  );
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
    { segments: ["info.md"], body: infoMarkdown() },
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
