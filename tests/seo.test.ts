import { describe, expect, it } from "vitest";
import { stations } from "@/data/stations";
import {
  LINES, absoluteUrl, describeRoute, lineBranches, lineStations, neighbours, routePairs, stationLd, stationPath, stationSlug,
  stationsBySlug,
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

  it("never presents separate branches as one continuous run", () => {
    // Pink runs PK01-PK30 plus a spur PK10 -> MT01 -> MT02; the two SRT Red lines fan
    // out of RD04. A single flat list put PK30 next to MT01 and skipped the RD04
    // junction, an order no train follows.
    const adjacent = new Map<string, Set<string>>();
    for (const l of LINES) {
      for (const branch of lineBranches(l.key)) {
        branch.forEach((s, i) => {
          if (i === 0) return;
          expect(neighbours(s.code).some((n) => n.line.key === l.key && n.station.code === branch[i - 1].code),
            `${l.key}: ${branch[i - 1].code} -> ${s.code}`).toBe(true);
        });
      }
      adjacent.set(l.key, new Set(lineBranches(l.key).flat().map((s) => s.code)));
      // Every station of the line appears in at least one branch.
      expect([...adjacent.get(l.key)!].sort()).toEqual(lineStations(l.key).map((s) => s.code).sort());
    }
    const pink = lineBranches("pink").map((b) => b.map((s) => s.code));
    expect(pink).toHaveLength(2);
    expect(pink[1][0]).toBe("PK10");
    expect(pink[1]).toContain("MT01");
    expect(pink[0]).not.toContain("MT01");
    for (const line of ["srtDarkRed", "srtLightRed"] as const) {
      for (const branch of lineBranches(line)) expect(branch[0].code).toBe("RD04");
    }
    expect(lineBranches("sukhumvit")).toHaveLength(1);
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
