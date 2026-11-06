(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  /** Significant-figure formatting with ×10ⁿ for very large/small numbers. */
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

  /** Fixed decimals (for tables / digits); "-0.000" becomes "0.000". */
  function fmtFixed(v, d) {
    if (!Number.isFinite(v)) return '';
    if (Math.abs(v) >= 1e9) return fmt(v, 6);
    const s = v.toFixed(Math.max(0, Math.min(10, d)));
    return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
  }

  /** Decimals for a column: the configured ones, more if values would show as zeros. */
  function columnDecimals(values, base) {
    let maxAbs = 0;
    for (const v of values) if (Number.isFinite(v) && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    let d = base == null ? 3 : base;
    // keep about three significant digits for columns of small numbers
    if (maxAbs > 0 && maxAbs < 1) d = Math.max(d, Math.ceil(-Math.log10(maxAbs) - 1e-9) + 2);
    return Math.min(d, 10);
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

  /** Mean/min/max/std plus linear and quadratic least-squares fits of y(x). */
  function computeStats(x, y, range) {
    const xs = [], ys = [];
    for (let i = 0; i < y.length; i++) {
      const xv = x[i], yv = y[i];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      if (range && (xv < range[0] || xv > range[1])) continue;
      xs.push(xv);
      ys.push(yv);
    }
    const n = ys.length;
    if (!n) return { n: 0 };
    let sum = 0, min = Infinity, max = -Infinity, sx = 0, xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < n; i++) {
      sum += ys[i];
      sx += xs[i];
      if (ys[i] < min) min = ys[i];
      if (ys[i] > max) max = ys[i];
      if (xs[i] < xmin) xmin = xs[i];
      if (xs[i] > xmax) xmax = xs[i];
    }
    const mean = sum / n, xm = sx / n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (ys[i] - mean) * (ys[i] - mean);
    const res = { n, mean, min, max, std: n > 1 ? Math.sqrt(ss / (n - 1)) : 0, xmin, xmax, linear: null, quad: null };

    if (n >= 2) {
      let sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) { const u = xs[i] - xm; sxx += u * u; sxy += u * (ys[i] - mean); }
      if (sxx > 0) {
        const m = sxy / sxx, b = mean - m * xm;
        let sr = 0;
        for (let i = 0; i < n; i++) { const e = ys[i] - (m * xs[i] + b); sr += e * e; }
        res.linear = { m, b, r2: ss > 0 ? 1 - sr / ss : 1 };
      }
    }
    if (n >= 3) {
      let s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
      for (let i = 0; i < n; i++) {
        const u = xs[i] - xm, u2 = u * u;
        s2 += u2; s3 += u2 * u; s4 += u2 * u2;
        t0 += ys[i]; t1 += u * ys[i]; t2 += u2 * ys[i];
      }
      const sol = solve3([[s4, s3, s2], [s3, s2, 0], [s2, 0, n]], [t2, t1, t0]);
      if (sol) {
        const [a, b, c] = sol;
        const A = a, B = b - 2 * a * xm, C = a * xm * xm - b * xm + c;
        let sr = 0;
        for (let i = 0; i < n; i++) { const e = ys[i] - (A * xs[i] * xs[i] + B * xs[i] + C); sr += e * e; }
        res.quad = { A, B, C, r2: ss > 0 ? 1 - sr / ss : 1 };
      }
    }
    return res;
  }

  function slopeUnit(yu, xu) {
    if (!yu && !xu) return '';
    if (!xu) return yu;
    if (yu === 'm' && xu === 's') return 'm/s';
    if (yu === 'm/s' && xu === 's') return 'm/s²';
    return (yu || '1') + '/' + xu;
  }

  function measLabel(m, unit) {
    if (!m) return '';
    return unit ? m.name + ' (' + unit + ')' : m.name;
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

  function csvCell(s) {
    s = String(s);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Line icons drawn after Lucide (lucide.dev, ISC license): one set, 18px, 1.5 stroke, text colour.
  const ICONS = {
    fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    runs: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    range: '<path d="M4 5v14"/><path d="M20 5v14"/><path d="M8 12h8"/><path d="m10 9-3 3 3 3"/><path d="m14 9 3 3-3 3"/>',
    sigma: '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>',
    fx: '<circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/>',
    points: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="16" cy="13" r="1"/><circle cx="19" cy="7" r="1"/>',
    image: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    collapse: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
    csv: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
    summary: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    table: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>',
    prev: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    layout: '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/>',
    reflow: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
    open: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6"/><path d="M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/>',
    pdf: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  };
  /** One icon set at one size (18px, stroke 1.5). The size argument is kept for old callers but ignored. */
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  global.CapUtil = { esc, el, fmt, fmtFixed, columnDecimals, computeStats, slopeUnit, measLabel, fmtDate, fmtBytes, safeFile, saveBlob, csvCell, icon };
})(typeof window !== 'undefined' ? window : globalThis);
