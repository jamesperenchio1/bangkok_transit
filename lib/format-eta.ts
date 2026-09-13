export function minutesLabel(minutes?: number): string {
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
 * so a stale cached read still shows the time that data actually implied.
 */
export function arrivalClockTime(fromIso: string, etaMinutes?: number): string | null {
  if (etaMinutes === undefined || etaMinutes === null) return null;
  const from = Date.parse(fromIso.endsWith("Z") ? fromIso : `${fromIso}Z`);
  if (Number.isNaN(from)) return null;
  return bangkokClock.format(new Date(from + etaMinutes * 60_000));
}
