/** "250 m" / "1.2 km", rounded to what's worth saying for a walk. */
export function distanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}
