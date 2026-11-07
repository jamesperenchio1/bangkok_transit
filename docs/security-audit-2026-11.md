# Security audit — bangkok-transit.com (2026-11-05)

Scope: `bangkok-transit.com`, `www.`, `live.` (apex + R2 custom domain), the public repo
`jamesperenchio1/bangkok_transit`, the build output (`out/`), the poller Worker source.
Out of scope: `bts-api.topmile.com`, OpenFreeMap, Cloudflare's own infrastructure.

Method: passive recon, rate-limited live probes (nuclei `-rl 10`, curl), source + supply-chain
scanners (semgrep, gitleaks full history, trivy, osv/npm audit, zizmor), a Playwright
XSS/prototype-pollution/storage-poisoning sweep (95 URLs + poisoned localStorage), and the
heavy/noisy scans (ZAP full active scan, path fuzzing, method tampering) against a local
production build (`wrangler dev`) so nothing could trigger a Cloudflare ban or burn quota.

**Overall:** no exploitable vulnerability found. The site is a static export with no server
code, no cookies, no accounts, no API routes and no secrets in the bundle or git history, so
the classic holes (SQLi, auth bypass, SSRF, IDOR, stored XSS) have nowhere to live. The real
gaps are transport hardening, one cost-abuse vector, supply-chain hygiene, and a few account
settings. Nothing below needs an emergency fix.

## Findings (most severe first)

### 1. MEDIUM — `live.` cache can be bypassed with a query string (cost / quota abuse)
**Cache-key half FIXED 2026-11-05:** the existing "Cache live arrivals" Cache Rule now has
*Ignore query string* on; verified `?cb=<random>` returns `HIT` after the first request. The
WAF/rate-limit half below is still open.
`GET https://live.bangkok-transit.com/arrivals.json?cb=<random>` returns `cf-cache-status: MISS`
every time (verified three times); the bare URL is a `HIT`. Every unique query string is a fresh
R2 read (Class B op). R2's free tier is 10M reads/month: roughly 4 req/s sustained burns it, and
beyond that it is billed. This breaks the "costs must not scale with users" rule for an
*attacker* rather than for users. The apex is not affected (static assets: `?cb=` → `HIT`).
**Fix (Cloudflare dashboard, no code):** Cache Rule on hostname `live.bangkok-transit.com` →
Cache key → *Ignore query string*; plus a WAF custom rule that blocks (or redirects) requests
to `live.` where `http.request.uri.query ne ""`; plus a rate-limit rule (free plan allows one).
**In prod / local:** only observable in prod; not scanned further to avoid abusing the quota.

### 2. MEDIUM — No HSTS on any host
`strict-transport-security` is absent on `bangkok-transit.com` and `live.` (curl, testssl,
nuclei, nikto all agree). `http://` redirects with a 301, so a first-visit downgrade/SSL-strip
on hostile Wi-Fi is possible (a commuter app used on public networks).
**Fix:** Cloudflare → SSL/TLS → Edge Certificates → HSTS: `max-age=31536000; includeSubDomains`,
enable preload once every subdomain is HTTPS-only. (Setting it in `public/_headers` also works
for the apex but not for `live.`, which is R2.)

### 3. LOW — TLS 1.0 / 1.1 and 3DES (SWEET32) offered
testssl: TLS 1.0, 1.1 offered; `DES-CBC3-SHA` (SWEET32) and CBC suites (BEAST/LUCKY13 flagged,
mitigated by TLS 1.2 support). Cloudflare zone setting.
**Fix:** SSL/TLS → Edge Certificates → Minimum TLS Version = 1.2 (and optionally TLS 1.3 only
with the 1.3 toggle). Costs nothing; only pre-2014 clients lose access.

### 4. LOW — GitHub Actions supply chain: unpinned actions, no Dependabot, no branch protection
- zizmor: 18 unpinned `uses:` (`actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`)
  across 4 workflows, 6 `artipacked` (checkout without `persist-credentials: false`).
  Workflow permissions are already `contents: read` and `pull_request_target` is not used
  (good); no secrets exist in the repo (`gh api .../actions/secrets` → none).
- `main` is not protected (anyone with write access can force-push; Workers Builds deploys on
  push to `main`). Only one collaborator today, so this is a guard against mistakes/token theft.
- Dependabot alerts and security updates are **disabled**.
- Secret scanning + push protection: enabled (good).
**Fix (repo):** pin actions to SHAs + `persist-credentials: false`, add `.github/dependabot.yml`
(npm root, npm poller, github-actions), turn on Dependabot alerts. **Fix (GitHub UI):** protect
`main` (require PR/CI, block force-push).

