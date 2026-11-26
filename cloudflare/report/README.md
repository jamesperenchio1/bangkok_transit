# Report intake Worker

The site is static, so reports cannot be stored by the site itself. This
Worker is the optional one-tap delivery behind the report sheet.

It is **off by default**: the Send button only appears when
`NEXT_PUBLIC_REPORT_URL` is set at build time (for example
`https://reports.bangkok-transit.com`). Without it the sheet keeps its
existing copy / email / save behaviour.

## Deploy

```bash
cd cloudflare/report
npx wrangler r2 bucket create bangkok-transit-reports
npx wrangler deploy
```

Then point a custom domain at the Worker (e.g. `reports.bangkok-transit.com`)
and set the build variable on the site's Workers Build:

```
NEXT_PUBLIC_REPORT_URL=https://reports.bangkok-transit.com
```

Add `https://reports.bangkok-transit.com` to `connect-src` in
`public/_headers` if the hostname changes (already present for the default).

## Abuse

The Worker caps bodies at 8 KB, validates fields and stores only the report
JSON — no IP, cookies or request headers. Before enabling the button in
production, add a Cloudflare Rate Limiting rule (for example 5 requests per
minute per IP on `POST /report`) or a Turnstile check.

## Reading reports

```bash
npx wrangler r2 object list bangkok-transit-reports --prefix reports/
npx wrangler r2 object get bangkok-transit-reports "reports/2026-11-26/....json"
```
