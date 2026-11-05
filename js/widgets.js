/*
 * Workbook page displays, modelled on Capstone's: text box, text entry
 * (answer box), image, graph, table, digits. Each widget owns `root`.
 *
 * ctx = { cap, mode, loadImage(path), runColor(run), openRunSheet(opts),
 *         openImage(url, title), openOverlay(close), closeOverlay(), toast(msg), baseName }
 */
(function (global) {
  'use strict';

  const P = global.CapParser;
  const U = global.CapUtil;
  const RT = global.CapRichText;
  const { el, esc, icon, fmt, fmtFixed } = U;

  function measOf(cap, id) {
    if (!id) return null;
    return id === cap.time.id ? cap.time : cap.measById.get(id) || null;
  }
  function scaled(arr, k) {
    if (k === 1) return arr;
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] * k;
    return out;
  }
  function toolButton(name, label, opts) {
    const b = el('button', 'tb');
    b.type = 'button';
    b.innerHTML = icon(name, 18) + (opts && opts.text ? '<span>' + esc(label) + '</span>' : '');
    b.title = label;
    b.setAttribute('aria-label', label);
    if (opts && opts.toggle) b.setAttribute('aria-pressed', 'false');
    return b;
  }

  class Widget {
    constructor(item, ctx) {
      this.item = item;
      this.ctx = ctx;
      this.root = el('section', 'disp disp-' + item.type + (item.frame ? ' framed' : ''));
      if (item.titleVisible && item.title) this.root.appendChild(el('h3', 'disp-title', item.title));
      this.body = el('div', 'disp-body');
      this.root.appendChild(this.body);
    }
    get hidden() { return false; }
    mount() {}
    resize() {}
    destroy() {}
  }

  // ---------- text ----------
  class TextWidget extends Widget {
    constructor(item, ctx) {
      super(item, ctx);
      this.empty = RT.isEmpty(item.html);
      if (item.bg && item.bg !== 'rgba(255,255,255,1.000)') this.body.style.background = item.bg;
      this.body.appendChild(RT.render(item.html, { mode: ctx.mode, loadImage: ctx.loadImage }));
    }
    get hidden() { return this.empty && this.ctx.mode === 'reflow'; }
  }

  class EntryWidget extends Widget {
    constructor(item, ctx) {
      super(item, ctx);
      this.root.classList.add('framed');
      if (RT.isEmpty(item.html)) {
        this.body.appendChild(el('p', 'entry-empty', '입력된 내용이 없습니다'));
      } else {
        this.body.appendChild(RT.render(item.html, { mode: ctx.mode, loadImage: ctx.loadImage }));
      }
    }
  }

  // ---------- image ----------
  class ImageWidget extends Widget {
    constructor(item, ctx) {
      super(item, ctx);
      const img = el('img', 'disp-img');
      img.alt = item.title || '그림';
      img.decoding = 'async';
      this.img = img;
      const btn = el('button', 'img-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', '그림 크게 보기');
      btn.appendChild(img);
      this.body.appendChild(btn);
      ctx.loadImage(item.file).then((url) => {
        if (url) img.src = url;
        else this.body.replaceChildren(el('p', 'missing', '그림 파일을 찾을 수 없습니다'));
      });
      btn.addEventListener('click', () => { if (img.src) ctx.openImage(img.src, item.title); });
    }
  }

  // ---------- graph ----------
  class GraphWidget extends Widget {
    constructor(item, ctx) {
      super(item, ctx);
      const cap = ctx.cap;
      const g = item.graph || { y: [], runs: [] };
      const known = (id) => id === cap.time.id || cap.measById.has(id);
      this.xId = g.x && known(g.x.measId) ? g.x.measId : cap.time.id;
      this.xUnit = g.x && g.x.measId === this.xId ? g.x.unitCode : 0;
      const y0 = (g.y || []).find((y) => cap.measById.has(y.measId));
      this.yId = y0 ? y0.measId : cap.measurements[0] ? cap.measurements[0].id : null;
      this.yUnit = y0 ? y0.unitCode : 0;
      this.runIds = (g.runs || []).filter((id) => {
        const r = P.runById(cap, id);
        return r && P.seriesFor(cap, r, this.xId, this.yId);
      });
      if (!this.runIds.length && this.yId) {
        const r = P.resolveRun(cap, this.yId, null);
        if (r && P.seriesFor(cap, r, this.xId, this.yId)) this.runIds = [r.id];
      }
      this.fit = g.fit || 'none';
      this.showStats = false;
      this.range = null;
      this.series = [];

      // toolbar (Capstone-like)
      const tools = el('div', 'gtools');
      this.bFit = toolButton('fit', '데이터에 맞게 보기');
      this.bRuns = toolButton('runs', '런 선택', { text: true });
      this.bRange = toolButton('range', '구간 선택', { toggle: true });
      this.fitSel = el('select', 'tb-select');
      this.fitSel.setAttribute('aria-label', '곡선 맞춤');
      this.fitSel.innerHTML = '<option value="none">맞춤</option><option value="linear">직선</option><option value="quad">2차</option>';
      this.fitSel.value = this.fit;
      const fitWrap = el('label', 'tb tb-fit');
      fitWrap.innerHTML = icon('fx', 18);
      fitWrap.appendChild(this.fitSel);
      this.bStats = toolButton('sigma', '통계', { toggle: true });
      this.bPoints = toolButton('points', '점/선 표시');
      this.bPng = toolButton('image', '그래프 이미지 저장');
      this.bExpand = toolButton('expand', '크게 보기');
      tools.append(this.bFit, this.bRuns, this.bRange, fitWrap, this.bStats, this.bPoints, this.bPng, el('span', 'tb-spacer'), this.bExpand);
      this.root.insertBefore(tools, this.body);

      // plot with Capstone-style axis pickers
      const plot = el('div', 'gplot');
      this.canvas = el('canvas');
      this.canvas.setAttribute('aria-label', '그래프');
      this.ySel = el('select', 'axis-sel axis-y');
      this.ySel.setAttribute('aria-label', '세로축 측정값');
      this.xSel = el('select', 'axis-sel axis-x');
      this.xSel.setAttribute('aria-label', '가로축 측정값');
      this.coord = el('div', 'gcoord');
      this.coord.hidden = true;
      plot.append(this.canvas, this.ySel, this.xSel, this.coord);
      this.body.appendChild(plot);
      this.stats = el('div', 'gstats');
      this.root.appendChild(this.stats);

      this.fillAxisSelects();
      this.bind();
    }

    mount() {
      this.chart = new global.CapChart(this.canvas, {
        onPick: (p) => this.showCoord(p),
        onSelect: (sel) => { this.range = sel; this.renderStats(); },
      });
      const g = this.item.graph || {};
      this.chart.showLines = g.lines !== false;
      this.chart.showPoints = !!g.points;
      this.chart.emptyText = '데이터 없음';
      this.update(false);
    }

    resize() { if (this.chart) this.chart.resize(); }
    destroy() { if (this.chart) this.chart.destroy(); }

    measOptions(includeTime, current) {
      const cap = this.ctx.cap;
      const list = cap.allMeasurements.filter((m) => m.kind !== 'const' && (m.runCount > 0 || m.id === current));
      const opts = includeTime ? [cap.time].concat(list) : list;
      return opts.map((m) => '<option value="' + esc(m.id) + '">' + esc(U.measLabel(m, P.unitFor(m).symbol)) + '</option>').join('');
    }
    fillAxisSelects() {
      this.ySel.innerHTML = this.measOptions(false, this.yId);
      this.xSel.innerHTML = this.measOptions(true, this.xId);
      if (this.yId) this.ySel.value = this.yId;
      this.xSel.value = this.xId;
    }

    bind() {
      this.bFit.addEventListener('click', () => this.chart && this.chart.fitAll());
      this.bRuns.addEventListener('click', () => {
        const cap = this.ctx.cap;
        const runs = cap.runs.filter((r) => P.seriesFor(cap, r, this.xId, this.yId));
        this.ctx.openRunSheet({
          title: '그래프에 표시할 런',
          runs,
          selected: this.runIds,
          onChange: (ids) => { this.runIds = ids; this.update(true); },
        });
      });
      this.bRange.addEventListener('click', () => {
        const on = this.bRange.getAttribute('aria-pressed') !== 'true';
        this.bRange.setAttribute('aria-pressed', String(on));
        this.chart.rangeMode = on;
        if (on) this.ctx.toast('그래프를 좌우로 끌어서 구간을 고르세요');
        else this.chart.clearSelection();
      });
      this.fitSel.addEventListener('change', () => { this.fit = this.fitSel.value; this.renderStats(); });
      this.bStats.addEventListener('click', () => {
        this.showStats = !this.showStats;
        this.bStats.setAttribute('aria-pressed', String(this.showStats));
        this.renderStats();
      });
      this.bPoints.addEventListener('click', () => {
        // cycle: lines -> points -> both
        const c = this.chart;
        if (c.showLines && !c.showPoints) { c.showLines = false; c.showPoints = true; this.ctx.toast('점만 표시'); }
        else if (!c.showLines) { c.showLines = true; c.showPoints = true; this.ctx.toast('점과 선 표시'); }
        else { c.showPoints = false; this.ctx.toast('선만 표시'); }
        c.draw();
      });
      this.bPng.addEventListener('click', () => {
        this.chart.exportPNG().then((b) => {
          if (b) U.saveBlob(b, U.safeFile(this.ctx.baseName() + '_' + (this.item.title || '그래프').slice(0, 40)) + '.png');
        });
      });
      this.bExpand.addEventListener('click', () => this.toggleExpand());
      this.ySel.addEventListener('change', () => { this.yId = this.ySel.value; this.yUnit = 0; this.range = null; this.chart.selection = null; this.update(false); });
      this.xSel.addEventListener('change', () => { this.xId = this.xSel.value; this.xUnit = 0; this.range = null; this.chart.selection = null; this.update(false); });
    }

    toggleExpand(fromHistory) {
      if (!this.expanded) {
        this.placeholder = el('div', 'disp-placeholder');
        this.placeholder.style.cssText = this.root.style.cssText;
        this.root.replaceWith(this.placeholder);
        this.savedStyle = this.root.style.cssText;
        this.root.style.cssText = '';
        this.root.classList.add('expanded');
        document.body.appendChild(this.root);
        document.body.classList.add('no-scroll');
        this.expanded = true;
        this.bExpand.innerHTML = icon('collapse', 18);
        this.bExpand.title = '원래 크기로';
        this.ctx.openOverlay(() => this.toggleExpand(true));
      } else {
        if (!fromHistory) { this.ctx.closeOverlay(); return; }
        this.root.classList.remove('expanded');
        this.root.style.cssText = this.savedStyle || '';
        if (this.placeholder && this.placeholder.parentNode) this.placeholder.replaceWith(this.root);
        document.body.classList.remove('no-scroll');
        this.expanded = false;
        this.bExpand.innerHTML = icon('expand', 18);
        this.bExpand.title = '크게 보기';
      }
      requestAnimationFrame(() => this.resize());
    }

    units() {
      const cap = this.ctx.cap;
      const xm = measOf(cap, this.xId), ym = measOf(cap, this.yId);
      return { xm, ym, xu: P.unitFor(xm, this.xUnit), yu: P.unitFor(ym, this.yUnit) };
    }

    update(keepView) {
      const cap = this.ctx.cap;
      const { xm, ym, xu, yu } = this.units();
      this.series = [];
      for (const id of this.runIds) {
        const run = P.runById(cap, id);
        if (!run || !this.yId) continue;
        const s = P.seriesFor(cap, run, this.xId, this.yId);
        if (!s) continue;
        this.series.push({
          id, run, label: run.name, color: this.ctx.runColor(run),
          x: scaled(s.x, xu.scale), y: scaled(s.y, yu.scale),
          sorted: this.xId === cap.time.id && !run.indexBased,
        });
      }
      this.chart.setData(this.series, {
        xLabel: U.measLabel(xm, xu.symbol) + ' ▾',
        yLabel: (ym ? U.measLabel(ym, yu.symbol) : '측정값 선택') + ' ▾',
        keepView,
      });
      this.bRuns.querySelector('span').textContent = '런 ' + this.series.length;
      this.fillAxisSelects();
      this.renderStats();
    }

    showCoord(p) {
      if (!p) { this.coord.hidden = true; return; }
      const { xu, yu } = this.units();
      this.coord.hidden = false;
      this.coord.innerHTML = '<span class="dot" style="background:' + p.series.color + '"></span><b>' + esc(p.series.label) + '</b><br>' +
        '(' + esc(fmt(p.x)) + (xu.symbol ? ' ' + esc(xu.symbol) : '') + ', ' + esc(fmt(p.y)) + (yu.symbol ? ' ' + esc(yu.symbol) : '') + ')';
    }

    renderStats() {
      const { xu, yu } = this.units();
      const fits = [];
      const show = this.showStats || this.fit !== 'none';
      const u = (s) => (s ? ' ' + esc(s) : '');
      let html = '';
      if (show && this.range) {
        html += '<div class="gstats-scope">선택 구간: ' + esc(fmt(this.range[0])) + ' ~ ' + esc(fmt(this.range[1])) + u(xu.symbol) +
          ' <button type="button" class="link-btn" data-act="clear">해제</button></div>';
      }
      if (show) {
        for (const s of this.series) {
          const st = U.computeStats(s.x, s.y, this.range);
          html += '<div class="fitbox" style="--c:' + s.color + '"><div class="fitbox-h"><span class="dot" style="background:' + s.color + '"></span>' + esc(s.label) + '</div>';
          if (!st.n) { html += '<div class="muted">이 구간에 데이터가 없습니다.</div></div>'; continue; }
          if (this.showStats) {
            html += '<dl class="stat-grid">' +
              '<div><dt>평균</dt><dd>' + fmt(st.mean) + u(yu.symbol) + '</dd></div>' +
              '<div><dt>최소</dt><dd>' + fmt(st.min) + u(yu.symbol) + '</dd></div>' +
              '<div><dt>최대</dt><dd>' + fmt(st.max) + u(yu.symbol) + '</dd></div>' +
              '<div><dt>표준편차</dt><dd>' + fmt(st.std) + u(yu.symbol) + '</dd></div>' +
              '<div><dt>개수</dt><dd>' + st.n + '</dd></div></dl>';
          }
          if (this.fit === 'linear') {
            if (st.linear) {
              const L = st.linear;
              fits.push({ color: s.color, x0: st.xmin, x1: st.xmax, fn: (x) => L.m * x + L.b });
              html += '<div class="fit-eq"><b>직선: y = mx + b</b><br>m (기울기) = ' + fmt(L.m) + u(U.slopeUnit(yu.symbol, xu.symbol)) +
                '<br>b (y절편) = ' + fmt(L.b) + u(yu.symbol) + '<br>R² = ' + L.r2.toFixed(4) + '</div>';
            } else html += '<div class="muted">점이 2개 이상 필요합니다.</div>';
          } else if (this.fit === 'quad') {
            if (st.quad) {
              const Q = st.quad;
              fits.push({ color: s.color, x0: st.xmin, x1: st.xmax, fn: (x) => Q.A * x * x + Q.B * x + Q.C });
              const posTime = yu.symbol === 'm' && xu.symbol === 's';
              html += '<div class="fit-eq"><b>2차: y = Ax² + Bx + C</b><br>A = ' + fmt(Q.A) + '<br>B = ' + fmt(Q.B) + '<br>C = ' + fmt(Q.C) +
                '<br>R² = ' + Q.r2.toFixed(4) + (posTime ? '<br><span class="muted">가속도 2A = ' + fmt(2 * Q.A) + ' m/s²</span>' : '') + '</div>';
            } else html += '<div class="muted">점이 3개 이상 필요합니다.</div>';
          }
          html += '</div>';
        }
      }
      this.stats.innerHTML = html;
      this.stats.hidden = !html;
      const clr = this.stats.querySelector('[data-act="clear"]');
      if (clr) clr.addEventListener('click', () => this.chart.clearSelection());
      if (this.chart) this.chart.setFits(fits);
    }
  }

  // ---------- table ----------
  const PAGE_ROWS = 300;

  class TableWidget extends Widget {
    constructor(item, ctx) {
      super(item, ctx);
      const cap = ctx.cap;
      this.cols = (item.columns || []).map((c) => {
        const run = P.resolveRun(cap, c.measId, c.dsId);
        return { measId: c.measId, unitCode: c.unitCode, decimals: c.decimals, runId: run ? run.id : null };
      });
      const tools = el('div', 'gtools');
      const bCsv = toolButton('csv', 'CSV 저장', { text: true });
      tools.append(bCsv);
      this.root.insertBefore(tools, this.body);
      bCsv.addEventListener('click', () => this.saveCsv());
      this.scroll = el('div', 'tscroll');
      this.body.appendChild(this.scroll);
      this.render();
    }

    columns() {
      const cap = this.ctx.cap;
      return this.cols.map((c) => {
        const meas = measOf(cap, c.measId);
        const unit = P.unitFor(meas, c.unitCode);
        return { ...c, meas, unit, run: c.runId ? P.runById(cap, c.runId) : null };
      });
    }

    render() {
      const cap = this.ctx.cap;
      const cols = this.columns();
      const rows = P.mergeColumns(cap, cols.map((c) => ({ measId: c.measId, run: c.run })));
      const decs = cols.map((c, i) => U.columnDecimals(rows.map((r) => r.vals[i] * c.unit.scale), c.decimals != null ? c.decimals : c.meas ? c.meas.decimals : 3));
      this.rows = rows;
      this.decs = decs;
      this.shown = 0;

      const table = el('table', 'cs-table');
      const head = el('thead');
      const r1 = el('tr', 'run-row');
      const r2 = el('tr', 'meas-row');
      r1.appendChild(el('th', 'idx'));
      r2.appendChild(el('th', 'idx', ''));
      cols.forEach((c, i) => {
        const th = el('th');
        const runs = cap.runs.filter((r) => (c.measId === cap.time.id ? !r.indexBased : r.data.has(c.measId)));
        if (runs.length) {
          const sel = el('select', 'run-sel');
          sel.setAttribute('aria-label', (c.meas ? c.meas.name : '') + ' 런 선택');
          sel.innerHTML = runs.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('');
          sel.value = c.runId;
          sel.addEventListener('change', () => { this.cols[i].runId = sel.value; this.render(); });
          const color = c.run ? this.ctx.runColor(c.run) : 'transparent';
          th.innerHTML = '<span class="dot" style="background:' + color + '"></span>';
          th.appendChild(sel);
        } else th.textContent = '—';
        r1.appendChild(th);
        r2.appendChild(el('th', null, c.meas ? U.measLabel(c.meas, c.unit.symbol) : '?'));
      });
      head.append(r1, r2);
      this.tbody = el('tbody');
      table.append(head, this.tbody);
      this.more = el('button', 'more-btn');
      this.more.type = 'button';
      this.more.addEventListener('click', () => this.appendRows());
      this.scroll.replaceChildren(table, this.more);
      this.appendRows();
    }

    appendRows() {
      const cols = this.columns();
      const end = Math.min(this.rows.length, this.shown + PAGE_ROWS);
      let html = '';
      for (let i = this.shown; i < end; i++) {
        const r = this.rows[i];
        html += '<tr><td class="idx">' + (i + 1) + '</td>';
        for (let c = 0; c < cols.length; c++) html += '<td>' + fmtFixed(r.vals[c] * cols[c].unit.scale, this.decs[c]) + '</td>';
        html += '</tr>';
      }
      if (!this.rows.length && !this.shown) {
        for (let i = 0; i < 6; i++) html += '<tr class="blank"><td class="idx">' + (i + 1) + '</td>' + cols.map(() => '<td></td>').join('') + '</tr>';
      }
      this.tbody.insertAdjacentHTML('beforeend', html);
      this.shown = end;
      const left = this.rows.length - end;
      this.more.hidden = left <= 0;
      this.more.textContent = '더 보기 (남은 ' + left + '행)';
    }

    saveCsv() {
      const cols = this.columns();
      if (!this.rows.length) { this.ctx.toast('표에 데이터가 없습니다'); return; }
      const lines = [cols.map((c) => U.csvCell((c.meas ? U.measLabel(c.meas, c.unit.symbol) : '') + (c.run ? ' - ' + c.run.name : ''))).join(',')];
      for (const r of this.rows) lines.push(r.vals.map((v, i) => (Number.isFinite(v) ? v * cols[i].unit.scale : '')).join(','));
      U.saveBlob(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }),
        U.safeFile(this.ctx.baseName() + '_' + (this.item.title || '표').slice(0, 40)) + '.csv');
    }
  }

  // ---------- digits ----------
  class DigitsWidget extends Widget {
    constructor(item, ctx) {
      super(item, ctx);
      const cap = ctx.cap;
      const input = item.input;
      this.meas = input ? measOf(cap, input.measId) : null;
      const run = input ? P.resolveRun(cap, input.measId, input.dsId) : null;
      this.runId = run ? run.id : null;
      this.render();
    }
    render() {
      const cap = this.ctx.cap;
      const input = this.item.input || {};
      const m = this.meas;
      const unit = P.unitFor(m, input.unitCode);
      const run = this.runId ? P.runById(cap, this.runId) : null;
      const d = run && m ? P.getData(cap, m.id, run) : null;
      let v = NaN;
      if (d) for (let i = d.v.length - 1; i >= 0; i--) if (Number.isFinite(d.v[i])) { v = d.v[i] * unit.scale; break; }
      const dec = input.decimals != null ? input.decimals : m ? m.decimals : 2;
      this.body.innerHTML =
        '<div class="dig-value">' + (Number.isFinite(v) ? esc(fmtFixed(v, U.columnDecimals([v], dec))) : '– –') + '<span class="dig-unit">' + esc(unit.symbol) + '</span></div>' +
        '<div class="dig-label">' + esc(m ? m.name : '측정값 없음') + '</div>' +
        (run ? '<div class="dig-run">' + esc(run.name) + ' · 마지막 값</div>' : '');
    }
  }

  // ---------- anything else ----------
  class OtherWidget extends Widget {
    constructor(item, ctx) {
      super(item, ctx);
      this.root.classList.add('framed');
      this.body.innerHTML = '<div class="other-box">' + icon('info', 22) + '<div><b>' + esc(item.label || '디스플레이') + '</b><br>이 디스플레이는 아직 이 앱에서 볼 수 없습니다.</div></div>';
    }
  }

  function create(item, ctx) {
    switch (item.type) {
      case 'text': return new TextWidget(item, ctx);
      case 'entry': return new EntryWidget(item, ctx);
      case 'image': return new ImageWidget(item, ctx);
      case 'graph': return new GraphWidget(item, ctx);
      case 'table': return new TableWidget(item, ctx);
      case 'digits': return new DigitsWidget(item, ctx);
      default: return new OtherWidget(item, ctx);
    }
  }

  global.CapWidgets = { create };
})(typeof window !== 'undefined' ? window : globalThis);
