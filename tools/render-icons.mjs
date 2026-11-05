// Re-creates every PNG icon and the link-preview image from the SVG sources.
//   node tools/render-icons.mjs
// Sources: icons/icon.svg (main ".cap" lettering), icons/favicon.svg (small ".c").
// Requires Playwright (npm i -D playwright && npx playwright install chromium).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../icons');

const icon = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const favicon = fs.readFileSync(path.join(dir, 'favicon.svg'), 'utf8');

// variants derived from icon.svg
const glyphs = icon.slice(icon.indexOf('<g fill="none"'), icon.lastIndexOf('</svg>'));
const defs = icon.slice(icon.indexOf('<defs>'), icon.indexOf('</defs>') + 7);
const square = icon.replace(' rx="112"', ''); // iOS rounds the corners itself
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#bg)"/>` +
  `<g transform="translate(51.2 51.2) scale(.8)">${glyphs}</g></svg>`; // glyphs inside the 80% safe zone
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyphs.replace(/#ffd166/g, '#fff')}</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, size, name) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: path.join(dir, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote icons/' + name);
}

await render(icon, 192, 'icon-192.png');
await render(icon, 512, 'icon-512.png');
await render(square, 180, 'apple-touch-icon.png');
await render(maskable, 512, 'icon-maskable-512.png');
await render(mono, 512, 'icon-monochrome-512.png');
await render(favicon, 32, 'favicon-32.png');

// 1200×630 link preview (KakaoTalk, messengers, SNS)
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<body style="margin:0">
  <div style="width:1200px;height:630px;box-sizing:border-box;padding:0 90px;display:flex;align-items:center;gap:70px;
              background:linear-gradient(135deg,#f4f6fa 0%,#e3e8f2 100%);font-family:system-ui,sans-serif;color:#141a24">
    <div style="flex:none;filter:drop-shadow(0 18px 30px rgba(23,57,168,.35))">${icon.replace('<svg ', '<svg width="300" height="300" ')}</div>
    <div>
      <div style="font-size:84px;font-weight:800;letter-spacing:-2px;line-height:1.05">CAP 뷰어</div>
      <div style="font-size:36px;font-weight:600;margin-top:22px;color:#2b3442;line-height:1.35">Capstone 실험 파일을<br>휴대폰에서 그대로</div>
      <div style="font-size:26px;margin-top:26px;color:#1f5fd1;font-weight:700">페이지 · 그래프 · 표 · PDF 저장</div>
    </div>
  </div></body>`);
await page.screenshot({ path: path.join(dir, 'og-image.png') });
console.log('wrote icons/og-image.png');

await browser.close();
