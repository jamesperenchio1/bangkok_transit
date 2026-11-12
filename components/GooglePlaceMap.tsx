"use client";

import { useState } from "react";
import { googleMapsKey } from "@/lib/google-maps";
import type { Place } from "@/lib/google-places";

/**
 * A small, non-interactive Google map for a place card. Static Maps is a
 * single image request (and a single billable event), so opening a place
 * never pulls the Maps JavaScript bundle into the default MapLibre view.
 */
export function GooglePlaceMap({ place }: { place: Place }) {
  const [failed, setFailed] = useState(false);
  const key = googleMapsKey();
  if (!key || failed) return null;
  const src =
    `https://maps.googleapis.com/maps/api/staticmap?center=${place.lat},${place.lon}` +
    `&zoom=15&size=300x140&scale=2&markers=color:0x16a34a%7C${place.lat},${place.lon}` +
    `&key=${encodeURIComponent(key)}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={300}
      height={140}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      onError={() => setFailed(true)}
      className="w-full rounded-md border border-neutral-200 object-cover dark:border-neutral-700"
    />
  );
}
