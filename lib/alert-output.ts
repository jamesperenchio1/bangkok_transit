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
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // no Web Audio: vibration and the on-screen alert still work
  }
}

/** A bright two-note "ding-dong", repeated so it's noticed over train noise. */
export function playDing(): void {
  if (!audio) return;
  const ctx = audio;
  const start = ctx.currentTime + 0.02;
  const notes: [number, number][] = [
    [988, 0],
    [1319, 0.28],
    [988, 0.9],
    [1319, 1.18],
  ];
  for (const [freq, offset] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.75);
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
