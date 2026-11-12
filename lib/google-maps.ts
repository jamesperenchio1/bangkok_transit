"use client";

/**
 * The Google Maps JavaScript API is only ever downloaded when the rider picks
 * Google in Settings. Default (Standard) users make no Google requests, which
 * keeps the map offline-capable and keeps the free tier untouched.
 */
type GoogleNamespace = typeof google;

export function googleMapsKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
}

export function googleMapsMapId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "";
}

let loader: Promise<GoogleNamespace> | null = null;

export function loadGoogleMaps(): Promise<GoogleNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps needs a browser"));
  }
  const existing = (window as unknown as { google?: GoogleNamespace }).google;
  if (existing?.maps) return Promise.resolve(existing);
  if (loader) return loader;

  const key = googleMapsKey();
  if (!key) return Promise.reject(new Error("Missing Google Maps API key"));

  loader = new Promise<GoogleNamespace>((resolve, reject) => {
    // `loading=async` fires the script load event before `importLibrary`
    // exists, so wait for the documented callback instead.
    const callbackName = "__bangkokGoogleMapsReady";
    const globals = window as unknown as Record<string, unknown>;
    globals[callbackName] = () => {
      delete globals[callbackName];
      const googleNamespace = (window as unknown as { google?: GoogleNamespace }).google;
      if (!googleNamespace?.maps) {
        loader = null;
        reject(new Error("Google Maps did not initialise"));
        return;
      }
      resolve(googleNamespace);
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=marker&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      loader = null;
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(script);
  });

  return loader;
}
