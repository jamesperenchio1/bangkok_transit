/**
 * The ways an alert reaches the rider: a synthesised chime (no audio file to
 * ship or cache, nothing for the CSP to allow), vibration, a system
 * notification where permitted, and a screen wake lock. Every call is
 * best-effort - a device missing one of these just gets the others.
 */

let audio: AudioContext | null = null;

/**
 * Browsers only let audio start after a tap, so this is called from the tap
 * that turns the alert on. The context then stays usable for later chimes,
 * which fire from a GPS update rather than from a tap.
 */
export function unlockAudio(): void {
  try {
    // iOS treats Web Audio as "ambient" and mutes it when the ringer switch is
    // on silent. An alert has to be heard, so ask for a playback session
    // (Safari 16.4+; elsewhere the property doesn't exist).
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  } catch {
    // not supported
  }
  try {
    // iOS can close the context behind our back (e.g. after a phone call), and
    // a closed one never plays again.
    if (!audio || audio.state === "closed") audio = new AudioContext();
    void audio.resume();
    // Older iOS only unlocks output once something has played inside the tap.
    const silence = audio.createBufferSource();
    silence.buffer = audio.createBuffer(1, 1, 22050);
    silence.connect(audio.destination);
    silence.start(0);
  } catch {
    // no Web Audio: vibration and the on-screen alert still work
  }
  unlockMedia();
}

export interface ChimeOptions {
  /** 0-1; the chime's loudness before the phone's own volume. */
  volume?: number;
  /** How many times the ding-dong repeats. */
  repeats?: number;
}

/** What happened when a chime was asked for, so "Test sound" can say so instead of staying silent. */
export interface ChimeStatus {
  /** The Web Audio context's state when the chime was scheduled (null: no Web Audio). */
  webAudio: AudioContextState | null;
  /** The media-element copy: played, refused by the browser, or not available here. */
  media: "played" | "blocked" | "unsupported";
}

const DEFAULTS = { volume: 0.6, repeats: 2 };
const PAIR_MS = 0.9;
const NOTES: [number, number][] = [
  [988, 0],
  [1319, 0.28],
];

/** The quietest the envelope gets (-80 dB), standing in for silence since an exponential never reaches 0. */
const FLOOR = 0.0001;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function resolve(options?: ChimeOptions) {
  return {
    volume: clamp(options?.volume ?? DEFAULTS.volume, 0.05, 1),
    repeats: Math.round(clamp(options?.repeats ?? DEFAULTS.repeats, 1, 5)),
  };
}

/**
 * The chime as a WAV file, built in code (no asset to ship, cache or allow in
 * the CSP beyond `media-src blob:`). Played through an <audio> element it
 * follows the phone's *media* rules: on an iPhone that means it is heard with
 * the ringer switch on silent, where Web Audio alone can be muted.
 */
export function chimeWav(options?: ChimeOptions): Uint8Array {
  const { volume, repeats } = resolve(options);
  const rate = 22_050;
  const seconds = PAIR_MS * (repeats - 1) + NOTES[NOTES.length - 1][1] + 0.75;
  const samples = Math.ceil(seconds * rate);
  const mix = new Float32Array(samples);
  for (let r = 0; r < repeats; r++) {
    for (const [freq, offset] of NOTES) {
      const start = Math.floor((r * PAIR_MS + offset) * rate);
      const length = Math.floor(0.75 * rate);
      for (let i = 0; i < length && start + i < samples; i++) {
        const t = i / rate;
        // The Web Audio chime's envelope, sample for sample: 20 ms exponential
        // attack from the floor to full, then an exponential fade back to it.
        // The attack must END at the level the fade STARTS from. It once ended
        // at 1.0 and the fade began at 0.6, so the signal dropped 40% in one
        // sample at 20 ms into every note: a tick, four times a chime.
        const env = t < 0.02 ? Math.pow(FLOOR, 1 - t / 0.02) : Math.pow(FLOOR, (t - 0.02) / 0.68);
        mix[start + i] += Math.sin(2 * Math.PI * freq * t) * env;
      }
    }
  }
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, clamp(mix[i] * volume, -1, 1) * 0x7fff, true);
  return bytes;
}

