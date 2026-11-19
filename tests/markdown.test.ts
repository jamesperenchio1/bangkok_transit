import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { markdownFor, markdownPages } from "@/lib/markdown";
import { LINES, SITE_URL, markdownPath, pageMeta } from "@/lib/seo";
import { stations } from "@/data/stations";

const pages = markdownPages();
const byUrl = new Map(pages.map((p) => [`${SITE_URL}/md/${p.segments.join("/")}`, p.body]));

describe("markdown twins", () => {
  it("maps each page to its twin's path", () => {
    expect(markdownPath("/")).toBe("/md/index.md");
    expect(markdownPath("/lines")).toBe("/md/lines.md");
    expect(markdownPath("/lines/mrt-blue-line")).toBe("/md/lines/mrt-blue-line.md");
  });

  it("has a twin for every page in the sitemap, and nothing else", () => {
    const expected = sitemap().map((e) => e.url.replace(SITE_URL, "")).map((path) => `${SITE_URL}${markdownPath(path || "/")}`);
    expect([...byUrl.keys()].sort()).toEqual(expected.sort());
  });

  it("is clean markdown: a title, its canonical page, and no HTML", () => {
    for (const [url, body] of byUrl) {
      expect(body, url).toMatch(/^# .+\n\nCanonical page: https:\/\/bangkok-transit\.com\S*\n/);
      expect(body, url).not.toMatch(/<\/?[a-z][^>]*>/i);
    }
  });

  it("covers what the pages say: every line, every station, a route's steps", () => {
    const home = markdownFor(["index.md"])!;
    for (const l of LINES) expect(home).toContain(l.nameEn);
    expect(pages.filter((p) => p.segments[0] === "stations" && p.segments.length === 2)).toHaveLength(stations.length);
    const route = pages.find((p) => p.segments[0] === "routes" && p.segments.length === 2)!;
    expect(route.body).toContain("## Step by step");
    expect(route.body).toMatch(/\n1\. Start at /);
  });

  it("answers by path, and returns null for anything that is not a twin", () => {
    expect(markdownFor(["lines.md"])).toContain("Bangkok rail lines");
    expect(markdownFor(["nope.md"])).toBeNull();
    expect(markdownFor(["lines", "not-a-line.md"])).toBeNull();
  });

  it("is advertised from each page's metadata", () => {
    const meta = pageMeta({ title: "T", description: "D", path: "/lines/mrt-blue-line" });
    expect(meta.alternates?.types).toEqual({ "text/markdown": `${SITE_URL}/md/lines/mrt-blue-line.md` });
  });
});
