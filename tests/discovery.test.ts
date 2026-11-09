import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { llmsTxt } from "@/lib/llms";
import { ARRIVALS_URL } from "@/lib/arrivals-url";
import { CONTENT_SIGNAL, SITE_URL } from "@/lib/seo";
import type { ArrivalsDocument } from "@/lib/arrivals-document";
import type { ArrivalPlatform, ArrivalTrain, Arrivals } from "@/lib/bts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const headersFile = readFileSync("public/_headers", "utf8");

/** The lines under one path rule in public/_headers (indented lines up to the next rule). */
function rule(path: string): string[] {
  const at = headersFile.split("\n").findIndex((l) => l === path);
  expect(at, `${path} rule in public/_headers`).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const line of headersFile.split("\n").slice(at + 1)) {
    if (!line.startsWith("  ")) break;
    out.push(line.trim());
  }
  return out;
}

describe("robots.txt content signals", () => {
  it("states the same preference in every group, so a named crawler can't miss it", () => {
    const rules = robots().rules as { userAgent: string; other?: Record<string, string> }[];
    expect(rules.length).toBeGreaterThan(10);
    for (const r of rules) expect(r.other, r.userAgent).toEqual({ "Content-Signal": CONTENT_SIGNAL });
    expect(CONTENT_SIGNAL).toBe("search=yes, ai-input=yes, ai-train=no");
  });
});

describe("API catalog and OpenAPI", () => {
  const catalog = json("public/.well-known/api-catalog");
  const api = json("public/openapi.json");

  it("lists the live arrivals document, with its description and docs", () => {
    expect(catalog.linkset).toHaveLength(1);
    const entry = catalog.linkset[0];
    expect(entry.anchor).toBe(ARRIVALS_URL);
    expect(entry["service-desc"][0].href).toBe(`${SITE_URL}/openapi.json`);
    expect(entry["service-doc"][0].href).toBe(`${SITE_URL}/llms.txt`);
    // The docs it points to really describe the API.
    expect(llmsTxt()).toContain(ARRIVALS_URL);
    expect(llmsTxt()).toContain("/openapi.json");
  });

  it("describes only the one real endpoint, at the real address, with no payment or auth", () => {
    expect(api.openapi).toMatch(/^3\.1\./);
    expect(api.servers[0].url + Object.keys(api.paths)[0]).toBe(ARRIVALS_URL);
    expect(Object.keys(api.paths)).toEqual(["/arrivals.json"]);
    expect(JSON.stringify(api)).not.toMatch(/x-payment-info|securitySchemes|"security"/);
  });

  it("matches the shape of the arrivals document", () => {
    // A document with every field set: if a field is added to the type and to this
    // sample but not to openapi.json, this fails.
    const train = {
      train_no: "087",
      destination: "Kheha",
      destination_key: "E23",
      eta_minutes: 4,
      eta_precise: 4.2,
      status: "",
    } satisfies ArrivalTrain;
    const platform = {
      platform: "1",
      line_color: "#76b729",
      line_id: 1,
      direction: "เคหะฯ | Kheha",
      direction_key: "E23",
      trains: [train],
      carried_from: "2026-11-09T00:00:00",
    } satisfies ArrivalPlatform;
    const reading = {
      station: { code: "N8", name_en: "Mo Chit", name_th: "หมอชิต", line_color: "#76b729" },
      platforms: [platform],
      near_end_of_service: false,
      service_active: true,
      next_service: "",
      server_time: "09/11/2026 07:00",
      timestamp: "2026-11-09T00:00:00",
    } satisfies Arrivals;
    const doc = {
      arrivals: { N8: reading },
      total: 1,
      complete: true,
      status: { state: "ok", since: "2026-11-09T00:00:00.000Z", lastSuccessAt: null, incidents: [] },
      poll: { at: "2026-11-09T00:00:00.000Z", ms: 1, polled: 1, ok: 1, failed: {} },
    } satisfies ArrivalsDocument;
    const schemas = api.components.schemas;
    expect(Object.keys(schemas.ArrivalsDocument.properties).sort()).toEqual(Object.keys(doc).sort());
    expect(Object.keys(schemas.Arrivals.properties).sort()).toEqual(Object.keys(reading).sort());
    expect(Object.keys(schemas.Platform.properties).sort()).toEqual(Object.keys(platform).sort());
    expect(Object.keys(schemas.Train.properties).sort()).toEqual(Object.keys(train).sort());
    for (const key of schemas.ArrivalsDocument.required) expect(doc).toHaveProperty(key);
  });

  it("does not call a timestamp date-time when the source sends it without a timezone (or not as ISO at all)", () => {
    // `timestamp` and `carried_from` are UTC with no trailing Z, and the source's
    // `server_time` is Bangkok local "dd/mm/yyyy HH:mm". A client that enforces
    // format: date-time would reject real, valid responses. (Checked against the live document.)
    const { Arrivals, Platform } = api.components.schemas;
    for (const field of [Arrivals.properties.timestamp, Arrivals.properties.server_time, Platform.properties.carried_from]) {
      expect(field.type).toBe("string");
      expect(field.format).toBeUndefined();
    }
    // The ones the poller writes itself are real ISO with Z, and may say so.
    expect(api.components.schemas.UpstreamStatus.properties.since.format).toBe("date-time");
    expect(api.components.schemas.PollReport.properties.at.format).toBe("date-time");
  });
});

describe("public/_headers for agent discovery", () => {
  it("serves the catalog and OpenAPI with their real content types", () => {
    expect(rule("/.well-known/api-catalog")).toContain("Content-Type: application/linkset+json");
    expect(rule("/openapi.json")).toContain("Content-Type: application/openapi+json");
    expect(rule("/md/*")).toContain("Content-Type: text/markdown; charset=utf-8");
  });

  it("points the home page at them with registered link relations", () => {
    const links = rule("/").filter((l) => l.startsWith("Link:")).join("\n");
    expect(links).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    expect(links).toContain('</openapi.json>; rel="service-desc"');
    expect(links).toContain('rel="service-doc"');
    expect(links).toContain('rel="describedby"');
    expect(links).toContain('</md/index.md>; rel="alternate"; type="text/markdown"');
    // The Early Hints ones stay.
    expect(links).toContain("rel=preconnect");
    expect(links).toContain("/line-geometry.json>; rel=preload");
  });
});