### 5. LOW — Dependency advisories (build/dev tooling only)
`npm audit`: root 18 (5 high, 13 moderate), poller 2 moderate. High: `undici` (EventSource DoS,
via `miniflare`/`wrangler`), `zod` (memory exhaustion, via `@serwist/build`), `glob`/`minimatch`.
All are dev/build-time packages; none ship in `out/` (trivy: lockfile clean at default
severities, gitleaks on `out/`: no leaks). Not reachable from the live site.
**Fix:** `npm audit fix` / bump `wrangler`, `@serwist/next`, `vitest`, `eslint-config-next`;
re-run the full suite.

### 6. LOW — `live.` serves JSON with no security headers
No `X-Content-Type-Options`, no CSP, no `Referrer-Policy` on `live.bangkok-transit.com`
(Content-Type is `application/json`, so practical risk is minimal).
**Fix:** extend the existing CORS Transform Rule on `live.` to add `X-Content-Type-Options:
nosniff` and `Content-Security-Policy: default-src 'none'`.

### 7. LOW / INFO — Email spoofing posture and DNS
- No SPF, DMARC, or MX on the domain (TXT is only the Google site-verification). Anyone can send
  mail "from" `@bangkok-transit.com` and it is not rejected by receivers. **Fix:** add
  `v=spf1 -all` and `_dmarc` `v=DMARC1; p=reject;` (null-sender setup for a domain that sends no mail).
- No DNSSEC (DS record absent) — enable in Cloudflare DNS.
- No CAA record — add `0 issue "letsencrypt.org"` / `pki.goog` (whichever CAs Cloudflare uses for you).

### 8. INFO — `window.__map` is exposed in production
`components/TransitMap.tsx:359` assigns the MapLibre instance to `window.__map` (needed for e2e).
Not exploitable (the map is client-side and the data public), but it hands anyone in DevTools the
full map object. Gate it behind a build flag (`process.env.NEXT_PUBLIC_E2E`) if you want a clean
console. Tradeoff: the e2e suite relies on it.

