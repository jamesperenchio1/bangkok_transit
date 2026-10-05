export function minutesLabel(minutes?: number | null): string {
  if (minutes === undefined || minutes === null) return "—";
  if (minutes <= 0) return "Arriving";
  return `${minutes} min`;
}

const bangkokClock = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

/**
 * Wall-clock arrival time in Bangkok, computed from the payload's own
 * fetch timestamp plus the reported ETA - not from the client's clock,
 * so a cached read still shows the time that data actually implied.
 */
export function arrivalClockTime(fromIso: string, etaMinutes?: number): string | null {
  if (etaMinutes === undefined || etaMinutes === null) return null;
  const from = parseUtc(fromIso);
  if (Number.isNaN(from)) return null;
  return bangkokClock.format(new Date(from + etaMinutes * 60_000));
}

function parseUtc(iso: string): number {
  return Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
}

/**
 * Minutes until a train arrives, counted down against the current clock
 * rather than frozen at the moment the payload was fetched - between polls a
 * fixed "2 min" drifts up to a minute and a half out of date. Uses
 * `eta_precise` (fractional minutes) when present. Returns null when the
 * time can't be computed, and a negative number once the train has gone.
 */
export function minutesUntil(
  fromIso: string,
  train: { eta_minutes?: number; eta_precise?: number },
  now: number,
): number | null {
  const eta = train.eta_precise ?? train.eta_minutes;
  if (eta === undefined || eta === null) return null;
  const from = parseUtc(fromIso);
  if (Number.isNaN(from)) return null;
  return Math.floor((from + eta * 60_000 - now) / 60_000);
}

/**
 * A train whose arrival time has passed according to the live countdown.
 * (minutesUntil floors, so anything past the arrival moment is negative.)
 */
export function hasDeparted(minutesLeft: number | null): boolean {
  return minutesLeft !== null && minutesLeft < 0;
}

/** "just now" / "40s ago" / "3 min ago" for the payload's own fetch time. */
export function updatedAgoLabel(fromIso: string, now: number): string {
  const from = parseUtc(fromIso);
  if (Number.isNaN(from)) return "";
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}
