# Bangkok Transit

Tap a BTS station on the network map, see its live arrival times.

## Setup

```bash
npm install
cp .env.example .env.local  # optional: Upstash Redis caching
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## The map image

The app needs `public/bts-map.jpg` — the official-style BTS/MRT network
diagram — to render the tappable station map. Station hitboxes in
`data/stations.json` are positioned in pixel coordinates matching that
specific image file; if the image changes, coordinates need remeasuring.

See [AGENTS.md](./AGENTS.md) for architecture and conventions.
