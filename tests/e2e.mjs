// End-to-end check in headless Chromium.
//   node tests/e2e.mjs [path/to/file.cap ...]
// Without arguments it opens examples/demo.cap and checks known content and values.
// With files it opens each one and visits every page (no errors, no warnings).
// Requires Playwright (npm i -D playwright && npx playwright install chromium).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.cap': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) failures++;
}

const browser = await chromium.launch();

async function openPage(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  return { page, errors };
}

async function load(page, file, forceJs) {
  if (forceJs) await page.evaluate(() => { window.__capForceJsInflate = true; });
  await page.setInputFiles('#file-input', file);
  await page.waitForSelector('#viewer:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(300);
}

try {
  const files = process.argv.slice(2);

  if (!files.length) {
    const demo = path.join(root, 'examples/demo.cap');
    for (const forceJs of [false, true]) {
      console.log(`\ndemo.cap — phone, ${forceJs ? 'JS inflate' : 'native inflate'}`);
      const { page, errors } = await openPage({ width: 390, height: 844 });
      await load(page, demo, forceJs);

      check((await page.locator('#page-tabs [role="tab"]').count()) === 2, 'two page tabs');
      check((await page.locator('.disp-text').first().innerText()).includes('경사면에서 수레의 운동'), 'text box content shown');
      check((await page.locator('.disp-entry').innerText()).includes('가속도가 커졌다'), 'answer box content shown');
      await page.waitForFunction(() => { const i = document.querySelector('.disp-img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 });
      check(true, 'picture loaded from the .cap');

      await page.click('#next-page');
      await page.waitForTimeout(300);
      check((await page.locator('#page-num').innerText()) === '2 / 2', 'next page button');
      check((await page.locator('.disp-graph .tb span').first().innerText()) === '런 3', 'graph shows the 3 runs saved in the file');
      check((await page.locator('.disp-table tbody tr').count()) === 28, 'table shows the 28 rows of run 3');
      check(/\d/.test(await page.locator('.dig-value').innerText()), 'digits show a value');

      const fit = await page.evaluate(() => {
        const { state, computeStats } = window.CapViewerApp;
        const run = state.cap.runs[2];
        const pos = run.data.get(state.cap.measurements.find((m) => m.name === 'Position').id);
        return computeStats(pos.t, pos.v, [0.6, 10]).quad;
      });
      check(Math.abs(2 * fit.A - 2.478) < 0.05, `quadratic fit gives a ≈ 2.478 (got ${(2 * fit.A).toFixed(3)})`);

      await page.selectOption('.disp-graph .tb-select', 'quad');
      check((await page.locator('.fitbox').count()) === 3, 'curve fit box per run');

      // y axis picker
      await page.selectOption('.disp-graph .axis-y', { label: 'Velocity (m/s)' });
      check((await page.locator('.fitbox').count()) === 3, 'y axis changed to velocity');

      // run picker
      await page.click('.disp-graph .tb:has-text("런")');
      await page.locator('#run-list input').first().uncheck();
      check((await page.locator('.disp-graph .tb span').first().innerText()) === '런 2', 'run picker removes a run');
      await page.click('#runs-done');
      await page.waitForTimeout(200);
      check(await page.locator('#runs-sheet').isHidden(), 'run picker closes');

      // full screen graph and back button
      await page.click('.disp-graph [aria-label="크게 보기"]');
      check(await page.locator('.disp-graph.expanded').isVisible(), 'graph opens full screen');
      await page.goBack();
      await page.waitForTimeout(200);
      check((await page.locator('.disp-graph.expanded').count()) === 0, 'back button closes full screen');

      // data summary + table
      await page.click('#summary-btn');
      check((await page.locator('#dpanel-summary .info-section').count()) >= 3, 'data summary rendered');
      await page.click('#dtab-table');
      check((await page.locator('#data-table tbody tr').count()) === 28, 'data table rows');
      await page.click('#drawer-close');
      await page.waitForTimeout(200);

      // original layout mode
      await page.click('#mode-btn');
      await page.waitForTimeout(300);
      check((await page.locator('.mode-layout .paper .disp').count()) === 4, 'original layout shows the 4 displays');

      // PDF export of all pages
      await page.click('#pdf-btn');
      await page.click('#pdf-start');
      await page.waitForSelector('#pdf-done:not([hidden])', { timeout: 60000 });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pdf-save')]);
      const pdf = fs.readFileSync(await dl.path()).toString('latin1');
      check(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'), 'PDF file downloaded (' + dl.suggestedFilename() + ', ' + Math.round(pdf.length / 1024) + ' KB)');
      check((pdf.match(/\/Type \/Page /g) || []).length === 2, 'PDF has one page per workbook page');
      check(pdf.includes('/Outlines') && (pdf.match(/\/Subtype \/Image/g) || []).length === 2, 'PDF has page images and bookmarks');
      await page.click('#pdf-close');
      await page.waitForTimeout(200);

      // address "#파일이름": back returns to the start screen, forward to the file
      check(decodeURIComponent(new URL(page.url()).hash) === '#demo', 'address shows #파일이름 (' + decodeURIComponent(new URL(page.url()).hash) + ')');
      await page.click('#summary-btn');
      await page.goBack();
      await page.waitForTimeout(200);
      check(await page.locator('#drawer').isHidden() && await page.locator('#viewer').isVisible(), 'back closes an open panel first');
      await page.goBack();
      await page.waitForTimeout(200);
      check(await page.locator('#welcome').isVisible() && new URL(page.url()).hash === '', 'back returns to the start screen');
      check((await page.locator('#doc-title').innerText()) === 'CAP 뷰어' && await page.locator('#pdf-btn').isHidden(), 'start screen header restored');
      await page.goForward();
      await page.waitForTimeout(300);
      check(await page.locator('#viewer').isVisible() && (await page.locator('.paper .disp').count()) > 0, 'forward returns to the file');

      // sanitizer: hostile HTML must not run or keep handlers
      const xss = await page.evaluate(() => {
        const html = '<p onclick="window.__p=1">a<img src=x onerror="window.__p=2"><script>window.__p=3<\/script>' +
          '<a href="javascript:window.__p=4">x</a><span style="background:url(http://e/x)">y</span><iframe src="http://e"></iframe></p>';
        const elx = window.CapRichText.render(html, { mode: 'reflow', loadImage: () => Promise.resolve(null) });
        document.body.appendChild(elx);
        const bad = elx.querySelector('script,iframe,[onclick],[onerror],a[href^="javascript"],[style*="url"]');
        return { bad: !!bad, pwned: window.__p };
      });
      await page.waitForTimeout(100);
      check(!xss.bad && xss.pwned === undefined, 'rich text sanitizer strips scripts, handlers and unsafe URLs');

      check(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
      await page.close();
    }
  }

  for (const file of files) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      console.log(`\n${path.basename(file)} — ${vp.width}px`);
      const { page, errors } = await openPage(vp);
      await load(page, file, false);
      const info = await page.evaluate(() => {
        const c = window.CapViewerApp.state.cap;
        return { pages: c.pages.length, runs: c.runs.length, warnings: c.warnings };
      });
      console.log('  pages:', info.pages, '| runs/data sets:', info.runs);
      check(info.warnings.length === 0, 'no warnings ' + JSON.stringify(info.warnings));
      let shown = 0;
      for (let i = 0; i < info.pages; i++) {
        await page.evaluate((n) => window.CapViewerApp.goPage(n), i);
        await page.waitForTimeout(150);
        shown += await page.locator('.paper .disp').count();
      }
      check(shown > 0, `visited ${info.pages} page(s), ${shown} displays rendered`);
      check(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
      if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, path.basename(file) + '-' + vp.width + '.png') });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
