(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const P = window.CapParser;
  const U = window.CapUtil;
  const W = window.CapWidgets;
  const { el, esc, icon } = U;

  // Run colours (consistent across all displays of a file)
  const PALETTE = ['#1f5fd1', '#d62d20', '#1a9c3e', '#e8890c', '#8b3fd9', '#0b95b0', '#d4307e', '#6a9c12', '#4b4fd6', '#c2561a', '#0e8f80', '#9a7a0b'];
  const PAGE_ROWS = 400;

  function loadPref(key, def) {
    try { const v = localStorage.getItem('capviewer.' + key); return v == null ? def : v; } catch (e) { return def; }
  }
  function savePref(key, v) {
    try { localStorage.setItem('capviewer.' + key, v); } catch (e) { /* private mode */ }
  }

  const state = {
    cap: null,
    page: 0,
    mode: loadPref('mode', window.matchMedia('(min-width: 900px)').matches ? 'layout' : 'reflow'),
    zoom: 1,
    widgets: [],
    images: new Map(),
    table: null,
    tableRunId: null,
  };

  // ---------- history ----------
  // Opening a file adds "#파일이름" to the address, so the back button returns to the start
  // screen (and forward goes back to the file). Open panels (data summary, full-screen graph,
  // pictures, PDF, run picker) also get a history entry, so back closes them first.
  const overlays = [];
  let fileSeq = 0;
  const currentFile = () => (history.state && history.state.capFile) || 0;
  function openOverlay(close) {
    overlays.push(close);
    history.pushState({ capOverlay: overlays.length, capFile: currentFile() }, '');
  }
  function closeOverlay() {
    if (overlays.length) history.back();
  }
  window.addEventListener('popstate', (e) => {
    const f = overlays.pop();
    if (f) { f(); return; }
    const id = e.state && e.state.capFile;
    if (id && state.cap && id === state.fileKey) {
      if ($('#viewer').hidden) showFileScreen();
    } else {
      if (id) history.replaceState(null, '', location.pathname + location.search); // that file is no longer open
      showStartScreen();
    }
  });
  function pushFileRoute() {
    state.fileKey = ++fileSeq;
    const st = { capFile: state.fileKey };
    const url = location.pathname + location.search + '#' + encodeURIComponent(baseName());
    // a file opened from a file screen replaces it, so back always leads to the start screen
    if (currentFile()) history.replaceState(st, '', url);
    else history.pushState(st, '', url);
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  function baseName() {
    const n = (state.cap && state.cap.fileName) || 'capstone';
    return n.replace(/\.cap$/i, '') || 'capstone';
  }

  function runColor(run) {
    return PALETTE[(run && run.index != null ? run.index : 0) % PALETTE.length];
  }

  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
  function loadImage(path) {
    if (!state.cap) return Promise.resolve(null);
    const key = String(path).replace(/\\/g, '/').toLowerCase();
    if (!state.images.has(key)) {
      const p = (async () => {
        const zip = state.cap.zip;
        let entry = zip.get(key);
        if (!entry) {
          const base = key.split('/').pop();
          entry = zip.entries.find((e) => e.name.replace(/\\/g, '/').toLowerCase().split('/').pop() === base) || null;
        }
        if (!entry) return null;
        const ext = (entry.name.split('.').pop() || '').toLowerCase();
        if (ext === 'svg') return null; // never render SVG from a file (may contain scripts)
        const bytes = await zip.read(entry);
        return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' }));
      })().catch(() => null);
      state.images.set(key, p);
    }
    return state.images.get(key);
  }

  const ctx = {
    get cap() { return state.cap; },
    get mode() { return state.mode; },
    loadImage,
    runColor,
    openRunSheet,
    openImage,
    openOverlay,
    closeOverlay,
    toast,
    baseName,
  };

  // ---------- reading order for the phone layout ----------
  function split(items, start, end) {
    const sorted = items.slice().sort((a, b) => start(a) - start(b));
    const groups = [];
    let cur = [], curEnd = -Infinity;
    const TOL = 0.04;
    for (const it of sorted) {
      if (cur.length && start(it) >= curEnd - TOL) { groups.push(cur); cur = []; curEnd = -Infinity; }
      cur.push(it);
      curEnd = Math.max(curEnd, end(it));
    }
    if (cur.length) groups.push(cur);
    return groups;
  }
  function readingOrder(items) {
    if (items.length <= 1) return items;
    let g = split(items, (i) => i.y, (i) => i.y + i.h);
    if (g.length > 1) return g.flatMap(readingOrder);
    g = split(items, (i) => i.x, (i) => i.x + i.w);
    if (g.length > 1) return g.flatMap(readingOrder);
    return items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  }

  // ---------- pages ----------
  function destroyWidgets() {
    for (const w of state.widgets) w.destroy();
    state.widgets = [];
  }

  function renderTabs() {
    const tabs = $('#page-tabs');
    tabs.innerHTML = state.cap.pages
      .map((p, i) => '<button type="button" role="tab" data-page="' + i + '" aria-selected="' + (i === state.page) + '"' + (i === state.page ? '' : ' tabindex="-1"') + '>' + esc(p.name) + '</button>')
      .join('');
    const active = tabs.querySelector('[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /** Build the displays of one page. */
  function buildPaper(page, mode, context) {
    const paper = el('div', 'paper');
    const widgets = [];
    // In the original layout, passive boxes (text, pictures) go underneath graphs/tables so their
    // tools stay reachable; Capstone draws text boxes transparently, so nothing visible is lost.
    const passive = (it) => (it.type === 'text' || it.type === 'image' ? 0 : 1);
    const items = mode === 'reflow' ? readingOrder(page.items) : page.items.slice().sort((a, b) => passive(a) - passive(b) || a.z - b.z);
    items.forEach((item, i) => {
      const w = W.create(item, context);
      if (w.hidden) return;
      if (mode === 'layout') {
        const s = w.root.style;
        s.left = item.x * 100 + '%';
        s.top = item.y * 100 + '%';
        s.width = item.w * 100 + '%';
        s.height = item.h * 100 + '%';
        s.zIndex = String(i + 1);
      }
      paper.appendChild(w.root);
      widgets.push(w);
    });
    if (!widgets.length && mode === 'reflow') paper.appendChild(el('p', 'page-empty', '이 페이지에는 표시할 내용이 없습니다.'));
    return { paper, widgets };
  }

  function renderPage() {
    destroyWidgets();
    const cap = state.cap;
    const page = cap.pages[state.page];
    const host = $('#page-host');
    host.className = 'page-host mode-' + state.mode;
    host.replaceChildren();
    const built = buildPaper(page, state.mode, ctx);
    const paper = built.paper;
    state.widgets = built.widgets;
    if (state.mode === 'layout') {
      const frame = el('div', 'paper-frame');
      frame.appendChild(paper);
      host.appendChild(frame);
      applyScale();
    } else {
      host.appendChild(paper);
    }
    for (const w of state.widgets) w.mount();

    const n = cap.pages.length;
    $('#page-num').textContent = state.page + 1 + ' / ' + n;
    $('#page-name').textContent = page.name;
    $('#prev-page').disabled = state.page <= 0;
    $('#next-page').disabled = state.page >= n - 1;
    $('#zoom-ctl').hidden = state.mode !== 'layout';
    $('#mode-btn').innerHTML = state.mode === 'layout' ? icon('reflow', 22) + '<span>세로 보기</span>' : icon('layout', 22) + '<span>원본 배치</span>';
    renderTabs();
    document.title = page.name + ' · ' + (cap.fileName || 'CAP 뷰어');
  }

  function applyScale() {
    if (state.mode !== 'layout' || !state.cap) return;
    const page = state.cap.pages[state.page];
    const host = $('#page-host');
    const frame = host.querySelector('.paper-frame');
    const paper = host.querySelector('.paper');
    if (!frame || !paper) return;
    const avail = Math.max(200, host.clientWidth - 24);
    const s = (avail / page.width) * state.zoom;
    paper.style.width = page.width + 'px';
    paper.style.height = page.height + 'px';
    paper.style.transform = 'scale(' + s + ')';
    frame.style.width = Math.round(page.width * s) + 'px';
    frame.style.height = Math.round(page.height * s) + 'px';
    $('#zoom-reset').textContent = Math.round(state.zoom * 100) + '%';
    for (const w of state.widgets) w.resize();
  }

  function goPage(i) {
    if (!state.cap) return;
    const n = state.cap.pages.length;
    const next = Math.max(0, Math.min(n - 1, i));
    if (next === state.page && state.widgets.length) return;
    state.page = next;
    renderPage();
    window.scrollTo(0, 0);
  }

  // ---------- data summary drawer ----------
  function renderSummary() {
    const cap = state.cap;
    let h = '<section class="info-section"><h3>파일</h3><dl>' +
      '<dt>이름</dt><dd>' + esc(cap.fileName || '-') + '</dd>' +
      '<dt>크기</dt><dd>' + U.fmtBytes(cap.fileSize || 0) + '</dd>' +
      (cap.version ? '<dt>Capstone 버전</dt><dd>' + esc(cap.version) + '</dd>' : '') +
      '<dt>페이지</dt><dd>' + cap.pages.length + '개</dd>' +
      '<dt>런 / 데이터 세트</dt><dd>' + cap.runs.length + '개</dd>' +
      '</dl></section>';

    if (cap.measurements.length) {
      h += '<section class="info-section"><h3>측정값별 데이터</h3>' +
        cap.measurements.map((m) => {
          const runs = cap.runs.filter((r) => r.data.has(m.id));
          const kind = m.kind === 'calc' ? ' <span class="tag">계산값</span>' : m.kind === 'user' ? ' <span class="tag">입력값</span>' : '';
          return '<details class="meas-group"><summary><b>' + esc(U.measLabel(m, P.unitFor(m).symbol)) + '</b>' + kind + ' <span class="muted">· ' + runs.length + '개</span></summary><ul>' +
            runs.map((r) => '<li><span class="dot" style="background:' + runColor(r) + '"></span>' + esc(r.name) + ' <span class="muted">' + r.data.get(m.id).v.length + '개 점</span></li>').join('') +
            '</ul></details>';
        }).join('') + '</section>';
    }

    if (cap.runs.length) {
      h += '<section class="info-section"><h3>런 목록</h3><div class="tscroll"><table class="cs-table"><thead><tr><th>#</th><th>이름</th><th>기록 시각</th><th>길이 (s)</th><th>점</th></tr></thead><tbody>' +
        cap.runs.map((r) => '<tr><td class="idx">' + (r.kind === 'run' ? r.number : '') + '</td><td class="name"><span class="dot" style="background:' + runColor(r) + '"></span>' + esc(r.name) + '</td><td>' + esc(U.fmtDate(r.start)) + '</td><td>' + (r.indexBased ? '' : r.duration.toFixed(2)) + '</td><td>' + r.points + '</td></tr>').join('') +
        '</tbody></table></div></section>';
    }

    if (cap.sensors.length) {
      h += '<section class="info-section"><h3>센서</h3><ul>' +
        cap.sensors.map((s) => '<li><b>' + esc(s.name) + '</b>' + (s.period > 0 ? ' · ' + U.fmt(1 / s.period, 3) + ' Hz' : '') +
          (s.measurements.length ? '<br><span class="muted">' + esc(s.measurements.join(', ')) + '</span>' : '') + '</li>').join('') +
        '</ul></section>';
    }
    if (cap.warnings.length) {
      h += '<section class="info-section"><h3>주의</h3><ul class="warn">' + cap.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></section>';
    }
    if (!cap.runs.length) h += '<p class="hint">이 파일에는 아직 기록된 측정 데이터가 없습니다. (실험 안내용 파일일 수 있어요)</p>';
    $('#dpanel-summary').innerHTML = h;
  }

  function showDrawerTab(name) {
    $('#dtab-summary').setAttribute('aria-selected', String(name === 'summary'));
    $('#dtab-table').setAttribute('aria-selected', String(name === 'table'));
    $('#dpanel-summary').hidden = name !== 'summary';
    $('#dpanel-table').hidden = name !== 'table';
    if (name === 'table') {
      const sel = $('#table-run');
      const runs = state.cap.runs;
      if (!runs.length) {
        sel.innerHTML = '';
        $('#data-table').innerHTML = '';
        $('#table-summary').textContent = '기록된 데이터가 없습니다.';
        $('#more-rows-btn').hidden = true;
        return;
      }
      sel.innerHTML = runs.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('');
      if (!state.tableRunId || !P.runById(state.cap, state.tableRunId)) state.tableRunId = runs[runs.length - 1].id;
      sel.value = state.tableRunId;
      if (!state.table || state.table.runId !== state.tableRunId) renderTable();
    }
  }

  function openDrawer(tab) {
    if (!state.cap) return;
    renderSummary();
    $('#drawer').hidden = false;
    showDrawerTab(tab || 'summary');
    openOverlay(() => { $('#drawer').hidden = true; });
  }

  function unitOf(m) { return P.unitFor(m); }

  function renderTable() {
    const cap = state.cap;
    const run = P.runById(cap, state.tableRunId);
    const tbl = $('#data-table');
    if (!run) { tbl.innerHTML = ''; return; }
    const t = P.tableFor(cap, run);
    state.table = { runId: run.id, columns: t.columns, rows: t.rows, shown: 0 };
    state.table.units = t.columns.map((c) => unitOf(c.meas));
    state.table.decs = t.columns.map((c, i) => U.columnDecimals(t.rows.map((r) => r.vals[i] * state.table.units[i].scale), Math.max(3, c.meas.decimals || 0)));
    tbl.innerHTML = '<thead><tr><th class="idx"></th>' + t.columns.map((c, i) => '<th>' + esc(U.measLabel(c.meas, state.table.units[i].symbol)) + '</th>').join('') + '</tr></thead><tbody></tbody>';
    $('#table-summary').textContent = run.name + ' · ' + t.rows.length + '행' + (run.start ? ' · ' + U.fmtDate(run.start) : '');
    appendRows();
  }

  function appendRows() {
    const T = state.table;
    const tb = $('#data-table tbody');
    const end = Math.min(T.rows.length, T.shown + PAGE_ROWS);
    let html = '';
    for (let i = T.shown; i < end; i++) {
      const r = T.rows[i];
      html += '<tr><td class="idx">' + (i + 1) + '</td>';
      for (let c = 0; c < T.columns.length; c++) html += '<td>' + U.fmtFixed(r.vals[c] * T.units[c].scale, T.decs[c]) + '</td>';
      html += '</tr>';
    }
    tb.insertAdjacentHTML('beforeend', html);
    T.shown = end;
    const left = T.rows.length - end;
    $('#more-rows-btn').hidden = left <= 0;
    $('#more-rows-btn').textContent = '더 보기 (남은 ' + left + '행)';
  }

  function csvForRun(run) {
    const cap = state.cap;
    const t = P.tableFor(cap, run);
    const units = t.columns.map((c) => unitOf(c.meas));
    const lines = [t.columns.map((c, i) => U.csvCell(U.measLabel(c.meas, units[i].symbol))).join(',')];
    for (const r of t.rows) lines.push(r.vals.map((v, i) => (Number.isFinite(v) ? v * units[i].scale : '')).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function csvForAll() {
    const cap = state.cap;
    const cols = [cap.time].concat(cap.measurements);
    const units = cols.map(unitOf);
    const lines = [['Run #', 'Run'].concat(cols.map((m, i) => U.measLabel(m, units[i].symbol))).map(U.csvCell).join(',')];
    for (const run of cap.runs) {
      const t = P.tableFor(cap, run);
      const idx = cols.map((m) => t.columns.findIndex((c) => c.meas === m));
      for (const r of t.rows) {
        const vals = idx.map((i, k) => (i >= 0 && Number.isFinite(r.vals[i]) ? r.vals[i] * units[k].scale : ''));
        lines.push([run.kind === 'run' ? run.number : '', U.csvCell(run.name)].concat(vals).join(','));
      }
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ---------- run picker ----------
  let sheet = null;
  function openRunSheet(opts) {
    sheet = { runs: opts.runs, selected: opts.selected.slice(), onChange: opts.onChange };
    $('#runs-sheet-title').textContent = opts.title || '런 선택';
    $('#runs-search').value = '';
    renderRunList();
    $('#runs-sheet').hidden = false;
    openOverlay(() => { $('#runs-sheet').hidden = true; sheet = null; });
  }
  function renderRunList() {
    const q = $('#runs-search').value.trim().toLowerCase();
    const list = $('#run-list');
    const runs = sheet.runs.filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.number).includes(q));
    if (!sheet.runs.length) { list.innerHTML = '<li class="empty-note">이 그래프에 그릴 수 있는 데이터가 없습니다.</li>'; return; }
    if (!runs.length) { list.innerHTML = '<li class="empty-note">찾는 런이 없습니다.</li>'; return; }
    list.innerHTML = runs.map((r) => {
      const on = sheet.selected.includes(r.id);
      const meta = [r.kind === 'run' ? '#' + r.number : '입력 데이터', U.fmtDate(r.start), r.indexBased ? '' : r.duration.toFixed(2) + ' s', r.points + '개 점'].filter(Boolean).join(' · ');
      return '<li class="run-item"><label><input type="checkbox" data-run="' + esc(r.id) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="run-main"><span class="run-name">' + esc(r.name) + '</span><span class="run-meta">' + esc(meta) + '</span></span>' +
        '<span class="dot" style="background:' + runColor(r) + '"></span></label></li>';
    }).join('');
  }
  function sheetChanged() {
    const order = sheet.runs.map((r) => r.id).filter((id) => sheet.selected.includes(id));
    sheet.selected = order;
    sheet.onChange(order);
  }

  // ---------- image viewer ----------
  function openImage(url, title) {
    $('#lightbox-img').src = url;
    $('#lightbox-caption').textContent = title || '';
    $('#lightbox').hidden = false;
    document.body.classList.add('no-scroll');
    openOverlay(() => { $('#lightbox').hidden = true; document.body.classList.remove('no-scroll'); });
  }

  // ---------- PDF export ----------
  const A4 = { w: 2339, h: 1654, wPt: 841.89, hPt: 595.28 }; // landscape, ~200 dpi
  let html2canvasLoading = null;
  function loadHtml2canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (!html2canvasLoading) {
      html2canvasLoading = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'vendor/html2canvas.min.js';
        sc.onload = () => (window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas 없음')));
        sc.onerror = () => { html2canvasLoading = null; reject(new Error('PDF 변환 모듈을 불러오지 못했습니다')); };
        document.head.appendChild(sc);
      });
    }
    return html2canvasLoading;
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Render one workbook page (original layout) to a canvas. */
  async function capturePage(page, html2canvas) {
    const stage = $('#export-stage');
    stage.className = 'export-stage page-host mode-layout export';
    const exportCtx = Object.create(ctx, { mode: { value: 'layout' }, exporting: { value: true } });
    const { paper, widgets } = buildPaper(page, 'layout', exportCtx);
    paper.style.width = page.width + 'px';
    paper.style.height = page.height + 'px';
    stage.replaceChildren(paper);
    try {
      for (const w of widgets) w.mount();
      await nextFrame();
      await Promise.race([Promise.all(widgets.map((w) => w.ready())), sleep(8000)]);
      for (const w of widgets) if (w.fitToBox) await w.fitToBox();
      await nextFrame();
      for (const w of widgets) await w.ready(); // charts draw at their final size
      const scale = Math.min(2.5, 2400 / page.width);
      return await html2canvas(paper, {
        scale,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: Math.max(page.width + 40, window.innerWidth),
        windowHeight: Math.max(page.height + 40, window.innerHeight),
        onclone: (doc) => { const s = doc.getElementById('export-stage'); if (s) s.style.opacity = '1'; },
      });
    } finally {
      for (const w of widgets) w.destroy();
      stage.replaceChildren();
    }
  }

  /** Put the captured page on a PDF page (A4 landscape with a footer, or the page's own size). */
  function composePage(shot, page, index, count, paperMode) {
    if (paperMode === 'page') {
      const ratio = shot.height / shot.width;
      return { canvas: shot, wPt: A4.wPt, hPt: A4.wPt * ratio };
    }
    const c = document.createElement('canvas');
    c.width = A4.w;
    c.height = A4.h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    const margin = 70, footer = 70;
    const aw = c.width - 2 * margin, ah = c.height - 2 * margin - footer;
    const k = Math.min(aw / shot.width, ah / shot.height);
    const w = Math.round(shot.width * k), h = Math.round(shot.height * k);
    const x = Math.round((c.width - w) / 2), y = Math.round((c.height - h - footer) / 2);
    g.imageSmoothingQuality = 'high';
    g.drawImage(shot, x, y, w, h);
    g.strokeStyle = '#c3c8d0';
    g.lineWidth = 2;
    g.strokeRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = '#5b6370';
    g.font = '28px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    g.textBaseline = 'middle';
    const fy = y + h + footer / 2 + 10;
    g.textAlign = 'left';
    const left = (state.cap.fileName || '') + '  ·  ' + page.name;
    g.fillText(left.length > 90 ? left.slice(0, 89) + '…' : left, x, fy);
    g.textAlign = 'right';
    g.fillText(index + 1 + ' / ' + count, x + w, fy);
    return { canvas: c, wPt: A4.wPt, hPt: A4.hPt };
  }

  function toJpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('이미지 변환 실패'))), 'image/jpeg', 0.9);
    });
  }

  const pdfJob = { running: false, cancel: false, blob: null, name: '' };

  async function makePdf(opts, onProgress) {
    const cap = state.cap;
    const indices = opts.range === 'current' ? [state.page] : cap.pages.map((_, i) => i);
    const html2canvas = await loadHtml2canvas();
    const out = [];
    for (let k = 0; k < indices.length; k++) {
      if (pdfJob.cancel) throw new Error('취소했습니다');
      const page = cap.pages[indices[k]];
      onProgress(k, indices.length, page.name);
      const shot = await capturePage(page, html2canvas);
      const composed = composePage(shot, page, k, indices.length, opts.paper);
      const jpeg = await toJpeg(composed.canvas);
      out.push({ jpeg, width: composed.canvas.width, height: composed.canvas.height, widthPt: composed.wPt, heightPt: composed.hPt, title: page.name });
      shot.width = shot.height = 0; // free memory early (phones)
      if (composed.canvas !== shot) composed.canvas.width = composed.canvas.height = 0;
    }
    onProgress(indices.length, indices.length, '');
    return window.CapPdf.build(out, { title: (cap.fileName || 'Capstone').replace(/\.cap$/i, '') });
  }

  function pdfView(which) {
    $('#pdf-options').hidden = which !== 'options';
    $('#pdf-progress').hidden = which !== 'progress';
    $('#pdf-done').hidden = which !== 'done';
  }

  function openPdfSheet() {
    if (!state.cap) return;
    if (!pdfJob.running) {
      pdfView(pdfJob.blob ? 'done' : 'options');
      $('#pdf-range-all-label').textContent = '전체 페이지 (' + state.cap.pages.length + '쪽)';
      $('#pdf-range-current-label').textContent = '지금 보는 페이지만 (' + state.cap.pages[state.page].name + ')';
    }
    $('#pdf-sheet').hidden = false;
    openOverlay(() => {
      $('#pdf-sheet').hidden = true;
      if (pdfJob.running) pdfJob.cancel = true;
    });
  }

  async function startPdf() {
    if (pdfJob.running) return;
    const opts = {
      range: document.querySelector('input[name="pdf-range"]:checked').value,
      paper: document.querySelector('input[name="pdf-paper"]:checked').value,
    };
    pdfJob.running = true;
    pdfJob.cancel = false;
    pdfJob.blob = null;
    pdfView('progress');
    $('#pdf-bar').style.transform = 'scaleX(0)';
    $('#pdf-status').textContent = 'PDF 변환 준비 중…';
    try {
      const blob = await makePdf(opts, (k, n, name) => {
        $('#pdf-status').textContent = k < n ? k + 1 + ' / ' + n + ' 페이지 변환 중… ' + name : 'PDF 파일 만드는 중…';
        $('#pdf-bar').style.transform = 'scaleX(' + (k / n) + ')';
      });
      pdfJob.blob = blob;
      pdfJob.name = U.safeFile(baseName() + (opts.range === 'current' ? '_' + state.cap.pages[state.page].name : '')) + '.pdf';
      $('#pdf-result').textContent = (opts.range === 'current' ? 1 : state.cap.pages.length) + '쪽 · ' + U.fmtBytes(blob.size);
      pdfView('done');
    } catch (e) {
      console.error(e);
      pdfView('options');
      if (!pdfJob.cancel) toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e));
    } finally {
      pdfJob.running = false;
    }
  }

  // ---------- screens ----------
  function setHeader(cap) {
    $('#pdf-btn').hidden = !cap;
    $('#doc-title').textContent = cap ? cap.fileName || 'Capstone 파일' : 'CAP 뷰어';
    $('#doc-sub').textContent = cap
      ? cap.pages.length + '개 페이지 · ' + (cap.runs.length ? cap.runs.length + '개 런' : '측정 데이터 없음')
      : 'PASCO Capstone 파일 보기';
    if (!cap) document.title = 'CAP 뷰어';
  }
  function showStartScreen() {
    destroyWidgets();
    $('#error-box').hidden = true;
    setHeader(null);
    showView('welcome');
    window.scrollTo(0, 0);
  }
  function showFileScreen() {
    setHeader(state.cap);
    showView('viewer');
    renderPage();
  }

  // ---------- loading ----------
  function showView(which) {
    $('#welcome').hidden = which !== 'welcome';
    $('#loading').hidden = which !== 'loading';
    $('#viewer').hidden = which !== 'viewer';
    $('#controls').hidden = which !== 'viewer';
    $('#page-tabs').hidden = which !== 'viewer';
    if (which !== 'viewer') $('#zoom-ctl').hidden = true;
    document.body.classList.toggle('has-controls', which === 'viewer');
  }

  function showError(msg) {
    $('#error-box').textContent = msg;
    $('#error-box').hidden = false;
    showView(state.cap ? 'viewer' : 'welcome');
    if (state.cap) toast(msg);
  }

  function synthesizePage(cap) {
    const Z = P.ZERO_ID;
    const latest = cap.runs.filter((r) => r.kind === 'run').pop() || cap.runs[cap.runs.length - 1];
    const cols = (latest && !latest.indexBased ? [cap.time] : []).concat(cap.measurements.filter((m) => latest && latest.data.has(m.id)));
    return {
      name: '데이터',
      width: 1120,
      height: 580,
      items: [
        { type: 'graph', x: 0.01, y: 0.02, w: 0.58, h: 0.96, z: 1, title: '', titleVisible: false, frame: false,
          graph: { x: null, y: [], runs: latest ? [latest.id] : [], lines: true, points: false, fit: 'none' } },
        { type: 'table', x: 0.61, y: 0.02, w: 0.38, h: 0.96, z: 2, title: '', titleVisible: false, frame: false,
          columns: cols.map((m) => ({ measId: m.id, dsId: Z, unitCode: 0, decimals: null })) },
      ],
    };
  }

  async function openFile(file) {
    if (!file) return;
    $('#error-box').hidden = true;
    const prev = state.cap;
    showView('loading');
    $('#loading-text').textContent = '여는 중…';
    $('#progress-bar').style.transform = 'scaleX(0)';
    try {
      const cap = await P.parseCap(file, (msg, p) => {
        $('#loading-text').textContent = msg;
        $('#progress-bar').style.transform = 'scaleX(' + Math.min(1, Math.max(0, p)) + ')';
      });
      if (!cap.pages.length) {
        if (!cap.runs.length) throw new Error('이 파일에는 페이지도 측정 데이터도 없습니다.');
        cap.pages = [synthesizePage(cap)];
      }
      loadCap(cap);
    } catch (err) {
      console.error(err);
      state.cap = prev;
      showError('파일을 열지 못했습니다: ' + (err && err.message ? err.message : err));
    }
  }

  function loadCap(cap) {
    destroyWidgets();
    for (const p of state.images.values()) p.then((u) => u && URL.revokeObjectURL(u));
    state.images = new Map();
    state.cap = cap;
    state.page = cap.currentPage || 0;
    state.zoom = 1;
    state.table = null;
    state.tableRunId = null;
    pdfJob.blob = null;
    pushFileRoute();
    showFileScreen();
    if (cap.warnings.length) toast('일부 내용을 읽지 못했습니다. 데이터 요약에서 확인하세요.');
  }

  async function loadDemo() {
    try {
      showView('loading');
      $('#loading-text').textContent = '예제 파일 받는 중…';
      const res = await fetch('examples/demo.cap');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await openFile(new File([await res.blob()], '예제-경사면 수레.cap'));
    } catch (e) {
      showError('예제 파일을 불러오지 못했습니다: ' + e.message);
    }
  }

  // ---------- events ----------
  $('#summary-btn').innerHTML = icon('summary', 22) + '<span>데이터 요약</span>';
  $('#prev-page').innerHTML = icon('prev', 24);
  $('#next-page').innerHTML = icon('next', 24);
  $('#drawer-close').innerHTML = icon('close', 22);
  $('#lightbox-close').innerHTML = icon('close', 24);
  $('#zoom-in').innerHTML = icon('zoomIn', 20);
  $('#zoom-out').innerHTML = icon('zoomOut', 20);

  $('#file-input').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    openFile(f);
  });
  $('#demo-btn').addEventListener('click', loadDemo);

  $('#page-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) goPage(Number(b.dataset.page));
  });
  $('#page-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    goPage(state.page + (e.key === 'ArrowRight' ? 1 : -1));
    const a = $('#page-tabs [aria-selected="true"]');
    if (a) a.focus();
  });
  $('#prev-page').addEventListener('click', () => goPage(state.page - 1));
  $('#next-page').addEventListener('click', () => goPage(state.page + 1));
  $('#mode-btn').addEventListener('click', () => {
    state.mode = state.mode === 'layout' ? 'reflow' : 'layout';
    state.zoom = 1;
    savePref('mode', state.mode);
    renderPage();
    toast(state.mode === 'layout' ? 'Capstone 원본 배치로 보기' : '화면에 맞게 세로로 보기');
  });
  $('#zoom-in').addEventListener('click', () => { state.zoom = Math.min(4, state.zoom * 1.25); applyScale(); });
  $('#zoom-out').addEventListener('click', () => { state.zoom = Math.max(0.5, state.zoom / 1.25); applyScale(); });
  $('#zoom-reset').addEventListener('click', () => { state.zoom = 1; applyScale(); });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyScale, 80);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlays.length) { closeOverlay(); return; }
    if (!state.cap || overlays.length || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
    if (e.key === 'PageDown') { e.preventDefault(); goPage(state.page + 1); }
    if (e.key === 'PageUp') { e.preventDefault(); goPage(state.page - 1); }
  });

  // drawer
  $('#summary-btn').addEventListener('click', () => openDrawer('summary'));
  $('#drawer-close').addEventListener('click', closeOverlay);
  $('#drawer').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay(); });
  $('#dtab-summary').addEventListener('click', () => showDrawerTab('summary'));
  $('#dtab-table').addEventListener('click', () => showDrawerTab('table'));
  $('#table-run').addEventListener('change', (e) => { state.tableRunId = e.target.value; renderTable(); });
  $('#more-rows-btn').addEventListener('click', appendRows);
  $('#csv-run-btn').addEventListener('click', () => {
    const run = P.runById(state.cap, state.tableRunId);
    if (run) U.saveBlob(new Blob([csvForRun(run)], { type: 'text/csv;charset=utf-8' }), U.safeFile(baseName() + '_' + run.name) + '.csv');
  });
  $('#csv-all-btn').addEventListener('click', () => {
    if (!state.cap.runs.length) { toast('저장할 데이터가 없습니다'); return; }
    U.saveBlob(new Blob([csvForAll()], { type: 'text/csv;charset=utf-8' }), U.safeFile(baseName() + '_전체') + '.csv');
  });
  if (navigator.canShare) {
    try {
      if (navigator.canShare({ files: [new File(['a'], 'a.csv', { type: 'text/csv' })] })) $('#share-btn').hidden = false;
    } catch (e) { /* not supported */ }
  }
  $('#share-btn').addEventListener('click', async () => {
    const run = P.runById(state.cap, state.tableRunId);
    if (!run) return;
    const file = new File([csvForRun(run)], U.safeFile(baseName() + '_' + run.name) + '.csv', { type: 'text/csv' });
    try { await navigator.share({ files: [file], title: run.name }); } catch (e) { if (e && e.name !== 'AbortError') toast('공유하지 못했습니다'); }
  });

  // PDF
  $('#pdf-btn').innerHTML = icon('pdf', 18) + '<span>PDF</span>';
  $('#pdf-close').innerHTML = icon('close', 22);
  $('#pdf-btn').addEventListener('click', openPdfSheet);
  $('#pdf-close').addEventListener('click', closeOverlay);
  $('#pdf-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget && !pdfJob.running) closeOverlay(); });
  $('#pdf-start').addEventListener('click', startPdf);
  $('#pdf-cancel').addEventListener('click', () => { pdfJob.cancel = true; $('#pdf-status').textContent = '취소하는 중…'; });
  $('#pdf-again').addEventListener('click', () => { pdfJob.blob = null; pdfView('options'); });
  $('#pdf-save').addEventListener('click', () => { if (pdfJob.blob) U.saveBlob(pdfJob.blob, pdfJob.name); });
  $('#pdf-share').addEventListener('click', async () => {
    if (!pdfJob.blob) return;
    const file = new File([pdfJob.blob], pdfJob.name, { type: 'application/pdf' });
    try { await navigator.share({ files: [file], title: pdfJob.name }); } catch (e) { if (e && e.name !== 'AbortError') toast('공유하지 못했습니다'); }
  });
  try {
    if (navigator.canShare && navigator.canShare({ files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })] })) $('#pdf-share').hidden = false;
  } catch (e) { /* not supported */ }

  // run sheet
  $('#runs-done').addEventListener('click', closeOverlay);
  $('#runs-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay(); });
  $('#runs-search').addEventListener('input', renderRunList);
  $('#run-list').addEventListener('change', (e) => {
    const id = e.target.getAttribute('data-run');
    if (!id || !sheet) return;
    sheet.selected = e.target.checked ? sheet.selected.concat(id) : sheet.selected.filter((s) => s !== id);
    sheetChanged();
  });
  $('#runs-all').addEventListener('click', () => {
    for (const cb of document.querySelectorAll('#run-list input[data-run]')) if (!sheet.selected.includes(cb.dataset.run)) sheet.selected.push(cb.dataset.run);
    sheetChanged();
    renderRunList();
  });
  $('#runs-none').addEventListener('click', () => { sheet.selected = []; sheetChanged(); renderRunList(); });

  // lightbox
  $('#lightbox-close').addEventListener('click', closeOverlay);
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox' || e.target.classList.contains('lightbox-scroll')) closeOverlay(); });

  // drag & drop (desktop)
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    dragDepth++;
    $('#drop-overlay').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#drop-overlay').hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop-overlay').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  // Files shared to the installed app (Android share sheet) or opened via file handler.
  async function checkSharedFile() {
    const params = new URLSearchParams(location.search);
    if (params.has('shared') && 'caches' in window) {
      try {
        const cache = await caches.open('cap-viewer-share');
        const res = await cache.match('shared-file');
        if (res) {
          const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared.cap');
          const blob = await res.blob();
          await cache.delete('shared-file');
          history.replaceState(null, '', location.pathname);
          openFile(new File([blob], name));
          return;
        }
      } catch (e) {
        console.warn(e);
      }
      history.replaceState(null, '', location.pathname);
    }
    if (params.has('demo')) loadDemo();
  }
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (params.files && params.files.length) openFile(await params.files[0].getFile());
    });
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e));
  }

  // A reload keeps "#파일이름" in the address, but the file itself is not kept: start fresh.
  if (location.hash || currentFile()) history.replaceState(null, '', location.pathname + location.search);
  checkSharedFile();

  // for tests / debugging
  window.CapViewerApp = { state, openFile, goPage, computeStats: U.computeStats, makePdf };
})();
