# Bangkok Transit

Tap a station on a real interactive map (BTS, MRT, Gold, Yellow, Pink,
Airport Rail Link, SRT Red) to set your route start, tap another for your
destination, confirm to see the path highlighted with transfers. Shows your
live location on the map.

## Setup

```bash
npm install
cp .env.example .env.local  # optional: Upstash Redis caching
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

See [AGENTS.md](./AGENTS.md) for architecture and conventions.
