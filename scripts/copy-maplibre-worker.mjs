// MapLibre GL JS loads its tile-parsing worker via
// `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url))`, a
// pattern neither Turbopack (dev) nor webpack (prod, via this project's
// `next build --webpack`) resolves correctly from inside node_modules - the
// request 404s and Next serves its HTML fallback for it, so the worker
// script silently never loads and no tiles are ever requested (no error
// surfaces because Worker construction failures don't propagate to the
// map's own 'error' event).
//
// Fix: serve the worker (and the shared chunk it imports) as plain static
// files from /public, and point maplibregl.setWorkerUrl() at that path
// instead of relying on the bundler. Regenerated on every `npm install` via
// the "postinstall" script so it can't silently drift from the installed
// maplibre-gl version.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules/maplibre-gl/dist");
const dest = join(root, "public/maplibre");

mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log("Copied maplibre-gl worker files to public/maplibre/");
