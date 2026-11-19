import { expect, mapReady, test } from "./fixtures";

// Three fixes along Rama I Road, 30 m apart, delivered like a phone's: one
// now, then one a second as the rider walks. The old hook swallowed all of
// these (under 5 m of movement), which is why the dot looked stuck.
const FIXES = [
  { lat: 13.7466, lon: 100.5349 },
  { lat: 13.7466, lon: 100.5352 },
  { lat: 13.7466, lon: 100.5355 },
];

test("the position dot follows every fix", async ({ page }) => {
  await page.addInitScript((fixes) => {
    const geo = navigator.geolocation;
    let i = 0;
    let timer: number | undefined;
    geo.watchPosition = (success: PositionCallback) => {
      const emit = () => {
        const f = fixes[Math.min(i, fixes.length - 1)];
        success({
          coords: {
            latitude: f.lat,
            longitude: f.lon,
            accuracy: 8,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
      };
      emit();
      // Keep walking: the assertion compares two reads, whenever they land.
      timer = window.setInterval(() => {
        i = (i + 1) % fixes.length;
        emit();
      }, 500);
      return 1;
    };
    geo.clearWatch = () => window.clearInterval(timer);
  }, FIXES);

  await page.goto("/");
  await mapReady(page);

  const dot = () =>
    page.evaluate(`(() => {
      const m = window.__map;
      return m.getSource("gps-position") ? (m.querySourceFeatures("gps-position")[0]?.geometry.coordinates ?? null) : null;
    })()`) as Promise<[number, number] | null>;

  await expect.poll(dot, { timeout: 15_000 }).not.toBeNull();
  const first = await dot();
  await expect.poll(dot, { timeout: 15_000 }).not.toEqual(first);

  // And the rider is told which station is nearest once the fix has settled.
  await expect(page.getByRole("button", { name: /Nearest: Siam/ })).toBeVisible();
});
