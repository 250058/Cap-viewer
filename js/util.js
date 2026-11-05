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

  const ICONS = {
    fit: '<path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"/>',
    runs: '<path d="M3 6h12v2H3V6zm0 5h18v2H3v-2zm0 5h9v2H3v-2z"/><circle cx="19" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
    range: '<path d="M3 5h2v14H3V5zm16 0h2v14h-2V5zM7 9h10v6H7V9z" opacity=".9"/>',
    sigma: '<path d="M6 4h12v3h-2V6H9.4l5 6-5 6H16v-1h2v3H6v-1.6L11.8 12 6 5.6V4z"/>',
    fx: '<path d="M10.5 4c-1.9 0-2.9 1.2-3.2 3l-.3 2H5v2h1.7l-1 5.5c-.2 1-.6 1.5-1.4 1.5H4v2h.5c1.9 0 2.9-1.2 3.2-3l1-6H11V9H9l.3-1.6c.2-1 .6-1.4 1.3-1.4h.6V4h-.7zM13 9l2.2 3.5L13 16h2.2l1.2-2.1 1.2 2.1H20l-2.2-3.5L20 9h-2.2l-1.2 2-1.2-2H13z"/>',
    points: '<circle cx="6" cy="16" r="2.4"/><circle cx="12" cy="9" r="2.4"/><circle cx="18" cy="13" r="2.4"/>',
    image: '<path d="M12 3v10.6l3.3-3.3 1.4 1.4L11 17.4l-5.7-5.7 1.4-1.4 3.3 3.3V3h2zM4 19h14v2H4v-2z"/>',
    expand: '<path d="M4 4h7v2H7.4l4.3 4.3-1.4 1.4L6 7.4V11H4V4zm16 16h-7v-2h3.6l-4.3-4.3 1.4-1.4 4.3 4.3V13h2v7z"/>',
    collapse: '<path d="M11 13v7H9v-3.6l-4.3 4.3-1.4-1.4L7.6 15H4v-2h7zm2-2V4h2v3.6l4.3-4.3 1.4 1.4L16.4 9H20v2h-7z"/>',
    csv: '<path d="M6 2h9l5 5v15H6V2zm8 1.5V8h4.5L14 3.5zM8 12v2h8v-2H8zm0 4v2h8v-2H8z"/>',
    summary: '<path d="M4 4h16v4H4V4zm0 6h16v4H4v-4zm0 6h16v4H4v-4z"/>',
    table: '<path d="M3 4h18v16H3V4zm2 2v3h4V6H5zm6 0v3h8V6h-8zM5 11v3h4v-3H5zm6 0v3h8v-3h-8zm-6 5v2h4v-2H5zm6 0v2h8v-2h-8z"/>',
    prev: '<path d="M15.4 6.4 14 5l-7 7 7 7 1.4-1.4L9.8 12z"/>',
    next: '<path d="M8.6 6.4 10 5l7 7-7 7-1.4-1.4 5.6-5.6z"/>',
    layout: '<path d="M3 4h18v16H3V4zm2 2v12h6V6H5zm8 0v5h6V6h-6zm0 7v5h6v-5h-6z"/>',
    reflow: '<path d="M5 3h14v4H5V3zm0 6h14v4H5V9zm0 6h14v6H5v-6z"/>',
    open: '<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/>',
    close: '<path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/>',
    zoomIn: '<path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-1 2h2v2h2v2h-2v2H9v-2H7V9h2V7z"/>',
    zoomOut: '<path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM7 9h6v2H7V9z"/>',
    pdf: '<path d="M6 2h9l5 5v15H6V2zm8 1.5V8h4.5L14 3.5zM8.5 13v5H10v-1.6h.8a1.7 1.7 0 0 0 0-3.4H8.5zm1.5 1.2h.7a.5.5 0 0 1 0 1H10v-1zm3-1.2v5h1.6a2.5 2.5 0 0 0 0-5H13zm1.5 1.2h.1a1.3 1.3 0 0 1 0 2.6h-.1v-2.6zM17.5 13v5H19v-2h1.4v-1.2H19v-.6h1.6V13h-3.1z"/>',
    info: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7h-2zm0-3v2h2V7h-2z"/>',
  };
  function icon(name, size) {
    const s = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true" fill="currentColor">' + (ICONS[name] || '') + '</svg>';
  }

  global.CapUtil = { esc, el, fmt, fmtFixed, columnDecimals, computeStats, slopeUnit, measLabel, fmtDate, fmtBytes, safeFile, saveBlob, csvCell, icon };
})(typeof window !== 'undefined' ? window : globalThis);
