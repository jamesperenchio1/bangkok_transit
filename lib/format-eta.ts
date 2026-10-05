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
 * How long past its predicted arrival a train keeps showing as "Arriving"
 * before it's treated as gone. Covers the time it sits at the platform, and
 * the fact that data is normally 20-45s old by the time it reaches a phone -
 * a train reported "0 min" is usually still at the platform then.
 */
const PLATFORM_GRACE_MS = 60_000;

/**
 * A train's live countdown against the current clock, rather than frozen at
 * the moment the payload was fetched - between polls a fixed "2 min" drifts
 * out of date. Uses `eta_precise` (fractional minutes) when present.
 * `minutes` never goes below 0 ("Arriving"); `departed` turns true once the
 * train is past PLATFORM_GRACE_MS beyond its predicted arrival. Null when
 * the time can't be computed.
 */
export function trainCountdown(
  fromIso: string,
  train: { eta_minutes?: number; eta_precise?: number },
  now: number,
): { minutes: number; departed: boolean } | null {
  const eta = train.eta_precise ?? train.eta_minutes;
  if (eta === undefined || eta === null) return null;
  const from = parseUtc(fromIso);
  if (Number.isNaN(from)) return null;
  const msLeft = from + eta * 60_000 - now;
  return { minutes: Math.max(0, Math.floor(msLeft / 60_000)), departed: msLeft < -PLATFORM_GRACE_MS };
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
