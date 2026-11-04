// Renders public/og/og-default.png (1200x630), the social-share / link-preview
// image. Run `node scripts/build-og.mjs` after changing the design; the PNG is
// committed so the build needs no browser.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const colors = ["#76b729", "#00a651", "#b8962e", "#1e4d9b", "#7b3f98", "#c9a800", "#e0679a", "#c8102e", "#d6232a"];
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans Thai",Arial,sans-serif;background:#0f2d1a;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 90px;position:relative;overflow:hidden}
.bars{position:absolute;left:0;right:0;bottom:0;display:flex;height:34px}.bars i{flex:1}
h1{font-size:86px;line-height:1.05;font-weight:800;letter-spacing:-2px}
p{margin-top:26px;font-size:36px;line-height:1.3;color:#cfe8d6;max-width:980px}
.th{margin-top:14px;font-size:30px;color:#9fc7ab}
.url{position:absolute;right:90px;top:60px;font-size:30px;font-weight:600;color:#9fc7ab}
</style><body><div class="url">bangkok-transit.com</div>
<h1>Bangkok Transit</h1>
<p>BTS, MRT, Airport Rail Link &amp; SRT Red map with route planner and live train arrivals</p>
<p class="th">แผนที่รถไฟฟ้ากรุงเทพ วางแผนเส้นทาง เวลารถไฟฟ้าสด</p>
<div class="bars">${colors.map((c) => `<i style="background:${c}"></i>`).join("")}</div></body>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
mkdirSync("public/og", { recursive: true });
await page.screenshot({ path: "public/og/og-default.png" });
await browser.close();
