# Bangkok Transit — Agent Guide

## Project Conventions

- **Framework**: Next.js 16 App Router, React 19, TypeScript.
- **Styling**: Tailwind CSS v4 + shadcn/ui Base UI components.
- **Data**: All transit data lives in `data/canonical/` as JSON. Schemas are in `data/schemas/` (Zod).
- **i18n**: English native UI, full Thai support via `lib/i18n.ts` + `LanguageProvider`. Add keys to both `en` and `th` dictionaries.
- **PWA**: Serwist service worker in `app/sw.ts`. Production build uses webpack (`npm run build` → `next build --webpack`).
- **Components**: Client components go in `components/`, server pages in `app/`. Prefix client components with `"use client"`.
- **Icons**: Use `lucide-react`.
- **Maps**: Real map via Leaflet + React-Leaflet. Load dynamically with `ssr: false`.
- **State**: Use Zustand for global client state; React context only for language/theme.

## Build & Test

```bash
npm install
npm run dev       # dev server (Turbopack, Serwist disabled)
npm run build     # production build with webpack + Serwist
npm start         # serve production build
```

## Adding Data

1. Update the relevant JSON file in `data/canonical/`.
2. If the schema changes, update `data/schemas/index.ts`.
3. Run `npm run build` to validate TypeScript/static generation.
4. Prefer manual overrides in `data/overrides/` (create dir when needed) over editing scraped raw data.

## Notes

- Keep everything free-tier friendly (Vercel hobby, GitHub Actions free minutes).
- Do not hardcode transit network topology in components — use the data files.
- Avoid AI assistant features; route planner is rule-based.
