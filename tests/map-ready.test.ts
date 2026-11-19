import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("whenMapPainted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => vi.useRealTimers());

  it("waits for the map, then lets the rest of the page start", async () => {
    const { markMapPainted, whenMapPainted } = await import("@/lib/map-ready");
    const started = vi.fn();
    void whenMapPainted().then(started);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(started).not.toHaveBeenCalled();
    markMapPainted();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("does not hold live times back for good if the map never goes idle", async () => {
    const { whenMapPainted } = await import("@/lib/map-ready");
    const started = vi.fn();
    void whenMapPainted(8_000).then(started);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(started).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("answers at once if the map has already painted", async () => {
    const { markMapPainted, whenMapPainted } = await import("@/lib/map-ready");
    markMapPainted();
    markMapPainted();
    const started = vi.fn();
    void whenMapPainted().then(started);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(1);
  });
});
