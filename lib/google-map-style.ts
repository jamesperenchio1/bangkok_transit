/**
 * Styling for Google's own basemap, so it reads as a quiet backdrop for our
 * lines and stations instead of competing with them. The network is ours:
 * Google's transit stations and lines, and its business pins, are switched off
 * (they would duplicate and clutter our markers); roads and areas stay. Dark
 * mode swaps the palette, since Google does not follow our theme on its own.
 *
 * These are JSON `styles` for a raster map. They are ignored when a Map ID is
 * set, which is why the app does not set one.
 */

type Style = google.maps.MapTypeStyle;

const hide = (featureType: string, elementType = "all"): Style => ({
  featureType,
  elementType,
  stylers: [{ visibility: "off" }],
});

const DARK: Style[] = [
  { elementType: "geometry", stylers: [{ color: "#1f2430" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa3b2" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1f2430" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#3a4150" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#232a36" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1d3326" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#323a4a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1f2430" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#46506a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1a2b" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#566581" }] },
];

export function googleMapStyles(opts: { dark: boolean; basemapLabels: boolean }): Style[] {
  const styles: Style[] = [
    ...(opts.dark ? DARK : []),
    // Our own stations and lines replace these.
    hide("transit"),
    // Pins and their names only: parks and other areas keep their colour.
    hide("poi", "labels"),
    // Road shields and the like add noise without helping find a station.
    hide("road", "labels.icon"),
  ];
  if (!opts.basemapLabels) styles.push(hide("all", "labels"));
  return styles;
}