### 9. INFO — CSP `script-src 'unsafe-inline'`
Documented and unavoidable for a static Next export without nonces (Next inlines 14 bootstrap
`<script>` blocks). Mitigations already in place: no user-controlled HTML is rendered, JSON-LD
escapes `<`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`.
The XSS sweep (11 payloads × 7 param names, path and hash payloads, poisoned localStorage with
`__proto__` and HTML in every string field) triggered zero dialogs, zero pollution.
Hash-based `script-src` is possible via a post-build step, but the hashes change every build
and the benefit is small here. Optional.

### 10. INFO — Missing hardening headers
COOP, CORP, COEP, `X-Permitted-Cross-Domain-Policies` absent (nuclei info). `X-Frame-Options`
is redundant with `frame-ancestors 'none'`. `COOP: same-origin` and `CORP: same-origin` are safe
to add in `public/_headers` for the document (check MapLibre workers/blob still load: the e2e
CSP check will tell). `/.well-known/security.txt` is missing (404), add one with a contact.

### 11. INFO — Personal email in public git history
109 commits are authored with `jamyangperenchio@gmail.com`. Already public; consider GitHub's
noreply address for future commits (`git config user.email`). Rewriting history is not worth it.

## Checked and clean
- Secrets: gitleaks over all 104 commits and over `out/` → none. `.env.example` has only a
  commented override. No `.map` files in `out/` or live (`*.js.map` → 404).
- Sensitive paths on live: `.env`, `.git/*` → 403 (Cloudflare managed rules), `wrangler.jsonc`,
  `package.json`, `_headers`, `_next/` → 404.
- HTTP methods: POST/PUT/DELETE on apex → 405; on `live.` → 401 (R2 requires auth, no anonymous
  writes). `workers.dev` is disabled for the poller (config). The poller exposes no `fetch`
  handler (cron + alarm only), so it has no HTTP surface.
- CORS: `live.` is `ACAO: *` by design (public data, no credentials); apex has no CORS headers.
  Preflight `PUT` from a foreign origin → 403.
- Host-header / `X-Forwarded-Host` injection: no reflection; `Host: evil.com` → 403.
- Path traversal / cache deception probes (`/sw.js/x.css`, `%2e%2e`, double slash) → 4xx/redirect,
  nothing cached under a wrong type. 9 KB path → 404, 20 KB header → accepted (Cloudflare limit).
- Open redirect: only redirects are `www`→apex, `http`→`https`, and `/x/` → `/x`. The URL
  parameters `from`/`to` are looked up in a station map and never reflected or navigated to.
- Service worker: precache + `CacheFirst` for OpenFreeMap only; arrivals are `NetworkOnly`
  (cannot be poisoned from cache); `sw.js` is `no-cache`; scope is origin root.
- Upstream trust (`lib/bts.ts`): shape and size bounds on every field (10 platforms, 20 trains,
  200-char strings); rendered through React text nodes and MapLibre `setDOMContent` (no
  `innerHTML`). A hostile upstream cannot inject markup. (Note: validated objects are forwarded
  whole, so unexpected extra keys would pass through — size only bounded by the upstream's
  own response; low risk, could be pruned in the poller.)
- semgrep (TypeScript, React, JavaScript, OWASP Top 10): only finding class was the unpinned
  actions above; no code findings.
- Nikto was refused by Cloudflare's TLS fingerprinting after ~165 requests; nuclei
  (exposure, misconfig, takeover, cors, cache, tech tags) found nothing above `low`.

## ZAP active scan (local build) — partial
ZAP's full active scan (spider + 18 active rules, including SQL injection and XSS rule families)
ran against the local production build and raised **0 alerts** before the ZAP daemon in Docker
crashed during the DOM XSS rule (exit 3, connection to the daemon lost). It is therefore a
partial result, not a full pass. The Playwright XSS/pollution sweep above covers the same ground
for this site's only input (`?from=`/`?to=`, path, hash, localStorage).

## Fixes applied in this branch (repo-side)
- All 11 GitHub Actions references pinned to commit SHAs (`# v4` comment kept); every
  `actions/checkout` now sets `persist-credentials: false`. zizmor: no findings.
- `.github/dependabot.yml`: weekly npm (root + poller) and github-actions updates.
- `npm audit fix` in root and poller: poller now 0 vulnerabilities; root 18 -> 13. The rest need
  `npm audit fix --force` (breaking: `@serwist/next`, `eslint-config-next`, `vitest` majors) and
  are build-time only, so they were left for a deliberate upgrade.
- `public/.well-known/security.txt` (+ cache headers) and `Cross-Origin-Opener-Policy: same-origin`
  in `public/_headers`.
- Not changed on purpose: `window.__map` (the e2e suite depends on it), CORP/COEP (could break
  embedding of `/og/*` images and map assets), CSP `unsafe-inline` (needs a per-build hash step).
- `security.txt` points at GitHub private vulnerability reporting, which is **currently disabled**
  on the repo. Enable it (Settings -> Code security) or change the Contact line.

## Not verified (needs your Cloudflare login)
`wrangler whoami` reports not authenticated, so these account settings could not be read. Please
check (or run `npx wrangler login` and tell me to re-run read-only):
- Zone: Always Use HTTPS, Min TLS, TLS 1.3, HSTS, DNSSEC, Bot Fight Mode, WAF managed rules on,
  Security Events for blocked traffic, Email routing.
- R2 `bts-live`: **public access / r2.dev subdomain disabled**, no bucket CORS policy.
- API tokens: scope to least privilege; no Global API key in CI; 2FA on the Cloudflare and
  GitHub accounts.
- Workers Builds: confirm forks/PRs from outsiders cannot trigger deploys with production bindings.
- Rate-limit and cache rules from findings 1 and 6.

## Prod vs local notes
| Test | Where | What to expect in Cloudflare |
|---|---|---|
| ZAP full active scan, ffuf, method fuzzing | local build only | Run against prod, this would trip managed WAF/Bot Fight/rate limits, show as Security Events (block/challenge), and could get the scanning IP challenged; request volume counts against the Workers static-asset (free, unlimited) but `live.` GETs count toward R2. |
| Nikto | live (aborted) | Cloudflare dropped the TLS handshake after ~165 requests (bot fingerprint). Expected and healthy. |
| Cache-bust `live.` | live (3 requests) | MISS each time → real R2 reads; confirms finding 1. |
| nuclei exposure/misconfig/tech | live, 10 req/s | No blocks, no Security Events beyond informational. |

## Recommended fix order
1. Cloudflare: HSTS, Min TLS 1.2, cache key ignoring query on `live.`, WAF/rate-limit rule for `live.`, SPF/DMARC/CAA/DNSSEC (30 minutes, no code).
2. Repo: pin Actions to SHAs, Dependabot config, `npm audit fix`, `security.txt`, optional COOP/CORP, gate `window.__map`.
3. GitHub: protect `main`, enable Dependabot alerts.
