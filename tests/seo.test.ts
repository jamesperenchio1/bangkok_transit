import { describe, expect, it } from "vitest";
import { stations } from "@/data/stations";
import {
  LINES, absoluteUrl, describeRoute, lineStations, routePairs, stationLd, stationPath, stationSlug, stationsBySlug,
} from "@/lib/seo";
import { findPath } from "@/lib/transit-graph";
import { llmsFullTxt, llmsTxt } from "@/lib/llms";

describe("seo data", () => {
  it("gives every station a unique, URL-safe slug", () => {
    const slugs = stations.map(stationSlug);
    expect(new Set(slugs).size).toBe(stations.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(stationsBySlug.size).toBe(stations.length);
  });

  it("lists every station on some line page, none twice per line", () => {
    const onLines = new Set<string>();
    for (const l of LINES) {
      const list = lineStations(l.key);
      expect(new Set(list.map((s) => s.code)).size).toBe(list.length);
      expect(list.length).toBeGreaterThan(0);
      list.forEach((s) => onLines.add(s.code));
    }
    expect(onLines.size).toBe(stations.length);
  });

  it("builds route pages that all resolve to a path with steps", () => {
    expect(routePairs.length).toBeGreaterThan(100);
    expect(new Set(routePairs.map((p) => p.slug)).size).toBe(routePairs.length);
    for (const p of routePairs) {
      const path = findPath(p.from.code, p.to.code);
      expect(path, p.slug).not.toBeNull();
      expect(describeRoute(path!).length, p.slug).toBeGreaterThan(0);
    }
  });

  it("emits parseable station JSON-LD with coordinates", () => {
    const ld = stationLd(stations[0]) as { geo: { latitude: number }; url: string };
    expect(ld.geo.latitude).toBeCloseTo(stations[0].lat);
    expect(ld.url).toBe(absoluteUrl(stationPath(stations[0])));
  });

  it("keeps llms.txt in sync with the data", () => {
    expect(llmsTxt()).toContain(`${LINES.length} lines and ${stations.length} stations`);
    expect(llmsFullTxt()).toContain(absoluteUrl(stationPath(stations[0])));
  });
});