let mediaEl: HTMLAudioElement | null = null;
/** Bumped by every real play, so a still-pending silent unlock knows it must not pause the chime. */
let playToken = 0;
let mediaKey = "";
let mediaUrl = "";

/** The <audio> element holding the current chime; rebuilt only when volume/repeats change. */
function chimeElement(options?: ChimeOptions): HTMLAudioElement | null {
  if (typeof Audio === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return null;
  const { volume, repeats } = resolve(options);
  const key = `${volume}|${repeats}`;
  if (!mediaEl) mediaEl = new Audio();
  if (key !== mediaKey) {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = URL.createObjectURL(new Blob([chimeWav({ volume: volume * 0.8, repeats }) as BlobPart], { type: "audio/wav" }));
    mediaEl.src = mediaUrl;
    mediaKey = key;
  }
  return mediaEl;
}

/** Called from the same tap as unlockAudio: lets the element play later, from a GPS update. */
function unlockMedia(): void {
  try {
    const el = chimeElement();
    if (!el) return;
    const token = playToken;
    el.muted = true;
    void el.play().then(
      () => {
        // A real chime started in the meantime (the same tap): leave it playing.
        if (token !== playToken) return;
        el.pause();
        el.currentTime = 0;
        el.muted = false;
      },
      () => {
        if (token === playToken) el.muted = false;
      },
    );
  } catch {
    // no media playback: Web Audio and vibration still work
  }
}

/** A bright two-note "ding-dong", repeated so it's noticed over train noise. */
export function playDing(options?: ChimeOptions): Promise<ChimeStatus> {
  const status: ChimeStatus = { webAudio: audio ? audio.state : null, media: "unsupported" };
  if (audio) {
    const ctx = audio;
    // A suspended context has a frozen clock: wait until it's running so the
    // notes aren't scheduled against a time that never advances.
    if (ctx.state === "running") ring(ctx, options);
    else void ctx.resume().then(() => ring(ctx, options), () => {});
  }
  try {
    const el = chimeElement(options);
    if (!el) return Promise.resolve(status);
    playToken++;
    el.muted = false;
    el.currentTime = 0;
    return el.play().then(
      () => ({ ...status, media: "played" as const }),
      () => ({ ...status, media: "blocked" as const }),
    );
  } catch {
    return Promise.resolve(status);
  }
}

function ring(ctx: AudioContext, options?: ChimeOptions): void {
  const { volume, repeats } = resolve(options);
  const start = ctx.currentTime + 0.02;
  for (let r = 0; r < repeats; r++) {
    for (const [freq, offset] of NOTES) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = start + r * PAIR_MS + offset;
      gain.gain.setValueAtTime(FLOOR, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(FLOOR, t + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    }
  }
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([300, 120, 300, 120, 600]);
  } catch {
    // unsupported (iOS Safari)
  }
}

/** Asks for notification permission; only ever called from the tap that enables alerts. */
export async function requestNotifications(): Promise<void> {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    // not available
  }
}

/** Via the service worker, which is the only way mobile browsers show one. */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.showNotification(title, { body, tag: "stop-alert", icon: "/icons/icon-192.png" });
  } catch {
    // best effort
  }
}

/** Keeps the screen on while a trip is being watched: the page can't track GPS once it's asleep. */
export function holdScreenAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let released = false;
  const acquire = async () => {
    try {
      if (released || document.hidden || !navigator.wakeLock) return;
      lock = await navigator.wakeLock.request("screen");
    } catch {
      // denied, e.g. low battery
    }
  };
  const onVisible = () => {
    if (!document.hidden) void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);
  void acquire();
  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisible);
    void lock?.release().catch(() => {});
  };
}
