import type { Locator, Page } from "@playwright/test";
import { expect, forgiveNetworkErrors, liveDocument, serveArrivals, test } from "./fixtures";
import type { Platform } from "./alert-devices";

/**
 * The station alert on every phone in e2e/alert-devices.ts (iPhone Safari and
 * Chrome first, the iPhone range, Android, desktop last).
 *
 * Headless browsers can't be *heard*, and they can't flip an iPhone's silent
 * switch - so these tests watch the things that decide whether a rider hears
 * it: that the audio context is created and resumed inside a tap, that it is
 * "running" when the notes are scheduled (the 2025 bug: a suspended or closed
 * context plays nothing), that the iOS playback session was requested, and
 * that vibration is used only where the device has it. The silent switch and
 * real volume are on the manual checklist in docs/operations.md.
 */

interface Probe {
  tapActive: boolean;
  resumes: { inTap: boolean; stateBefore: string }[];
  notes: { freq: number; state: string }[];
  vibrations: { pattern: unknown; everTapped: boolean | null }[];
}
type ProbeWindow = Window & { __probe: Probe; __contexts: AudioContext[] };

/** Records what the page does with Web Audio and vibration, then lets it happen for real. */
function installProbe() {
  const w = window as unknown as ProbeWindow;
  const probe: Probe = { tapActive: false, resumes: [], notes: [], vibrations: [] };
  w.__probe = probe;
  w.__contexts = [];

  // A tap is "active" for the synchronous run of its handlers: React's run
  // inside the click dispatch, the timer fires after.
  window.addEventListener(
    "click",
    () => {
      probe.tapActive = true;
      setTimeout(() => (probe.tapActive = false), 0);
    },
    true,
  );

  const Native = window.AudioContext;
  const nativeResume = Native.prototype.resume;
  Native.prototype.resume = function (this: AudioContext) {
    probe.resumes.push({ inTap: probe.tapActive, stateBefore: this.state });
    return nativeResume.call(this);
  };
  class Probed extends Native {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      w.__contexts.push(this);
    }
  }
  window.AudioContext = Probed;

  const nativeStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (this: OscillatorNode, when?: number) {
    probe.notes.push({ freq: this.frequency.value, state: this.context.state });
    return nativeStart.call(this, when);
  };

  if (typeof navigator.vibrate === "function") {
    const nativeVibrate = navigator.vibrate.bind(navigator);
    navigator.vibrate = (pattern: VibratePattern | Iterable<number>) => {
      const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
      probe.vibrations.push({ pattern, everTapped: activation?.hasBeenActive ?? null });
      return nativeVibrate(pattern as VibratePattern);
    };
  }
}

/**
 * `navigator.audioSession` is Apple's API: real iPhone Safari has it (16.4+),
 * but the WebKit that Playwright ships for Linux/CI does not, even though the
 * iPhone profiles run it. Without this, the "playback session" test below could
 * only ever skip its check on CI (or, as it used to, fail). So on iPhone
 * profiles whose engine lacks the API, provide the same object a real iPhone
 * has - type "auto" until the page sets it - and let the test assert that the
 * app really asks for "playback". Real Safari behaviour stays on the phone
 * checklist in docs/operations.md.
 */
function installAudioSessionStandIn() {
  if ("audioSession" in navigator) return;
  Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } });
}

const CHIME = [988, 1319, 988, 1319];
const BUZZ = [300, 120, 300, 120, 600];

const platformOf = () => test.info().project.metadata.platform as Platform;

/** A finger on phones (touch events, as on a real device), a mouse on desktop. */
const press = (target: Locator) => (platformOf() === "desktop" ? target.click() : target.tap());

const probe = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).__probe);

/** Route sheet open, alerts on, options expanded - the state a rider is in before "Test sound". */
async function alertOptions(page: Page) {
  await page.goto("/?from=N8&to=CEN");
  await press(page.getByRole("button", { name: "View route" }));
  const sheet = page.getByRole("dialog", { name: /Route from/ });
  await press(sheet.getByRole("switch", { name: /Alert me near my stop/ }));
  await expect(sheet.getByRole("switch", { name: /Alert me near my stop/ })).toHaveAttribute("aria-checked", "true");
  await press(sheet.getByRole("button", { name: "Alert options" }));
  return sheet;
}

