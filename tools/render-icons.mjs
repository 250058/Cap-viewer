// Re-creates every PNG icon and the link-preview image from the master SVG.
//   node tools/render-icons.mjs
// Master: icons/icon.svg (= icon-design/icon.svg, the keystone mark drawn with the
// icon-designer skills by Paldom, MIT). Same rules as that kit's exporter:
// self-rendered surfaces keep the rounded squircle; platform-masked targets
// (apple-touch-icon, maskable) get a full-bleed square so they are not masked twice.
// Requires Playwright (npm i -D playwright && npx playwright install chromium).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../icons');

const BG = '#2A2A2E';
const icon = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const bgPath = /<path id="bg"[^>]*\/>/;
if (!bgPath.test(icon)) throw new Error('icons/icon.svg must have a <path id="bg" .../> background');
const square = icon.replace(bgPath, `<rect id="bg" width="1024" height="1024" fill="${BG}"/>`);

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, size, name, opts = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  if (!opts.mono) {
    await page.screenshot({ path: path.join(dir, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  } else {
    // Monochrome icon: the glyph as white on transparent, with the dark seams cut out.
    const b64 = await page.evaluate(async ({ svg, size, bg }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, size, size);
      const d = g.getImageData(0, 0, size, size);
      const [br, bgG, bb] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
      for (let i = 0; i < d.data.length; i += 4) {
        const dist = Math.hypot(d.data[i] - br, d.data[i + 1] - bgG, d.data[i + 2] - bb) / 200;
        const a = Math.min(1, dist) * (d.data[i + 3] / 255);
        d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
        d.data[i + 3] = Math.round(a * 255);
      }
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    }, { svg: square, size, bg: BG });
    fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));
  }
  console.log('wrote icons/' + name);
}

await render(icon, 192, 'icon-192.png');
await render(icon, 512, 'icon-512.png');
await render(icon, 32, 'favicon-32.png');
await render(square, 180, 'apple-touch-icon.png');
await render(square, 512, 'icon-maskable-512.png');
await render(square, 512, 'icon-monochrome-512.png', { mono: true });

// 1200×630 link preview (KakaoTalk, messengers, SNS)
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<body style="margin:0">
  <div style="width:1200px;height:630px;box-sizing:border-box;padding:0 96px;display:flex;align-items:center;gap:72px;
              background:#f4f4f5;font-family:system-ui,sans-serif;color:#171717;word-break:keep-all">
    <div style="flex:none;filter:drop-shadow(0 16px 32px rgba(0,0,0,.18))">${icon.replace('<svg ', '<svg width="300" height="300" ')}</div>
    <div>
      <div style="font-size:84px;font-weight:600;letter-spacing:-2px;line-height:1.05">CAP 뷰어</div>
      <div style="font-size:36px;font-weight:500;margin-top:24px;color:#404040;line-height:1.35">Capstone 실험 파일을<br>휴대폰에서 그대로</div>
      <div style="font-size:26px;margin-top:28px;color:#525252;font-weight:500">페이지 · 그래프 · 표 · PDF 저장</div>
    </div>
  </div></body>`);
await page.screenshot({ path: path.join(dir, 'og-image.png') });
console.log('wrote icons/og-image.png');

await browser.close();
