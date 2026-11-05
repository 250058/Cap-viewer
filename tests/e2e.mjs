// End-to-end check in headless Chromium.
//   node tests/e2e.mjs [path/to/file.cap ...]
// Without arguments it opens examples/demo.cap and checks known values.
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
try {
  const files = process.argv.slice(2);
  const targets = files.length ? files : [path.join(root, 'examples/demo.cap')];
  for (const forceJs of [false, true]) {
    for (const file of targets) {
      console.log(`\n${path.basename(file)} (${forceJs ? 'JS inflate' : 'native inflate'})`);
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(base);
      if (forceJs) await page.evaluate(() => { window.__capForceJsInflate = true; });
      await page.setInputFiles('#file-input', file);
      await page.waitForSelector('#viewer:not([hidden])', { timeout: 20000 });
      const info = await page.evaluate(() => {
        const s = window.CapViewerApp.state;
        return {
          runs: s.cap.runs.length,
          meas: s.cap.measurements.map((m) => m.name + ':' + m.unit),
          selected: s.selected.length,
          points: s.cap.runs.map((r) => r.points),
          warnings: s.cap.warnings,
          yId: s.yId,
        };
      });
      console.log('  runs:', info.runs, '| measurements:', info.meas.join(', '), '| selected:', info.selected);
      check(info.runs > 0, 'has runs');
      check(info.meas.length > 0, 'has measurements');
      check(info.warnings.length === 0, 'no warnings ' + JSON.stringify(info.warnings));
      check((await page.locator('.stat-card').count()) === info.selected, 'one stats card per selected run');

      if (!files.length) {
        // demo.cap: run 3 is a 15° ramp -> a = g sin15° - 0.06 ≈ 2.478 m/s²
        const fit = await page.evaluate(() => {
          const { state, computeStats } = window.CapViewerApp;
          const run = state.cap.runs[2];
          const pos = run.data.get(state.cap.measurements.find((m) => m.name === 'Position').id);
          return computeStats(pos.t, pos.v, [0.6, 10]).quad;
        });
        check(Math.abs(2 * fit.A - 2.478) < 0.05, `quadratic fit gives a ≈ 2.478 (got ${(2 * fit.A).toFixed(3)})`);
        check(info.selected === 3, 'graph defaults from file (3 runs shown)');
      }

      // interact: fit, range mode, table, info
      await page.selectOption('#fit-select', 'quad');
      check((await page.locator('.fit-box').count()) === info.selected, 'fit shown for each run');
      const box = await page.locator('#chart').boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.click('#tab-btn-table');
      const rows = await page.locator('#data-table tbody tr').count();
      check(rows > 0, `table has rows (${rows})`);
      await page.click('#tab-btn-info');
      check((await page.locator('#info .info-section').count()) >= 3, 'info sections rendered');
      check(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
      if (process.env.SHOTS) {
        await page.click('#tab-btn-graph');
        await page.screenshot({ path: path.join(process.env.SHOTS, path.basename(file) + (forceJs ? '-js' : '') + '.png'), fullPage: true });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
