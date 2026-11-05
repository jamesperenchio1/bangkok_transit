import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/alert-output.ts against fake browsers. The Playwright matrix
 * (e2e/alert-devices.spec.ts) runs the real engines, but every iPhone there is
 * the current WebKit; what differs by iOS version, by browser or by a failing
 * API is pinned here, as capability sets:
 *
 *   iPhone, iOS 16.4+   audioSession, no vibrate, Wake Lock, Notification only when installed
 *   iPhone, iOS 15-16.3 no audioSession, no vibrate, no Wake Lock
 *   Android Chrome      vibrate (can return false until the first tap)
 *   desktop             vibrate present, no audioSession (Safari has it)
 */

class FakeContext {
  static created: FakeContext[] = [];
  static resumeRejects = false;
  static bufferThrows = false;
  state: "running" | "suspended" | "closed" = "suspended";
  currentTime = 0;
  destination = {};
  oscillators = 0;
  constructor() {
    FakeContext.created.push(this);
  }
  resume() {
    if (FakeContext.resumeRejects) return Promise.reject(new Error("not allowed"));
    if (this.state !== "closed") this.state = "running";
    return Promise.resolve();
  }
  createGain() {
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { gain: param, connect: (next: unknown) => next };
  }
  createOscillator() {
    this.oscillators++;
    return { type: "", frequency: { value: 0 }, connect: (next: unknown) => next, start() {}, stop() {} };
  }
  createBuffer() {
    if (FakeContext.bufferThrows) throw new Error("unsupported");
    return {};
  }
  createBufferSource() {
    return { buffer: null, connect: (next: unknown) => next, start() {} };
  }
}

async function load() {
  vi.resetModules();
  return import("@/lib/alert-output");
}

const BUZZ = [300, 120, 300, 120, 600];

