(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const { parseCap, seriesFor, tableFor } = window.CapParser;

  const PALETTE_LIGHT = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#ea580c', '#0d9488', '#a16207'];
  const PALETTE_DARK = ['#6b9bff', '#ff6b6b', '#4ade80', '#fbbf24', '#c084fc', '#22d3ee', '#f472b6', '#a3e635', '#818cf8', '#fb923c', '#2dd4bf', '#facc15'];
  const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const KO_NAMES = {
    time: '시간', position: '위치', velocity: '속도', acceleration: '가속도', force: '힘',
    temperature: '온도', voltage: '전압', current: '전류', pressure: '압력', angle: '각도',
    'angular velocity': '각속도', 'angular acceleration': '각가속도', 'magnetic field strength': '자기장 세기',
    'light intensity': '빛의 세기', 'sound level': '소리 크기', 'sound intensity': '소리 세기', 'relative humidity': '상대 습도',
    'x acceleration': 'x 가속도', 'y acceleration': 'y 가속도', 'z acceleration': 'z 가속도',
    'resultant acceleration': '합성 가속도', 'x velocity': 'x 속도', 'y velocity': 'y 속도',
    'x position': 'x 위치', 'y position': 'y 위치', 'heart rate': '심박수', energy: '에너지', power: '일률',
    'kinetic energy': '운동 에너지', momentum: '운동량', 'ph': 'pH', conductivity: '전도도', 'dissolved oxygen': '용존 산소',
    'absolute pressure': '절대 압력', 'gauge pressure': '계기 압력', distance: '거리', speed: '속력', frequency: '진동수',
  };

  const PAGE_ROWS = 400;

  const state = {
    cap: null,
    selected: [], // run ids
    colorSlot: new Map(), // run id -> palette slot
    xId: null,
    yId: null,
    fit: 'none',
    range: null,
    tableRunId: null,
    table: null,
    tableShown: 0,
  };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function fmt(v, sig) {
    sig = sig || 4;
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e6 || a < 1e-4) {
      const [m, e] = v.toExponential(sig - 1).split('e');
      return m + '×10' + String(Number(e)).replace(/./g, (c) => SUP[c] || c);
    }
    return String(Number(v.toPrecision(sig)));
  }
  // Fixed-decimal formatting for tables (same decimals for a whole column).
  function fmtFixed(v, d) {
    if (!Number.isFinite(v)) return '';
    if (Math.abs(v) >= 1e9) return fmt(v, 6);
    const s = v.toFixed(d);
    return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
  }
  function columnDecimals(values, base) {
    let maxAbs = 0;
    for (const v of values) if (Number.isFinite(v) && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    let d = Math.max(3, base == null ? 3 : base);
    if (maxAbs > 0 && maxAbs < 1) d = Math.max(d, Math.ceil(-Math.log10(maxAbs)) + 2);
    return Math.min(d, 9);
  }

  function palette() {
    return darkMQ && darkMQ.matches ? PALETTE_DARK : PALETTE_LIGHT;
  }
  function colorOf(runId) {
    const p = palette();
    const slot = state.colorSlot.get(runId);
    return p[(slot == null ? 0 : slot) % p.length];
  }

  function koName(name) {
    return KO_NAMES[String(name).trim().toLowerCase()] || '';
  }
  function measById(id) {
    const cap = state.cap;
    if (!cap) return null;
    if (id === cap.time.id) return cap.time;
    return cap.measurements.find((m) => m.id === id) || null;
  }
  function axisLabel(m) {
    if (!m) return '';
    const ko = koName(m.name);
    const base = ko || m.name;
    return m.unit ? base + ' (' + m.unit + ')' : base;
  }
  function optionLabel(m) {
    const ko = koName(m.name);
    let s = ko && ko !== m.name ? ko + ' · ' + m.name : m.name;
    if (m.unit) s += ' [' + m.unit + ']';
    return s;
  }
  function shortName(m) {
    return m ? koName(m.name) || m.name : '';
  }
  function runById(id) {
    return state.cap ? state.cap.runs.find((r) => r.id === id) : null;
  }
  function fmtDate(d) {
    if (!d) return '';
    try {
      return d.toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return d.toISOString();
    }
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function baseName() {
    const n = (state.cap && state.cap.fileName) || 'capstone';
    return n.replace(/\.cap$/i, '') || 'capstone';
  }
  function safeFile(s) {
    return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'data';
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // ---------- statistics ----------
  function computeStats(x, y, range) {
    const xs = [];
    const ys = [];
    for (let i = 0; i < y.length; i++) {
      const xv = x[i], yv = y[i];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      if (range && (xv < range[0] || xv > range[1])) continue;
      xs.push(xv);
      ys.push(yv);
    }
    const n = ys.length;
    if (!n) return { n: 0 };
    let sum = 0, min = Infinity, max = -Infinity, sx = 0;
    for (let i = 0; i < n; i++) {
      sum += ys[i];
      sx += xs[i];
      if (ys[i] < min) min = ys[i];
      if (ys[i] > max) max = ys[i];
    }
    const mean = sum / n;
    const xm = sx / n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (ys[i] - mean) * (ys[i] - mean);
    const std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < n; i++) { if (xs[i] < xmin) xmin = xs[i]; if (xs[i] > xmax) xmax = xs[i]; }

    const res = { n, mean, min, max, std, xmin, xmax, linear: null, quad: null };

    // linear least squares (x centered)
    if (n >= 2) {
      let sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) { const u = xs[i] - xm; sxx += u * u; sxy += u * (ys[i] - mean); }
      if (sxx > 0) {
        const m = sxy / sxx;
        const b = mean - m * xm;
        let sr = 0;
        for (let i = 0; i < n; i++) { const e = ys[i] - (m * xs[i] + b); sr += e * e; }
        res.linear = { m, b, r2: ss > 0 ? 1 - sr / ss : 1 };
      }
    }
    // quadratic least squares (x centered)
    if (n >= 3) {
      let s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
      for (let i = 0; i < n; i++) {
        const u = xs[i] - xm, u2 = u * u;
        s2 += u2; s3 += u2 * u; s4 += u2 * u2;
        t0 += ys[i]; t1 += u * ys[i]; t2 += u2 * ys[i];
      }
      const s1 = 0, s0 = n;
      const sol = solve3([[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]], [t2, t1, t0]);
      if (sol) {
        const [a, bb, c] = sol;
        const A = a, B = bb - 2 * a * xm, C = a * xm * xm - bb * xm + c;
        let sr = 0;
        for (let i = 0; i < n; i++) { const e = ys[i] - (A * xs[i] * xs[i] + B * xs[i] + C); sr += e * e; }
        res.quad = { A, B, C, r2: ss > 0 ? 1 - sr / ss : 1 };
      }
    }
    return res;
  }

  function solve3(M, v) {
    const a = M.map((r, i) => [...r, v[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-300) return null;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  }

  // ---------- chart ----------
  const chart = new window.CapChart($('#chart'), {
    onPick: renderReadout,
    onSelect: (sel) => {
      state.range = sel;
      renderStats();
    },
  });

  function currentSeries() {
    const cap = state.cap;
    const out = [];
    const missing = new Set();
    for (const id of state.selected) {
      const run = runById(id);
      if (!run) continue;
      const s = seriesFor(cap, run, state.xId, state.yId);
      if (!s || !s.y.length) { missing.add(id); continue; }
      out.push({ id, run, label: run.name, color: colorOf(id), x: s.x, y: s.y, sorted: state.xId === cap.time.id });
    }
    return { series: out, missing };
  }

  let lastSeries = [];
  function renderGraph(keepView) {
    if (!state.cap) return;
    const { series, missing } = currentSeries();
    lastSeries = series;
    const xm = measById(state.xId);
    const ym = measById(state.yId);
    chart.setData(series, { xLabel: axisLabel(xm), yLabel: axisLabel(ym), keepView });
    $('#chart-empty').hidden = series.length > 0;
    $('#chart-empty').textContent = state.selected.length ? '선택한 런에 이 측정값 데이터가 없습니다.' : '위의 “런 선택”에서 볼 런을 골라 주세요.';
    renderLegend(missing);
    renderStats();
  }

  function renderLegend(missing) {
    const el = $('#legend');
    el.innerHTML = state.selected
      .map((id) => {
        const run = runById(id);
        if (!run) return '';
        const miss = missing && missing.has(id);
        return '<span class="legend-chip' + (miss ? ' missing' : '') + '" title="' + esc(run.name) + (miss ? ' (데이터 없음)' : '') + '">' +
          '<span class="dot" style="background:' + colorOf(id) + '"></span>' +
          '<span class="name">' + esc(run.name) + '</span>' +
          '<button type="button" data-remove="' + esc(id) + '" aria-label="' + esc(run.name) + ' 숨기기">×</button></span>';
      })
      .join('');
    $('#runs-count').textContent = state.selected.length + '개 / ' + state.cap.runs.length + '개';
  }

  function renderReadout(p) {
    const el = $('#readout');
    if (!p) {
      el.innerHTML = '<span class="muted">그래프를 탭하면 값을 읽을 수 있어요</span>';
      return;
    }
    const xm = measById(state.xId);
    const ym = measById(state.yId);
    el.innerHTML =
      '<span class="dot" style="background:' + p.series.color + '"></span>' +
      '<b>' + esc(p.series.label) + '</b>' +
      '<span>' + esc(shortName(xm)) + ' = <b>' + (xm === state.cap.time ? fmtFixed(p.x, 3) : fmt(p.x)) + '</b> ' + esc(xm ? xm.unit : '') + '</span>' +
      '<span>' + esc(shortName(ym)) + ' = <b>' + fmt(p.y) + '</b> ' + esc(ym ? ym.unit : '') + '</span>';
  }

  function slopeUnit(yu, xu) {
    if (!yu && !xu) return '';
    if (!xu) return yu;
    if (yu === 'm' && xu === 's') return 'm/s';
    if (yu === 'm/s' && xu === 's') return 'm/s²';
    return (yu || '1') + '/' + xu;
  }

  function renderStats() {
    const el = $('#stats');
    const xm = measById(state.xId);
    const ym = measById(state.yId);
    const r = state.range;
    $('#stats-scope').textContent = r
      ? '선택 구간 ' + fmt(r[0]) + ' ~ ' + fmt(r[1]) + (xm && xm.unit ? ' ' + xm.unit : '')
      : '전체 데이터';
    $('#clear-range-btn').hidden = !r;

    if (!lastSeries.length) {
      el.innerHTML = '<p class="empty-note">표시할 데이터가 없습니다.</p>';
      chart.setFits([]);
      return;
    }
    const yu = ym ? ym.unit : '';
    const xu = xm ? xm.unit : '';
    const u = (s) => (s ? ' ' + esc(s) : '');
    const fits = [];
    el.innerHTML = lastSeries
      .map((s) => {
        const st = computeStats(s.x, s.y, r);
        let html = '<div class="stat-card"><div class="stat-title"><span class="dot" style="background:' + s.color + '"></span><span class="name">' + esc(s.label) + '</span></div>';
        if (!st.n) return html + '<p class="empty-note">이 구간에 데이터가 없습니다.</p></div>';
        html += '<dl class="stat-grid">' +
          '<div><dt>평균</dt><dd>' + fmt(st.mean) + u(yu) + '</dd></div>' +
          '<div><dt>최소</dt><dd>' + fmt(st.min) + u(yu) + '</dd></div>' +
          '<div><dt>최대</dt><dd>' + fmt(st.max) + u(yu) + '</dd></div>' +
          '<div><dt>표준편차</dt><dd>' + fmt(st.std) + u(yu) + '</dd></div>' +
          '<div><dt>범위(최대−최소)</dt><dd>' + fmt(st.max - st.min) + u(yu) + '</dd></div>' +
          '<div><dt>데이터 수</dt><dd>' + st.n + '</dd></div>' +
          '</dl>';
        if (state.fit === 'linear') {
          if (st.linear) {
            const L = st.linear;
            fits.push({ color: s.color, x0: st.xmin, x1: st.xmax, fn: (x) => L.m * x + L.b });
            html += '<div class="fit-box"><div class="eq">y = mx + b</div>' +
              '기울기 m = <b>' + fmt(L.m) + '</b>' + u(slopeUnit(yu, xu)) +
              ' · 절편 b = <b>' + fmt(L.b) + '</b>' + u(yu) +
              ' · R² = <b>' + L.r2.toFixed(4) + '</b></div>';
          } else html += '<div class="fit-box">직선 맞춤을 하려면 점이 2개 이상 필요합니다.</div>';
        } else if (state.fit === 'quad') {
          if (st.quad) {
            const Q = st.quad;
            fits.push({ color: s.color, x0: st.xmin, x1: st.xmax, fn: (x) => Q.A * x * x + Q.B * x + Q.C });
            const isPosTime = ym && xm && ym.unit === 'm' && xm.unit === 's';
            html += '<div class="fit-box"><div class="eq">y = Ax² + Bx + C</div>' +
              'A = <b>' + fmt(Q.A) + '</b> · B = <b>' + fmt(Q.B) + '</b> · C = <b>' + fmt(Q.C) + '</b> · R² = <b>' + Q.r2.toFixed(4) + '</b>' +
              (isPosTime ? '<br><span class="muted">가속도 2A = ' + fmt(2 * Q.A) + ' m/s²</span>' : '') +
              '</div>';
          } else html += '<div class="fit-box">2차 맞춤을 하려면 점이 3개 이상 필요합니다.</div>';
        }
        return html + '</div>';
      })
      .join('');
    chart.setFits(fits);
  }

  // ---------- runs sheet ----------
  function assignColor(id) {
    if (state.colorSlot.has(id)) return;
    const used = new Set(state.selected.filter((s) => s !== id).map((s) => state.colorSlot.get(s)));
    let slot = 0;
    while (used.has(slot)) slot++;
    state.colorSlot.set(id, slot);
  }
  function setSelected(ids) {
    const valid = ids.filter((id) => runById(id));
    for (const id of Array.from(state.colorSlot.keys())) if (!valid.includes(id)) state.colorSlot.delete(id);
    state.selected = [];
    for (const id of valid) {
      state.selected.push(id);
      assignColor(id);
    }
  }
  function toggleRun(id, on) {
    if (on && !state.selected.includes(id)) {
      state.selected.push(id);
      assignColor(id);
    } else if (!on) {
      state.selected = state.selected.filter((s) => s !== id);
      state.colorSlot.delete(id);
    }
  }

  function renderRunList() {
    const q = $('#runs-search').value.trim().toLowerCase();
    const list = $('#run-list');
    const runs = state.cap.runs.filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.number).includes(q));
    if (!runs.length) {
      list.innerHTML = '<li class="empty-note">찾는 런이 없습니다.</li>';
      return;
    }
    list.innerHTML = runs
      .map((r) => {
        const on = state.selected.includes(r.id);
        const meta = [r.number < 100000 ? '#' + r.number : '', fmtDate(r.start), r.duration ? r.duration.toFixed(2) + ' s' : '', r.points + '개 점'].filter(Boolean).join(' · ');
        return '<li class="run-item"><label>' +
          '<input type="checkbox" data-run="' + esc(r.id) + '"' + (on ? ' checked' : '') + '>' +
          '<span class="run-main"><div class="run-name">' + esc(r.name) + '</div><div class="run-meta">' + esc(meta) + '</div></span>' +
          '<span class="dot' + (on ? '' : ' off') + '" style="background:' + (on ? colorOf(r.id) : 'transparent') + '"></span>' +
          '</label></li>';
      })
      .join('');
  }

  let lastFocus = null;
  function openRunsSheet() {
    lastFocus = document.activeElement;
    $('#runs-search').value = '';
    renderRunList();
    $('#runs-sheet').hidden = false;
    $('#runs-done').focus();
  }
  function closeRunsSheet() {
    $('#runs-sheet').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---------- table ----------
  function renderTableRunSelect() {
    const sel = $('#table-run');
    sel.innerHTML = state.cap.runs.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('');
    if (!state.tableRunId || !runById(state.tableRunId)) state.tableRunId = state.selected[state.selected.length - 1] || state.cap.runs[0].id;
    sel.value = state.tableRunId;
  }

  function renderTable() {
    const run = runById(state.tableRunId);
    const tbl = $('#data-table');
    if (!run) { tbl.innerHTML = ''; return; }
    state.table = tableFor(state.cap, run);
    state.table.runId = run.id;
    state.table.decs = state.table.cols.map((c, ci) => columnDecimals(state.table.rows.map((r) => r.vals[ci]), c.decimals));
    state.tableShown = 0;
    const t = state.cap.time;
    tbl.innerHTML = '<thead><tr><th>' + esc(axisLabel(t)) + '</th>' +
      state.table.cols.map((c) => '<th>' + esc(axisLabel(c)) + '</th>').join('') +
      '</tr></thead><tbody></tbody>';
    $('#table-summary').textContent = run.name + ' · ' + state.table.rows.length + '행 · ' + state.table.cols.length + '개 측정값' + (run.start ? ' · ' + fmtDate(run.start) : '');
    appendRows();
  }

  function appendRows() {
    const tb = $('#data-table tbody');
    const { cols, rows, decs } = state.table;
    const end = Math.min(rows.length, state.tableShown + PAGE_ROWS);
    let html = '';
    for (let i = state.tableShown; i < end; i++) {
      const r = rows[i];
      html += '<tr><td>' + fmtFixed(r.t, 3) + '</td>';
      for (let c = 0; c < cols.length; c++) html += '<td>' + fmtFixed(r.vals[c], decs[c]) + '</td>';
      html += '</tr>';
    }
    tb.insertAdjacentHTML('beforeend', html);
    state.tableShown = end;
    const left = rows.length - end;
    const more = $('#more-rows-btn');
    more.hidden = left <= 0;
    more.textContent = '더 보기 (남은 ' + left + '행)';
  }

  function csvCell(s) {
    s = String(s);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function headerName(m) {
    return m.unit ? m.name + ' (' + m.unit + ')' : m.name;
  }
  function csvForRun(run) {
    const t = tableFor(state.cap, run);
    const lines = [[headerName(state.cap.time)].concat(t.cols.map(headerName)).map(csvCell).join(',')];
    for (const r of t.rows) lines.push([r.t].concat(r.vals.map((v) => (Number.isFinite(v) ? v : ''))).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  function csvForAll() {
    const cap = state.cap;
    const cols = cap.measurements;
    const lines = [['Run #', 'Run', headerName(cap.time)].concat(cols.map(headerName)).map(csvCell).join(',')];
    for (const run of cap.runs) {
      const t = tableFor(cap, run);
      const idx = cols.map((m) => t.cols.indexOf(m));
      for (const r of t.rows) {
        const vals = idx.map((i) => (i >= 0 && Number.isFinite(r.vals[i]) ? r.vals[i] : ''));
        lines.push([run.number < 100000 ? run.number : '', csvCell(run.name), r.t].concat(vals).join(','));
      }
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ---------- info ----------
  function renderInfo() {
    const cap = state.cap;
    let h = '<section class="info-section"><h3>파일</h3><dl>' +
      '<dt>이름</dt><dd>' + esc(cap.fileName || '-') + '</dd>' +
      '<dt>크기</dt><dd>' + fmtBytes(cap.fileSize || 0) + '</dd>' +
      (cap.version ? '<dt>Capstone 버전</dt><dd>' + esc(cap.version) + '</dd>' : '') +
      '<dt>런 수</dt><dd>' + cap.runs.length + '개</dd>' +
      '</dl></section>';

    if (cap.sensors.length) {
      h += '<section class="info-section"><h3>센서</h3><ul>' +
        cap.sensors.map((s) => {
          const hz = s.period > 0 ? ' · ' + fmt(1 / s.period, 3) + ' Hz (' + fmt(s.period, 3) + ' s 간격)' : '';
          return '<li><b>' + esc(s.name) + '</b>' + hz + (s.measurements.length ? '<br><span class="muted">' + esc(s.measurements.join(', ')) + '</span>' : '') + '</li>';
        }).join('') + '</ul></section>';
    }

    h += '<section class="info-section"><h3>측정값</h3><ul>' +
      cap.measurements.map((m) => '<li>' + esc(optionLabel(m)) + ' <span class="muted">· ' + m.runCount + '개 런</span></li>').join('') +
      '</ul></section>';

    h += '<section class="info-section"><h3>런 목록</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>이름</th><th>기록 시각</th><th>길이 (s)</th><th>점 개수</th></tr></thead><tbody>' +
      cap.runs.map((r) => '<tr><td>' + (r.number < 100000 ? r.number : '') + '</td><td>' + esc(r.name) + '</td><td>' + esc(fmtDate(r.start)) + '</td><td>' + r.duration.toFixed(2) + '</td><td>' + r.points + '</td></tr>').join('') +
      '</tbody></table></div></section>';

    if (cap.warnings.length) {
      h += '<section class="info-section"><h3>주의</h3><ul class="warn">' + cap.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></section>';
    }
    $('#info').innerHTML = h;
  }

  // ---------- tabs ----------
  function showTab(name) {
    for (const t of ['graph', 'table', 'info']) {
      const on = t === name;
      $('#tab-btn-' + t).setAttribute('aria-selected', String(on));
      $('#tab-btn-' + t).tabIndex = on ? 0 : -1;
      $('#tab-' + t).hidden = !on;
    }
    if (name === 'table') {
      renderTableRunSelect();
      if (!state.table || state.table.runId !== state.tableRunId) renderTable();
    }
  }

  // ---------- loading ----------
  function showView(which) {
    $('#welcome').hidden = which !== 'welcome';
    $('#loading').hidden = which !== 'loading';
    $('#viewer').hidden = which !== 'viewer';
  }

  function showError(msg) {
    const box = $('#error-box');
    box.textContent = msg;
    box.hidden = false;
    showView('welcome');
  }

  async function openFile(file) {
    if (!file) return;
    $('#error-box').hidden = true;
    showView('loading');
    $('#loading-text').textContent = '여는 중…';
    $('#progress-bar').style.width = '0%';
    try {
      const cap = await parseCap(file, (msg, p) => {
        $('#loading-text').textContent = msg;
        $('#progress-bar').style.width = Math.round(p * 100) + '%';
      });
      if (!cap.runs.length || !cap.measurements.length) {
        throw new Error('이 파일에는 측정 데이터가 없습니다. (런을 기록한 뒤 저장한 파일인지 확인하세요)');
      }
      loadCap(cap);
    } catch (err) {
      console.error(err);
      showError('파일을 열지 못했습니다: ' + (err && err.message ? err.message : err));
    }
  }

  function loadCap(cap) {
    state.cap = cap;
    state.range = null;
    state.table = null;
    state.tableRunId = null;
    state.colorSlot = new Map();
    chart.selection = null;
    chart.rangeMode = false;
    $('#range-btn').setAttribute('aria-pressed', 'false');

    $('#file-name').textContent = cap.fileName || 'Capstone 파일';
    document.title = (cap.fileName ? cap.fileName + ' · ' : '') + 'CAP 뷰어';

    const ySel = $('#y-select');
    ySel.innerHTML = cap.measurements.map((m) => '<option value="' + esc(m.id) + '">' + esc(optionLabel(m)) + '</option>').join('');
    const xSel = $('#x-select');
    xSel.innerHTML = '<option value="' + esc(cap.time.id) + '">' + esc(optionLabel(cap.time)) + '</option>' +
      cap.measurements.map((m) => '<option value="' + esc(m.id) + '">' + esc(optionLabel(m)) + '</option>').join('');

    const d = cap.defaults || {};
    state.yId = cap.measurements.some((m) => m.id === d.yMeasId) ? d.yMeasId : cap.measurements[0].id;
    state.xId = cap.time.id;
    ySel.value = state.yId;
    xSel.value = state.xId;

    const def = (d.runIds || []).filter((id) => cap.runs.some((r) => r.id === id));
    setSelected(def.length ? def : [cap.runs[cap.runs.length - 1].id]);

    showView('viewer');
    showTab('graph');
    renderInfo();
    // wait one frame so the canvas has its size
    requestAnimationFrame(() => renderGraph(false));

    if (cap.warnings.length) toast('일부 데이터에 문제가 있습니다. 정보 탭을 확인하세요.');
  }

  async function loadDemo() {
    try {
      showView('loading');
      $('#loading-text').textContent = '예제 파일 받는 중…';
      const res = await fetch('examples/demo.cap');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      await openFile(new File([blob], '예제-경사면 수레.cap'));
    } catch (e) {
      showError('예제 파일을 불러오지 못했습니다: ' + e.message);
    }
  }

  // ---------- events ----------
  $('#file-input').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    openFile(f);
  });
  $('#demo-btn').addEventListener('click', loadDemo);

  for (const t of ['graph', 'table', 'info']) {
    $('#tab-btn-' + t).addEventListener('click', () => showTab(t));
  }
  $('.tabs').addEventListener('keydown', (e) => {
    const order = ['graph', 'table', 'info'];
    const cur = order.findIndex((t) => $('#tab-btn-' + t).getAttribute('aria-selected') === 'true');
    let next = -1;
    if (e.key === 'ArrowRight') next = (cur + 1) % 3;
    else if (e.key === 'ArrowLeft') next = (cur + 2) % 3;
    if (next >= 0) {
      e.preventDefault();
      showTab(order[next]);
      $('#tab-btn-' + order[next]).focus();
    }
  });

  $('#y-select').addEventListener('change', (e) => {
    state.yId = e.target.value;
    renderGraph(false);
  });
  $('#x-select').addEventListener('change', (e) => {
    state.xId = e.target.value;
    state.range = null;
    chart.selection = null;
    renderGraph(false);
  });

  $('#runs-btn').addEventListener('click', openRunsSheet);
  $('#runs-done').addEventListener('click', closeRunsSheet);
  $('#runs-sheet').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeRunsSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#runs-sheet').hidden) closeRunsSheet();
  });
  $('#runs-search').addEventListener('input', renderRunList);
  $('#run-list').addEventListener('change', (e) => {
    const id = e.target.getAttribute('data-run');
    if (!id) return;
    toggleRun(id, e.target.checked);
    renderRunList();
    renderGraph(true);
  });
  $('#runs-all').addEventListener('click', () => {
    for (const cb of document.querySelectorAll('#run-list input[data-run]')) toggleRun(cb.getAttribute('data-run'), true);
    renderRunList();
    renderGraph(false);
  });
  $('#runs-none').addEventListener('click', () => {
    setSelected([]);
    renderRunList();
    renderGraph(false);
  });
  $('#legend').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-remove]');
    if (!b) return;
    toggleRun(b.getAttribute('data-remove'), false);
    renderGraph(true);
  });

  $('#fit-all-btn').addEventListener('click', () => chart.fitAll());
  $('#range-btn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    chart.rangeMode = on;
    $('#gesture-hint').textContent = on
      ? '구간 선택 모드: 그래프를 좌우로 끌어서 통계·맞춤에 쓸 구간을 고르세요 · 두 손가락: 확대/축소'
      : '한 손가락: 이동 · 두 손가락: 확대/축소 · 탭: 값 읽기 · 두 번 탭: 전체 보기';
    if (on) toast('그래프를 좌우로 끌어서 구간을 선택하세요');
  });
  $('#clear-range-btn').addEventListener('click', () => chart.clearSelection());
  $('#points-btn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    chart.showPoints = on;
    chart.draw();
  });
  $('#fit-select').addEventListener('change', (e) => {
    state.fit = e.target.value;
    renderStats();
  });
  $('#png-btn').addEventListener('click', () => {
    chart.exportPNG(lastSeries.map((s) => ({ label: s.label, color: s.color }))).then((blob) => {
      if (blob) saveBlob(blob, safeFile(baseName() + '_' + shortName(measById(state.yId))) + '.png');
    });
  });

  $('#table-run').addEventListener('change', (e) => {
    state.tableRunId = e.target.value;
    renderTable();
  });
  $('#more-rows-btn').addEventListener('click', appendRows);
  $('#csv-run-btn').addEventListener('click', () => {
    const run = runById(state.tableRunId);
    if (!run) return;
    saveBlob(new Blob([csvForRun(run)], { type: 'text/csv;charset=utf-8' }), safeFile(baseName() + '_' + run.name) + '.csv');
  });
  $('#csv-all-btn').addEventListener('click', () => {
    saveBlob(new Blob([csvForAll()], { type: 'text/csv;charset=utf-8' }), safeFile(baseName() + '_전체') + '.csv');
  });
  if (navigator.canShare) {
    try {
      if (navigator.canShare({ files: [new File(['a'], 'a.csv', { type: 'text/csv' })] })) $('#share-btn').hidden = false;
    } catch (e) { /* not supported */ }
  }
  $('#share-btn').addEventListener('click', async () => {
    const run = runById(state.tableRunId);
    if (!run) return;
    const file = new File([csvForRun(run)], safeFile(baseName() + '_' + run.name) + '.csv', { type: 'text/csv' });
    try {
      await navigator.share({ files: [file], title: run.name });
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('공유하지 못했습니다');
    }
  });

  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', () => { if (state.cap) renderGraph(true); });

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

  checkSharedFile();

  // for tests / debugging
  window.CapViewerApp = { state, openFile, computeStats, chart };
})();
