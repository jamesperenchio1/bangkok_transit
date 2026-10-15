# scripts/

| Script | When it runs | What it does |
| --- | --- | --- |
| `copy-maplibre-worker.mjs` | every `npm install` (postinstall) | Copies MapLibre's worker into `public/maplibre/` — bundlers can't resolve it from `node_modules`. |
| `check-live.mjs` | `npm run check:live`, and every 30 min in GitHub Actions | Health check of production: site headers, the live document's CORS/caching headers, data freshness, upstream status. |
| `build-icons.mjs` | by hand, after editing `public/icons/icon.svg` | Renders the PWA/Apple icons with Playwright's Chromium. |
| `fetch-transit-network.ts` | by hand, when a line or station opens | Downloads station points and line geometry from BMA's public ArcGIS service into `data/raw/`. |
| `build-line-geometry.ts` | by hand, after a fetch | Turns `data/raw/bma-lines.geojson` into `public/line-geometry.json` (the curved track the map draws). Reproducible: re-running it on the committed raw data produces an identical file. |

Run the TypeScript ones with `node --experimental-strip-types scripts/<name>.ts`.

## One-time migration scripts

`build-stations.ts`, `fill-english-names.ts` and `finalize-stations.ts` are the
history of how `data/stations.json` was first assembled from the BMA data (the
GIS source has Thai names only, tags Siam with one of its two lines, includes
under-construction Orange Line stations, and so on — each script's header has
the details). They edit `data/stations.json` in place and are **not
idempotent**; don't re-run them.

Today `data/stations.json`, `data/line-sequences.json` and
`data/interchanges.json` are maintained by hand and protected by
`tests/data.test.ts`. To add a station or line:

1. Add the station to `data/stations.json` with real `lat`/`lon` and both names.
2. Put its code in the right place in that line's segment in
   `data/line-sequences.json` (a branch is another segment that shares a
   station with the line; see the Pink and SRT Red entries).
3. If it's a walkable interchange with another line's separate station, add
   the pair to `data/interchanges.json`.
4. If it opened with new track, re-run the fetch and `build-line-geometry.ts`.
5. `npm test` — the data tests catch unknown codes, stations missing from
   their line, implausible hops and nearby stations missing an interchange.
