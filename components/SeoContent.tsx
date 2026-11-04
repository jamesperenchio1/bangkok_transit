import Link from "next/link";
import { stations } from "@/data/stations";
import { HOME_FAQ, LINES, faqLd, linePath, lineStations, routePairs } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

// Real, indexable text for the home page, whose visible UI is a map canvas.
// Screen-reader-only (not display:none, which crawlers may discount), and the
// links are out of the tab order so keyboard users don't land on invisible
// controls. No hooks: it's prerendered into the static HTML.
export function SeoContent() {
  const popular = routePairs.slice(0, 12);
  return (
    <footer className="sr-only" aria-label="About Bangkok Transit">
      <h2>Bangkok BTS, MRT and rail map with route planner and live train times</h2>
      <p>
        Bangkok Transit is a free map of every operating rail line in Bangkok: {LINES.length} lines and{" "}
        {stations.length} stations across the BTS Skytrain, MRT subway, Airport Rail Link and SRT Red Line. Pick two
        stations to get a route with line changes, walking transfers, the direction to board and an estimated travel
        time. BTS Sukhumvit and Silom stations show live train arrivals. Available in English and Thai
        (<span lang="th">รถไฟฟ้ากรุงเทพ แผนที่ วางแผนเส้นทาง เวลารถไฟฟ้าสด</span>).
      </p>
      <h2>Bangkok rail lines</h2>
      <ul>
        {LINES.map((l) => (
          <li key={l.key}>
            <Link href={linePath(l)} tabIndex={-1}>
              {l.nameEn}
            </Link>{" "}
            – {lineStations(l.key).length} stations (<span lang="th">{l.nameTh}</span>)
          </li>
        ))}
      </ul>
      <h2>Popular routes</h2>
      <ul>
        {popular.map((p) => (
          <li key={p.slug}>
            <Link href={`/routes/${p.slug}`} tabIndex={-1}>
              {p.from.nameEn} to {p.to.nameEn}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/routes" tabIndex={-1}>
            All Bangkok BTS and MRT routes
          </Link>
        </li>
        <li>
          <Link href="/stations" tabIndex={-1}>
            All {stations.length} stations
          </Link>
        </li>
      </ul>
      <h2>Frequently asked questions</h2>
      <dl>
        {HOME_FAQ.map((f) => (
          <div key={f.q}>
            <dt>{f.q}</dt>
            <dd>{f.a}</dd>
          </div>
        ))}
      </dl>
      <JsonLd data={faqLd(HOME_FAQ)} />
    </footer>
  );
}
