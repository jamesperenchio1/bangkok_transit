import { describe, expect, it } from "vitest";
import { parsePhoton } from "@/lib/place-search";

const feature = (props: Record<string, unknown>, coordinates: [number, number] = [100.53, 13.74]) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Point", coordinates },
});

describe("parsePhoton", () => {
  it("maps a Photon feature to a place with kind and area", () => {
    const [p] = parsePhoton({
      features: [
        feature({ osm_type: "W", osm_id: 1, osm_value: "mall", name: "MBK Center", street: "Phaya Thai Rd", district: "Pathum Wan", city: "Bangkok" }),
      ],
    });
    expect(p).toMatchObject({ name: "MBK Center", kind: "Shopping mall", lat: 13.74, lon: 100.53 });
    expect(p.detail).toBe("Phaya Thai Rd, Pathum Wan, Bangkok");
  });

  it("drops duplicates, nameless rows and bad coordinates; survives garbage", () => {
    const places = parsePhoton({
      features: [
        feature({ osm_type: "N", osm_id: 1, name: "Same" }),
        feature({ osm_type: "W", osm_id: 2, name: "Same" }),
        feature({ osm_type: "N", osm_id: 3 }),
        { type: "Feature", properties: { name: "No geometry" } },
      ],
    });
    expect(places.map((p) => p.name)).toEqual(["Same"]);
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: "no" })).toEqual([]);
  });

  it("uses the street as the name for a bare address", () => {
    const [p] = parsePhoton({ features: [feature({ osm_id: 4, housenumber: "12", street: "Soi Ari", district: "Phaya Thai" })] });
    expect(p.name).toBe("12 Soi Ari");
    expect(p.detail).toBe("Phaya Thai");
  });
});