beforeEach(() => {
  FakeContext.created = [];
  FakeContext.resumeRejects = false;
  FakeContext.bufferThrows = false;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("navigator", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("unlockAudio", () => {
  it("asks iOS for a playback audio session so the silent switch doesn't mute the chime", async () => {
    const nav = { audioSession: { type: "auto" } };
    vi.stubGlobal("navigator", nav);
    const { unlockAudio } = await load();
    unlockAudio();
    expect(nav.audioSession.type).toBe("playback");
  });

  it("makes a new context if the old one was closed (iOS can close it)", async () => {
    const { unlockAudio } = await load();
    unlockAudio();
    FakeContext.created[0].state = "closed";
    unlockAudio();
    expect(FakeContext.created).toHaveLength(2);
  });

  it("keeps one context across repeated taps", async () => {
    const { unlockAudio } = await load();
    unlockAudio();
    unlockAudio();
    unlockAudio();
    expect(FakeContext.created).toHaveLength(1);
  });
});

describe("playDing", () => {
  it("waits for a suspended context to resume, then plays", async () => {
    const { unlockAudio, playDing } = await load();
    unlockAudio();
    const ctx = FakeContext.created[0];
    ctx.state = "suspended";
    playDing();
    expect(ctx.oscillators).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.oscillators).toBe(4);
  });

  it("plays at once when the context is already running", async () => {
    const { unlockAudio, playDing } = await load();
    unlockAudio();
    const ctx = FakeContext.created[0];
    ctx.state = "running";
    playDing();
    expect(ctx.oscillators).toBe(4);
  });

  it("does nothing before audio was ever unlocked (no tap yet)", async () => {
    const { playDing } = await load();
    expect(() => playDing()).not.toThrow();
    expect(FakeContext.created).toHaveLength(0);
  });
});

/** Each row is what a phone's browser exposes; the alert must work, quietly degrading, on all of them. */
const phones = [
  { name: "iPhone Safari, iOS 16.4+", audioSession: true, vibrate: "absent" },
  { name: "iPhone Chrome, iOS 16.4+ (same WebKit)", audioSession: true, vibrate: "absent" },
  { name: "iPhone, iOS 15-16.3 (no audioSession)", audioSession: false, vibrate: "absent" },
  { name: "Android Chrome", audioSession: false, vibrate: "works" },
  { name: "Android Chrome before the first tap (vibrate returns false)", audioSession: false, vibrate: "refused" },
  { name: "Samsung Internet", audioSession: false, vibrate: "works" },
  { name: "Android browser whose vibrate throws", audioSession: false, vibrate: "throws" },
  { name: "desktop", audioSession: false, vibrate: "works" },
] as const;

describe.each(phones)("on $name", ({ audioSession, vibrate: vibration }) => {
  function setup() {
    const calls: unknown[] = [];
    const nav: Record<string, unknown> = {};
    if (audioSession) nav.audioSession = { type: "auto" };
    if (vibration !== "absent") {
      nav.vibrate = (pattern: unknown) => {
        calls.push(pattern);
        if (vibration === "throws") throw new DOMException("blocked", "SecurityError");
        return vibration === "works";
      };
    }
    vi.stubGlobal("navigator", nav);
    return { nav, calls };
  }

  it("a tap unlocks audio and the chime plays all four notes", async () => {
    const { nav } = setup();
    const { unlockAudio, playDing } = await load();
    unlockAudio();
    const ctx = FakeContext.created[0];
    expect(ctx.state).toBe("running");
    playDing();
    expect(ctx.oscillators).toBe(4);
    if (audioSession) expect((nav.audioSession as { type: string }).type).toBe("playback");
  });

  it("vibrates with the alert pattern where it can, and never throws where it can't", async () => {
    const { calls } = setup();
    const { vibrate } = await load();
    expect(() => vibrate()).not.toThrow();
    expect(calls).toEqual(vibration === "absent" ? [] : [BUZZ]);
  });
});

describe("when the platform's audio APIs misbehave", () => {
  it("no Web Audio at all: unlock and ding are silent no-ops", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { unlockAudio, playDing } = await load();
    expect(() => unlockAudio()).not.toThrow();
    expect(() => playDing()).not.toThrow();
  });

  it("a read-only audioSession doesn't stop the context being created", async () => {
    const nav = {};
    Object.defineProperty(nav, "audioSession", {
      get: () => ({
        get type() {
          return "auto";
        },
        set type(_v: string) {
          throw new TypeError("read-only");
        },
      }),
    });
    vi.stubGlobal("navigator", nav);
    const { unlockAudio, playDing } = await load();
    expect(() => unlockAudio()).not.toThrow();
    playDing();
    expect(FakeContext.created[0].oscillators).toBe(4);
  });

  it("a refused resume (no user gesture) is swallowed, not an unhandled rejection", async () => {
    const { unlockAudio, playDing } = await load();
    unlockAudio();
    FakeContext.created[0].state = "suspended";
    FakeContext.resumeRejects = true;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    playDing();
    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(FakeContext.created[0].oscillators).toBe(0);
  });

  it("an engine without createBuffer still gets a context and a chime", async () => {
    FakeContext.bufferThrows = true;
    const { unlockAudio, playDing } = await load();
    expect(() => unlockAudio()).not.toThrow();
    FakeContext.created[0].state = "running";
    playDing();
    expect(FakeContext.created[0].oscillators).toBe(4);
  });
});

describe("notifications, as on an iPhone in a Safari tab", () => {
  it("Notification is undefined there: asking and notifying are no-ops", async () => {
    vi.stubGlobal("Notification", undefined);
    const { requestNotifications, notify } = await load();
    await expect(requestNotifications()).resolves.toBeUndefined();
    await expect(notify("t", "b")).resolves.toBeUndefined();
  });

  it("once the app is installed and permission granted, it shows through the service worker", async () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    const showNotification = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ showNotification }) } });
    const { notify } = await load();
    await notify("Bangkok Transit", "Siam is your station");
    expect(showNotification).toHaveBeenCalledWith("Bangkok Transit", expect.objectContaining({ body: "Siam is your station", tag: "stop-alert" }));
  });

  it("denied permission shows nothing", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    const showNotification = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ showNotification }) } });
    const { notify } = await load();
    await notify("t", "b");
    expect(showNotification).not.toHaveBeenCalled();
  });
});

describe("holdScreenAwake", () => {
  const doc = () => {
    const listeners = new Map<string, () => void>();
    return {
      hidden: false,
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      listeners,
    };
  };

  it("without the Wake Lock API (iOS before 16.4) it is a harmless no-op", async () => {
    vi.stubGlobal("document", doc());
    const { holdScreenAwake } = await load();
    const release = holdScreenAwake();
    expect(() => release()).not.toThrow();
  });

  it("takes the lock, retakes it when the page returns to the foreground, and lets go on release", async () => {
    const d = doc();
    vi.stubGlobal("document", d);
    const sentinels: { release: ReturnType<typeof vi.fn> }[] = [];
    const request = vi.fn(async () => {
      const s = { release: vi.fn(async () => {}) };
      sentinels.push(s);
      return s;
    });
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const { holdScreenAwake } = await load();
    const release = holdScreenAwake();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    // iOS and Android drop the lock when the page is hidden; coming back must take it again.
    d.listeners.get("visibilitychange")?.();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);

    release();
    expect(sentinels[1].release).toHaveBeenCalled();
    expect(d.listeners.has("visibilitychange")).toBe(false);
  });

  it("a denied lock (low battery) is not an error", async () => {
    vi.stubGlobal("document", doc());
    vi.stubGlobal("navigator", { wakeLock: { request: async () => Promise.reject(new DOMException("battery", "NotAllowedError")) } });
    const { holdScreenAwake } = await load();
    expect(() => holdScreenAwake()()).not.toThrow();
  });
});
