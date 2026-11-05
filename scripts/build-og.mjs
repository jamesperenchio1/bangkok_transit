// Renders the social-share / link-preview banner (public/og/og-default.png,
// 1200x630) and a Facebook/LinkedIn-style cover (public/og/cover.png, 1640x624).
// The PNGs are committed so the build needs no browser; re-run after changing
// the design:
//
//   node scripts/build-og.mjs
//
// The phone screenshots in scripts/og-assets are real captures of the app (the
// live times visible in them are demo data, small enough not to be read).
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const img = (name) => `data:image/png;base64,${readFileSync(path.join(ROOT, "scripts/og-assets", name)).toString("base64")}`;
const colors = ["#76b729", "#00a651", "#b8962e", "#1e4d9b", "#7b3f98", "#c9a800", "#e0679a", "#c8102e", "#d6232a"];

const base = `
*{box-sizing:border-box;margin:0}
body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans Thai","Helvetica Neue",Arial,sans-serif;color:#fff;position:relative;overflow:hidden;
 background:radial-gradient(900px 600px at 85% 20%,#1f3f86 0%,rgba(31,63,134,0) 60%),linear-gradient(135deg,#0d1b45 0%,#081028 100%)}
.bars{position:absolute;left:0;right:0;bottom:0;display:flex;height:14px}.bars i{flex:1}
.brand{display:flex;align-items:center;gap:18px}
.brand span{font-size:30px;font-weight:700;letter-spacing:.2px;color:#cdd8f5}
h1{font-weight:800;letter-spacing:-2px;line-height:1.02}
.sub{color:#cdd8f5;line-height:1.3}
.th{color:#93a6d6}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chip{padding:8px 16px;border-radius:999px;font-weight:700;font-size:22px;color:#0a1230}
.phone{position:absolute;border-radius:38px;background:#0b0f1d;padding:9px;box-shadow:0 30px 60px rgba(0,0,0,.5),0 0 0 2px rgba(255,255,255,.12) inset}
.phone .s{border-radius:30px;overflow:hidden;width:100%;height:100%;background:#fff}
.phone img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
`;
const chips = [["BTS", "#76b729"], ["MRT", "#3b6fd4"], ["Airport Rail Link", "#b8396b"], ["SRT Red", "#d6232a"]]
  .map(([t, c]) => `<span class="chip" style="background:${c};color:#fff">${t}</span>`).join("");
const bars = `<div class="bars">${colors.map((c) => `<i style="background:${c}"></i>`).join("")}</div>`;
const phone = (src, css) => `<div class="phone" style="${css}"><div class="s"><img src="${src}"></div></div>`;

const og = `<!doctype html><meta charset="utf-8"><style>${base}
body{width:1200px;height:630px}
.left{position:absolute;left:80px;top:52px;width:660px}
h1{font-size:80px;margin-top:30px}
.sub{font-size:28px;margin-top:18px}
.th{font-size:25px;margin-top:10px}
.chips{margin-top:26px}
.chip{font-size:20px;padding:7px 14px}
</style><body>
<div class="left">
 <div class="brand"><span>bangkok-transit.com</span></div>
 <h1>Bangkok<br>Transit</h1>
 <p class="sub">Every rail line on one map. Plan the route, see where you are, live BTS train times.</p>
 <p class="th sub">แผนที่รถไฟฟ้าทุกสาย วางแผนเส้นทาง เวลา BTS สด</p>
 <div class="chips">${chips}</div>
</div>
${phone(img("1-home-en.png"), "left:780px;top:46px;width:225px;height:470px;transform:rotate(5deg)")}
${phone(img("3-route-en.png"), "left:950px;top:118px;width:225px;height:470px;transform:rotate(-4deg)")}
${bars}</body>`;

const cover = `<!doctype html><meta charset="utf-8"><style>${base}
body{width:1640px;height:624px}
.left{position:absolute;left:110px;top:96px;width:860px}
h1{font-size:112px;margin-top:40px}
.sub{font-size:36px;margin-top:22px}
.th{font-size:30px;margin-top:14px}
.chips{margin-top:34px}
</style><body>
<div class="left">
 <div class="brand"><span>bangkok-transit.com</span></div>
 <h1>Bangkok Transit</h1>
 <p class="sub">Every rail line on one map. Plan the route, see where you are, live BTS train times.</p>
 <p class="th sub">แผนที่รถไฟฟ้าทุกสาย วางแผนเส้นทาง เวลาขบวน BTS สด</p>
 <div class="chips">${chips}</div>
</div>
${phone(img("1-home-en.png"), "left:1040px;top:60px;width:230px;height:480px;transform:rotate(6deg)")}
${phone(img("5-zoom-en.png"), "left:1240px;top:90px;width:230px;height:480px;transform:rotate(-3deg)")}
${bars}</body>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
mkdirSync(path.join(ROOT, "public/og"), { recursive: true });
for (const [html, w, h, out] of [[og, 1200, 630, "og-default.png"], [cover, 1640, 624, "cover.png"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: path.join(ROOT, "public/og", out) });
  console.log(`public/og/${out}`);
}
await browser.close();
