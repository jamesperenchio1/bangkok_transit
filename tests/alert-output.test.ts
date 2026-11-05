import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// alert-output keeps its AudioContext at module level, so each test loads a
// fresh copy against its own fake Web Audio.
class FakeContext {
  static created: FakeContext[] = [];
  state: "running" | "suspended" | "closed" = "suspended";
  currentTime = 0;
  destination = {};
  oscillators = 0;
  constructor() {
    FakeContext.created.push(this);
  }
  resume() {
    if (this.state !== "closed") this.state = "running";
    return Promise.resolve();
  }
  createGain() {
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    const node = { gain: param, connect: (next: unknown) => next };
    return node;
  }
  createOscillator() {
    this.oscillators++;
    return { type: "", frequency: { value: 0 }, connect: (next: unknown) => next, start() {}, stop() {} };
  }
  createBuffer() {
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

beforeEach(() => {
  FakeContext.created = [];
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
});
