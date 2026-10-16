// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SHOW_AGE_MS, type Arrivals } from "@/lib/bts";

const NOW = Date.UTC(2026, 9, 15, 10);
function reading(code: string, at: number): Arrivals {
  return {
    station: { code, name_en: code, name_th: code, line_color: "" },
    platforms: [],
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: "",
    timestamp: new Date(at).toISOString().replace("Z", ""),
  };
}

// The store module keeps one polling loop per page; load a fresh copy per test.
async function loadStore() {
  vi.resetModules();
  return import("@/lib/arrivals-store");
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("serverNowFrom", () => {
  it("reads the server clock from Date, plus Age for a CDN-cached copy", async () => {
    const { serverNowFrom } = await loadStore();
    const date = new Date(NOW).toUTCString();
    expect(serverNowFrom(new Response("", { headers: { date } }))).toBe(NOW);
    expect(serverNowFrom(new Response("", { headers: { date, age: "7" } }))).toBe(NOW + 7_000);
    expect(serverNowFrom(new Response(""))).toBeNull();
  });
});

describe("mergeReadings", () => {
  it("keeps the newer reading per station and never lets a partial answer wipe held ones", async () => {
    const { mergeReadings } = await loadStore();
    const held = { A: reading("A", NOW - 60_000), B: reading("B", NOW - 30_000) };
    const incoming = { A: reading("A", NOW - 5_000), B: reading("B", NOW - 90_000) };
    const merged = mergeReadings(held, incoming, NOW);
    expect(merged.A).toBe(incoming.A);
    expect(merged.B).toBe(held.B);
    expect(mergeReadings(held, {}, NOW)).toEqual(held);
  });

  it("drops expired and malformed entries", async () => {
    const { mergeReadings } = await loadStore();
    const merged = mergeReadings({ A: reading("A", NOW - MAX_SHOW_AGE_MS - 1) }, { B: { nope: true } }, NOW);
    expect(merged).toEqual({});
  });
});

describe("startArrivalsPolling", () => {
  function serve(body: object, headers: Record<string, string> = {}) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(body, { headers: { date: new Date(Date.now()).toUTCString(), ...headers } }),
    );
  }

  it("fetches the shared document and fills the store", async () => {
    const fetch = serve({ arrivals: { N8: reading("N8", NOW) }, complete: true, status: { state: "ok" } });
    const { startArrivalsPolling, useArrivalsStore } = await loadStore();
    startArrivalsPolling();
    await vi.waitFor(() => expect(useArrivalsStore.getState().settled).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.keys(useArrivalsStore.getState().map)).toEqual(["N8"]);
    expect(useArrivalsStore.getState().upstream).toBe("ok");
    expect(JSON.parse(localStorage.getItem("bts:arrivals:v1")!)).toHaveProperty("N8");
  });

  it("polls every 15 s once complete, and fast while the snapshot is filling", async () => {
    const fetch = serve({ arrivals: {}, complete: false });
    const { startArrivalsPolling, useArrivalsStore } = await loadStore();
    startArrivalsPolling();
    await vi.waitFor(() => expect(useArrivalsStore.getState().settled).toBe(true));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(2); // fast retry while filling

    fetch.mockImplementation(async () =>
      Response.json({ arrivals: {}, complete: true }, { headers: { date: new Date(Date.now()).toUTCString() } }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetch).toHaveBeenCalledTimes(3); // back to the steady 15 s cadence
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("learns the server clock, so a phone with a wrong clock still counts down right", async () => {
    // The server is 5 minutes ahead of this device.
    serve({ arrivals: {}, complete: true }, { date: new Date(NOW + 5 * 60_000).toUTCString() });
    const { startArrivalsPolling, useArrivalsStore, serverNow } = await loadStore();
    startArrivalsPolling();
    await vi.waitFor(() => expect(useArrivalsStore.getState().settled).toBe(true));
    expect(Math.abs(useArrivalsStore.getState().clockOffsetMs - 5 * 60_000)).toBeLessThan(1_000);
    expect(Math.abs(serverNow() - (NOW + 5 * 60_000))).toBeLessThan(1_000);
  });

  it("seeds from localStorage so times show before the first response", async () => {
    localStorage.setItem("bts:arrivals:v1", JSON.stringify({ N8: reading("N8", NOW - 10_000), BAD: { x: 1 } }));
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {})); // never answers
    const { startArrivalsPolling, useArrivalsStore } = await loadStore();
    startArrivalsPolling();
    expect(Object.keys(useArrivalsStore.getState().map)).toEqual(["N8"]);
  });

  it("keeps last-known times when a poll fails", async () => {
    const fetch = serve({ arrivals: { N8: reading("N8", NOW) }, complete: true });
    const { startArrivalsPolling, useArrivalsStore } = await loadStore();
    startArrivalsPolling();
    await vi.waitFor(() => expect(Object.keys(useArrivalsStore.getState().map)).toEqual(["N8"]));
    fetch.mockRejectedValue(new TypeError("offline"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(Object.keys(useArrivalsStore.getState().map)).toEqual(["N8"]);
  });
  it("goes offline without fetching, keeps held times, and resumes on `online`", async () => {
    const fetch = serve({ arrivals: { N8: reading("N8", NOW) }, complete: true });
    const { startArrivalsPolling, useArrivalsStore } = await loadStore();
    startArrivalsPolling();
    await vi.waitFor(() => expect(useArrivalsStore.getState().settled).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);

    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    expect(useArrivalsStore.getState().offline).toBe(true);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetch).toHaveBeenCalledTimes(1); // no requests while offline
    expect(Object.keys(useArrivalsStore.getState().map)).toEqual(["N8"]);

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(useArrivalsStore.getState().offline).toBe(false);
    // resume() also grants a few quick retries, so more than one call.
    await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(1));
  });
});
