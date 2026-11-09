/**
 * "The network is on screen." The map component calls `markMapPainted()` once
 * its first view has finished drawing (the lines, the stations and the
 * basemap tiles for that view). Everything that is not the map - the live
 * arrivals poll, the offline-map download - waits on `whenMapPainted()`, so
 * on a slow connection the bytes go to the lines and the basemap first and the
 * rest follows.
 *
 * Kept out of the map's own module on purpose: that one pulls in all of
 * MapLibre, and the page must be able to wait on this without importing it.
 */

let markPainted: () => void = () => {};
let painted = false;
const paintedPromise = new Promise<void>((resolve) => {
  markPainted = () => {
    painted = true;
    resolve();
  };
});

/** Called by the map once its first view is drawn. Safe to call more than once. */
export function markMapPainted(): void {
  markPainted();
}

/**
 * Resolves when the map has painted, or after `maxWaitMs`, whichever is
 * first. The cap matters: if the basemap host hangs, the map can stay "not
 * idle" for a long time, and live times must not wait forever behind it.
 */
export function whenMapPainted(maxWaitMs = 8_000): Promise<void> {
  if (painted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, maxWaitMs);
    void paintedPromise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