test.describe("station alert on phones", () => {
  // Chromium and WebKit with software GL are slow to start on a busy machine or
  // a small CI runner; page setup alone has used most of the default 60s.
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, context }) => {
    await serveArrivals(page, liveDocument);
    // The alert has nothing to do with the basemap, and rendering it in software
    // GL is the heaviest thing on the page: across 28 phone profiles that starves
    // taps and times tests out. Without the basemap the app draws the network on
    // its plain fallback background (components/TransitMap.tsx), a real path.
    await page.route("https://tiles.openfreemap.org/**", (route) => route.abort("failed"));
    await page.addInitScript(installProbe);
    if (platformOf() === "ios") await page.addInitScript(installAudioSessionStandIn);
    await context.setGeolocation({ latitude: 13.8021, longitude: 100.5535 }); // Mo Chit, far from Siam
  });

  // The blocked basemap logs browser "Failed to load resource" errors; those are
  // the scenario, not defects. Page errors and CSP violations still fail the test.
  test.afterEach(({ problems }) => forgiveNetworkErrors(problems));

  test("turning alerts on unlocks audio inside the tap", async ({ page }) => {
    await alertOptions(page);
    const p = await probe(page);
    expect(p.resumes.length, "the context was asked to resume").toBeGreaterThan(0);
    expect(p.resumes[0].inTap, "...from inside the tap, the only place iOS allows it").toBe(true);
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__contexts.length)).toBe(1);
    expect(p.notes, "enabling must not chime on its own").toEqual([]);
  });

  test("Test sound plays the whole chime on a running context", async ({ page }) => {
    const sheet = await alertOptions(page);
    await press(sheet.getByRole("button", { name: "Test sound" }));

    await expect.poll(async () => (await probe(page)).notes.length).toBe(CHIME.length);
    const p = await probe(page);
    expect(p.notes.map((n) => n.freq)).toEqual(CHIME);
    expect(p.notes.map((n) => n.state), "scheduled on a running context, not a frozen one").toEqual(CHIME.map(() => "running"));
    expect(p.resumes.at(-1)?.inTap, "Test sound resumed the context inside its own tap").toBe(true);
  });

  test("Test sound still rings after iOS suspends the audio (lock screen, call, Siri)", async ({ page }) => {
    const sheet = await alertOptions(page);
    await page.evaluate(() => (window as unknown as ProbeWindow).__contexts[0].suspend());
    await expect
      .poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__contexts[0].state))
      .toBe("suspended");

    await press(sheet.getByRole("button", { name: "Test sound" }));

    await expect.poll(async () => (await probe(page)).notes.length).toBe(CHIME.length);
    expect((await probe(page)).notes.map((n) => n.state)).toEqual(CHIME.map(() => "running"));
  });

  test("Test sound still rings after the system closes the audio context", async ({ page }) => {
    const sheet = await alertOptions(page);
    await page.evaluate(() => (window as unknown as ProbeWindow).__contexts[0].close());

    await press(sheet.getByRole("button", { name: "Test sound" }));

    await expect.poll(async () => (await probe(page)).notes.length).toBe(CHIME.length);
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__contexts.length), "a fresh context replaced the closed one").toBe(2);
  });

  test("asks iOS for a playback session so the silent switch can't mute the alert", async ({ page }) => {
    const sheet = await alertOptions(page);
    await press(sheet.getByRole("button", { name: "Test sound" }));
    const type = await page.evaluate(() => (navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type ?? null);
    if (platformOf() === "ios") {
      // Always present on iPhone profiles (real, or the stand-in above), so this
      // is a real check, never a skip.
      expect(type, "the app asked iOS for a playback session").toBe("playback");
    } else if (type === null) {
      // Android and desktop engines without the API just play; there is no
      // silent-switch problem to ask about.
      test.info().annotations.push({ type: "note", description: "navigator.audioSession not exposed by this engine" });
    } else {
      expect(type).toBe("playback");
    }
  });

  test("arriving rings the chime and vibrates only where the phone can", async ({ page, context }) => {
    await alertOptions(page);
    const hasVibrate = await page.evaluate(() => typeof navigator.vibrate === "function");
    // Facts about the platforms, so a Playwright update that changes them is noticed.
    if (platformOf() === "ios") expect(hasVibrate, "iPhone browsers have no Vibration API").toBe(false);
    if (platformOf() === "android") expect(hasVibrate, "Android Chrome and Samsung Internet vibrate").toBe(true);

    // The GPS fix that triggers the alert is not a tap: the context unlocked
    // earlier has to still be running.
    await context.setGeolocation({ latitude: 13.7457, longitude: 100.5342 }); // Siam
    await expect(page.getByRole("alert").filter({ hasText: /Siam is your station/ })).toBeVisible();

    await expect.poll(async () => (await probe(page)).notes.length).toBe(CHIME.length);
    const p = await probe(page);
    expect(p.notes.map((n) => n.freq)).toEqual(CHIME);
    expect(p.notes.every((n) => n.state === "running")).toBe(true);

    if (hasVibrate) {
      expect(p.vibrations).toHaveLength(1);
      expect(p.vibrations[0].pattern).toEqual(BUZZ);
      // Chrome ignores vibrate() until the page has been tapped once.
      expect(p.vibrations[0].everTapped).not.toBe(false);
    } else {
      expect(p.vibrations).toEqual([]);
    }
  });

  test("Sound and Vibrate switched off keep the alert silent but still shown", async ({ page, context }) => {
    const sheet = await alertOptions(page);
    await press(sheet.getByRole("checkbox", { name: "Sound" }));
    await press(sheet.getByRole("checkbox", { name: "Vibrate" }));
    await expect(sheet.getByRole("checkbox", { name: "Sound" })).not.toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: "Vibrate" })).not.toBeChecked();

    await context.setGeolocation({ latitude: 13.7457, longitude: 100.5342 });
    await expect(page.getByRole("alert").filter({ hasText: /Siam is your station/ })).toBeVisible();
    await page.waitForTimeout(500); // outputs run in the same effect as the banner; leave room for a stray one
    const p = await probe(page);
    expect(p.notes).toEqual([]);
    expect(p.vibrations).toEqual([]);
  });

  test("the Test sound button fits the screen and is a full-size tap target", async ({ page }) => {
    const sheet = await alertOptions(page);
    const button = sheet.getByRole("button", { name: "Test sound" });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "no sideways scroll").toBeLessThanOrEqual(0);
  });
});
