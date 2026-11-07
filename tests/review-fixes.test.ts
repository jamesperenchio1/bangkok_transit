import { afterEach, describe, expect, it, vi } from "vitest";
import { arrivalClockTime } from "@/lib/format-eta";
import { useSettingsStore } from "@/lib/settings-store";

afterEach(() => {
  useSettingsStore.getState().reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("24-hour clock", () => {
  it("shows the hour after midnight as 00, not 24", () => {
    useSettingsStore.getState().update({ clock: "24h" });
    // 17:00 UTC + 7 min = 00:07 Bangkok next day... 17:00Z is 00:00 in Bangkok.
    expect(arrivalClockTime("2026-11-06T17:00:00", 7, "en")).toMatch(/^00:07$/);
  });

  it("12-hour keeps AM/PM in English", () => {
    useSettingsStore.getState().update({ clock: "12h" });
    expect(arrivalClockTime("2026-11-06T17:00:00", 7, "en")).toMatch(/12:07\s?AM/);
  });
});

describe("the silent unlock must not cut a real chime", () => {
  it("a play in the same tap wins over the pending unlock's pause", async () => {
    const events: string[] = [];
    let resolveFirst: () => void = () => {};
    let calls = 0;
    class FakeAudio {
      src = "";
      muted = false;
      currentTime = 0;
      play() {
        calls++;
        if (calls === 1) {
          events.push("unlock-play");
          return new Promise<void>((r) => (resolveFirst = r));
        }
        events.push("chime-play");
        return Promise.resolve();
      }
      pause() {
        events.push("pause");
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    vi.resetModules();
    const { unlockAudio, playDing } = await import("@/lib/alert-output");
    unlockAudio();
    const status = await playDing();
    resolveFirst(); // the unlock's play() settles after the chime started
    await Promise.resolve();
    await Promise.resolve();
    expect(status.media).toBe("played");
    expect(events).toEqual(["unlock-play", "chime-play"]); // no "pause"
  });
});
