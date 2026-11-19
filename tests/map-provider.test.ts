import { describe, expect, it } from "vitest";
import { chooseMap } from "@/lib/map-provider";

const base = { chosen: "standard" as const, hasGoogleKey: true, startedOffline: false, googleFailed: false };

describe("chooseMap", () => {
  it("is the standard (offline-capable) map by default, whatever else is true", () => {
    expect(chooseMap(base)).toEqual({ provider: "standard", fellBack: false });
    expect(chooseMap({ ...base, hasGoogleKey: false })).toEqual({ provider: "standard", fellBack: false });
    expect(chooseMap({ ...base, startedOffline: true, googleFailed: true })).toEqual({ provider: "standard", fellBack: false });
  });

  it("uses Google only when it was chosen and everything it needs is there", () => {
    expect(chooseMap({ ...base, chosen: "google" })).toEqual({ provider: "google", fellBack: false });
  });

  it("falls back to the standard map, and says so, when Google cannot be used", () => {
    expect(chooseMap({ ...base, chosen: "google", startedOffline: true })).toEqual({ provider: "standard", fellBack: true });
    expect(chooseMap({ ...base, chosen: "google", googleFailed: true })).toEqual({ provider: "standard", fellBack: true });
  });

  it("quietly stays standard when Google was chosen but this build has no key", () => {
    // Nothing to apologise for: the option is not offered in Settings in that case.
    expect(chooseMap({ ...base, chosen: "google", hasGoogleKey: false })).toEqual({ provider: "standard", fellBack: false });
  });
});
