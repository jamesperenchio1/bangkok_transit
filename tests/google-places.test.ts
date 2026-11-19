import { describe, expect, it } from "vitest";
import { parseGooglePlace } from "@/lib/google-places";

describe("parseGooglePlace", () => {
  it("maps a Places result to name, kind, address and coordinates", () => {
    const place = parseGooglePlace({
      id: "places/siam-paragon",
      displayName: { text: "Siam Paragon" },
      formattedAddress: "991 Rama I Rd, Pathum Wan, Bangkok",
      location: { latitude: 13.7467785, longitude: 100.534954 },
      types: ["shopping_mall"],
      primaryTypeDisplayName: { text: "Shopping mall" },
    });
    expect(place).toEqual({
      id: "places/siam-paragon",
      name: "Siam Paragon",
      detail: "991 Rama I Rd, Pathum Wan, Bangkok",
      kind: "Shopping mall",
      lat: 13.7467785,
      lon: 100.534954,
    });
  });

  it("falls back to the type map when Google sends no display type", () => {
    const place = parseGooglePlace({
      id: "places/bangkok-hospital",
      displayName: { text: "Bangkok Hospital" },
      location: { latitude: 13.7, longitude: 100.5 },
      types: ["hospital"],
    });
    expect(place?.kind).toBe("Hospital");
  });

  it("rejects rows without an id, a name or usable coordinates", () => {
    expect(
      parseGooglePlace({ displayName: { text: "X" }, location: { latitude: 1, longitude: 2 } }),
    ).toBeNull();
    expect(parseGooglePlace({ id: "x", location: { latitude: 1, longitude: 2 } })).toBeNull();
    expect(parseGooglePlace({ id: "x", displayName: { text: "X" }, location: {} })).toBeNull();
  });
});
