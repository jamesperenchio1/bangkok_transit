import { describe, expect, it } from "vitest";
import { warmMode } from "@/lib/offline-warm";

const base = { dataSaver: false, onLine: true };

describe("warmMode", () => {
  it("downloads the whole set on Wi-Fi or an unknown connection", () => {
    expect(warmMode(base)).toBe("full");
    expect(warmMode({ ...base, connection: { type: "wifi", effectiveType: "4g" } })).toBe("full");
  });

  it("downloads only the overview zooms on mobile data, so the map still works offline", () => {
    expect(warmMode({ ...base, connection: { type: "cellular", effectiveType: "4g" } })).toBe("overview");
  });

  it("does nothing on Data Saver (the app's or the browser's), a slow link, or offline", () => {
    expect(warmMode({ ...base, dataSaver: true })).toBe("skip");
    expect(warmMode({ ...base, connection: { saveData: true } })).toBe("skip");
    expect(warmMode({ ...base, connection: { effectiveType: "3g" } })).toBe("skip");
    expect(warmMode({ ...base, connection: { type: "cellular", effectiveType: "2g" } })).toBe("skip");
    expect(warmMode({ ...base, onLine: false })).toBe("skip");
  });
});
