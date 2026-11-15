/**
 * The app's motion vocabulary in one place, so the sheet, the cards, the
 * camera and the route line all move the same way. Durations here are the
 * design values; wrap them in `motionDuration()` (lib/settings-store.ts) at
 * the point of use so reduced-motion turns them into instant changes.
 * The CSS side of the same system is `--ease-out` in app/globals.css.
 */

/** easeOutExpo: fast start, long soft landing. Used for JS-driven animation. */
export const easeOut = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** The route line travelling from origin to destination. */
export const ROUTE_DRAW_MS = 700;

/** How long a station card stays after Start/Destination is tapped, so its tick is seen. */
export const CARD_LINGER_MS = 380;
