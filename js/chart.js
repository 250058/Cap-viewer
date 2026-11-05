/*
 * Small canvas line chart made for phones:
 *  - one finger drag: pan          - two finger pinch: zoom (per axis)
 *  - tap: read nearest point       - double tap: fit all data
 *  - range mode: drag to select an x-range (for statistics / curve fit)
 *  - mouse wheel zoom on desktop
 */
(function (global) {
  'use strict';

  function niceStep(range, target) {
    if (!(range > 0) || !Number.isFinite(range)) return 1;
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
    return s * mag;
  }

  function stepDecimals(step) {
    if (!(step > 0)) return 0;
    return Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
  }

  function fmtTick(v, dec) {
    if (Math.abs(v) < 1e-12) v = 0;
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(1);
    return v.toFixed(dec);
  }

  class Chart {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.series = [];
      this.fits = [];
      this.xLabel = '';
      this.yLabel = '';
      this.view = null;
      this.showPoints = false;
      this.showLines = true;
      this.showLegend = true;
      this.emptyText = '';
      this.rangeMode = false;
      this.selection = null; // [x0, x1]
      this.picked = null; // {si, i}
      this.pointers = new Map();
      this.gesture = null;
      this.lastTap = null;
      this.pad = { l: 50, r: 12, t: 12, b: 38 };
      this.dpr = 1;
      this.w = 0;
      this.h = 0;
      this._raf = 0;

      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
      canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      const mq = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)');
      this._onScheme = () => this.draw();
      this._mq = mq;
      if (mq && mq.addEventListener) mq.addEventListener('change', this._onScheme);
      this.resize();
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.max(this.opts.minDpr || 1, Math.min(global.devicePixelRatio || 1, 3));
      this.w = Math.max(10, r.width);
      this.h = Math.max(10, r.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.draw();
    }

    setData(series, opts) {
      const keepView = opts && opts.keepView;
      this.series = series || [];
      this.xLabel = (opts && opts.xLabel) || '';
      this.yLabel = (opts && opts.yLabel) || '';
      this.picked = null;
      if (!keepView || !this.view) this.fitAll();
      else this.draw();
      this.emitPick();
    }

    setFits(fits) {
      this.fits = fits || [];
      this.draw();
    }

    dataBounds() {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of this.series) {
        const xs = s.x, ys = s.y;
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i], y = ys[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (!Number.isFinite(x0)) return { x0: 0, x1: 1, y0: 0, y1: 1 };
      return { x0, x1, y0, y1 };
    }

    fitAll() {
      const b = this.dataBounds();
      let { x0, x1, y0, y1 } = b;
      if (x1 - x0 < 1e-12) { x0 -= 0.5; x1 += 0.5; }
      if (y1 - y0 < 1e-12) { const d = Math.abs(y0) * 0.1 || 0.5; y0 -= d; y1 += d; }
      const py = (y1 - y0) * 0.06;
      const px = (x1 - x0) * 0.02;
      this.view = { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py };
      this.draw();
    }

    clearSelection() {
      this.selection = null;
      this.draw();
      if (this.opts.onSelect) this.opts.onSelect(null);
    }

    // ---- coordinate helpers ----
    plotRect() {
      const p = this.pad;
      return { x: p.l, y: p.t, w: Math.max(10, this.w - p.l - p.r), h: Math.max(10, this.h - p.t - p.b) };
    }
    sx(x) { const r = this.plotRect(), v = this.view; return r.x + ((x - v.x0) / (v.x1 - v.x0)) * r.w; }
    sy(y) { const r = this.plotRect(), v = this.view; return r.y + r.h - ((y - v.y0) / (v.y1 - v.y0)) * r.h; }
    dx(px) { const r = this.plotRect(), v = this.view; return v.x0 + ((px - r.x) / r.w) * (v.x1 - v.x0); }
    dy(py) { const r = this.plotRect(), v = this.view; return v.y0 + ((r.y + r.h - py) / r.h) * (v.y1 - v.y0); }

    colors() {
      const cs = getComputedStyle(this.canvas);
      const g = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
      return {
        bg: g('--chart-bg', '#fff'),
        grid: g('--chart-grid', '#e5e7eb'),
        axis: g('--chart-axis', '#9ca3af'),
        text: g('--chart-text', '#374151'),
        sel: g('--chart-sel', 'rgba(37,99,235,.12)'),
        selEdge: g('--chart-sel-edge', 'rgba(37,99,235,.6)'),
      };
    }

    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._draw();
      });
    }

    _draw() {
      const ctx = this.ctx;
      const c = this.colors();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, this.w, this.h);
      if (!this.view) return;
      const v = this.view;
      ctx.font = '11px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

      // y ticks first to size the left margin
      let r = this.plotRect();
      const yStep = niceStep(v.y1 - v.y0, Math.max(3, Math.floor(r.h / 48)));
      const yDec = stepDecimals(yStep);
      const yTicks = [];
      for (let t = Math.ceil(v.y0 / yStep) * yStep; t <= v.y1 + yStep * 1e-9; t += yStep) yTicks.push(t);
      let maxW = 0;
      for (const t of yTicks) maxW = Math.max(maxW, ctx.measureText(fmtTick(t, yDec)).width);
      const newL = Math.ceil(Math.max(34, maxW + 22));
      if (newL !== this.pad.l) { this.pad.l = newL; r = this.plotRect(); }

      const xStep = niceStep(v.x1 - v.x0, Math.max(2, Math.floor(r.w / 70)));
      const xDec = stepDecimals(xStep);

      // grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.grid;
      ctx.beginPath();
      for (let t = Math.ceil(v.x0 / xStep) * xStep; t <= v.x1 + xStep * 1e-9; t += xStep) {
        const X = Math.round(this.sx(t)) + 0.5;
        ctx.moveTo(X, r.y);
        ctx.lineTo(X, r.y + r.h);
      }
      for (const t of yTicks) {
        const Y = Math.round(this.sy(t)) + 0.5;
        ctx.moveTo(r.x, Y);
        ctx.lineTo(r.x + r.w, Y);
      }
      ctx.stroke();

      // zero line
      if (v.y0 < 0 && v.y1 > 0) {
        ctx.strokeStyle = c.axis;
        ctx.beginPath();
        const Y = Math.round(this.sy(0)) + 0.5;
        ctx.moveTo(r.x, Y);
        ctx.lineTo(r.x + r.w, Y);
        ctx.stroke();
      }

      // selection band
      if (this.selection) {
        const a = Math.max(r.x, Math.min(r.x + r.w, this.sx(Math.min(this.selection[0], this.selection[1]))));
        const b = Math.max(r.x, Math.min(r.x + r.w, this.sx(Math.max(this.selection[0], this.selection[1]))));
        ctx.fillStyle = c.sel;
        ctx.fillRect(a, r.y, b - a, r.h);
        ctx.strokeStyle = c.selEdge;
        ctx.beginPath();
        ctx.moveTo(a + 0.5, r.y); ctx.lineTo(a + 0.5, r.y + r.h);
        ctx.moveTo(b - 0.5, r.y); ctx.lineTo(b - 0.5, r.y + r.h);
        ctx.stroke();
      }

      // data
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      for (const s of this.series) this.drawSeries(s, r);
      for (const f of this.fits) this.drawFit(f, r);
      if (this.picked) {
        const s = this.series[this.picked.si];
        if (s) {
          const X = this.sx(s.x[this.picked.i]);
          const Y = this.sy(s.y[this.picked.i]);
          ctx.strokeStyle = c.axis;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(X, r.y); ctx.lineTo(X, r.y + r.h);
          ctx.moveTo(r.x, Y); ctx.lineTo(r.x + r.w, Y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = c.bg;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(X, Y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();

      // axes frame
      ctx.strokeStyle = c.axis;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

      // tick labels
      ctx.fillStyle = c.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let lastRight = -Infinity;
      for (let t = Math.ceil(v.x0 / xStep) * xStep; t <= v.x1 + xStep * 1e-9; t += xStep) {
        const X = this.sx(t);
        const s = fmtTick(t, xDec);
        const w = ctx.measureText(s).width;
        if (X - w / 2 < lastRight + 6) continue;
        ctx.fillText(s, X, r.y + r.h + 4);
        lastRight = X + w / 2;
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const t of yTicks) ctx.fillText(fmtTick(t, yDec), r.x - 5, this.sy(t));

      // axis titles
      ctx.font = '600 12px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.xLabel, r.x + r.w / 2, this.h - 2);
      ctx.save();
      ctx.translate(11, r.y + r.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText(this.yLabel, 0, 0);
      ctx.restore();

      const hasData = this.series.some((s) => s.x.length);
      if (!hasData && this.emptyText) {
        ctx.font = '13px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
        ctx.fillStyle = c.axis;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.emptyText, r.x + r.w / 2, r.y + r.h / 2);
      }
      const legend = this.exportLegend || (this.showLegend ? this.series.filter((s) => s.x.length).map((s) => ({ label: s.label, color: s.color })) : null);
      if (legend && legend.length) this.drawLegend(legend, r, c);
    }

    drawLegend(items, r, c) {
      const ctx = this.ctx;
      const MAX = Math.max(1, Math.min(10, Math.floor((r.h * 0.6) / 17) - 1));
      const shown = items.length > MAX + 1 ? items.slice(0, MAX) : items;
      const rows = shown.map((it) => it.label);
      if (items.length > shown.length) rows.push('외 ' + (items.length - shown.length) + '개');
      ctx.font = '12px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
      let w = 0;
      for (const t of rows) w = Math.max(w, ctx.measureText(t).width);
      w = Math.min(w, r.w * 0.5);
      const lh = 17;
      const bw = w + 34;
      const bh = rows.length * lh + 10;
      const x = r.x + r.w - bw - 8;
      const y = r.y + 8;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = c.bg;
      ctx.fillRect(x, y, bw, bh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.grid;
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      rows.forEach((t, i) => {
        const cy = y + 5 + lh * i + lh / 2;
        if (shown[i] && this.showLines) {
          ctx.strokeStyle = shown[i].color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(x + 8, cy);
          ctx.lineTo(x + 22, cy);
          ctx.stroke();
        } else if (shown[i]) {
          ctx.fillStyle = shown[i].color;
          ctx.beginPath();
          ctx.arc(x + 15, cy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = c.text;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 26, cy - lh / 2, w + 2, lh);
        ctx.clip();
        ctx.fillText(t, x + 26, cy);
        ctx.restore();
      });
      ctx.restore();
    }

    /** Draw immediately (used before capturing the page as an image). */
    renderNow() {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
      this._draw();
    }

    destroy() {
      if (this._ro) this._ro.disconnect();
      if (this._mq && this._mq.removeEventListener) this._mq.removeEventListener('change', this._onScheme);
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      this.series = [];
    }

    /** Render once with an in-canvas legend and return a PNG blob. */
    exportPNG(legend) {
      return new Promise((resolve) => {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        this.exportLegend = legend || [];
        this._draw();
        this.exportLegend = null;
        this.canvas.toBlob((b) => resolve(b), 'image/png');
        this.draw();
      });
    }

    drawSeries(s, r) {
      const ctx = this.ctx;
      const xs = s.x, ys = s.y, n = xs.length;
      const v = this.view;
      const kx = r.w / (v.x1 - v.x0);
      const ky = r.h / (v.y1 - v.y0);
      const ox = r.x - v.x0 * kx;
      const oy = r.y + r.h + v.y0 * ky;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      // Simple per-pixel min/max decimation for very dense, x-sorted data.
      const dense = n > r.w * 6 && s.sorted;
      if (dense) {
        let col = null, minY = 0, maxY = 0, firstY = 0, lastY = 0;
        const flush = () => {
          if (col === null) return;
          if (!pen) { ctx.moveTo(col, firstY); pen = true; } else ctx.lineTo(col, firstY);
          ctx.lineTo(col, minY);
          ctx.lineTo(col, maxY);
          ctx.lineTo(col, lastY);
        };
        for (let i = 0; i < n; i++) {
          const x = xs[i], y = ys[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) { flush(); col = null; pen = false; continue; }
          const X = Math.round(ox + x * kx);
          const Y = oy - y * ky;
          if (X !== col) {
            flush();
            col = X; minY = maxY = firstY = lastY = Y;
          } else {
            if (Y < minY) minY = Y;
            if (Y > maxY) maxY = Y;
            lastY = Y;
          }
        }
        flush();
      } else {
        for (let i = 0; i < n; i++) {
          const x = xs[i], y = ys[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
          const X = ox + x * kx;
          const Y = oy - y * ky;
          if (pen) ctx.lineTo(X, Y);
          else { ctx.moveTo(X, Y); pen = true; }
        }
      }
      if (this.showLines || dense) ctx.stroke();

      if ((this.showPoints || !this.showLines) && !dense) {
        ctx.fillStyle = s.color;
        const perPx = n / Math.max(1, r.w);
        const rad = perPx > 1 ? 1.4 : this.showLines ? (perPx > 0.25 ? 1.8 : 2.6) : perPx > 0.25 ? 2.4 : 3.4;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = xs[i], y = ys[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const X = ox + x * kx;
          const Y = oy - y * ky;
          if (X < r.x - 4 || X > r.x + r.w + 4) continue;
          ctx.moveTo(X + rad, Y);
          ctx.arc(X, Y, rad, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }

    drawFit(f, r) {
      const ctx = this.ctx;
      const a = Math.max(f.x0, this.view.x0);
      const b = Math.min(f.x1, this.view.x1);
      if (!(b > a)) return;
      ctx.save();
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      const steps = 120;
      for (let k = 0; k <= steps; k++) {
        const x = a + ((b - a) * k) / steps;
        const X = this.sx(x);
        const Y = this.sy(f.fn(x));
        if (k === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- interaction ----
    localPoint(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    onDown(e) {
      if (!this.view) return;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
      const p = this.localPoint(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 1) {
        this.gesture = { type: 'pending', start: p, time: performance.now(), view: { ...this.view }, mouse: e.pointerType === 'mouse', button: e.button };
      } else if (this.pointers.size === 2) {
        this.startPinch();
      }
    }

    startPinch() {
      const [a, b] = Array.from(this.pointers.values());
      this.gesture = {
        type: 'pinch',
        view: { ...this.view },
        c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        sx: Math.abs(a.x - b.x),
        sy: Math.abs(a.y - b.y),
        d: Math.hypot(a.x - b.x, a.y - b.y),
      };
    }

    onMove(e) {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this.localPoint(e);
      this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      if (!g) return;
      const r = this.plotRect();
      if (g.type === 'pending') {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 7) return;
        g.type = this.rangeMode ? 'select' : 'pan';
        if (g.type === 'select') this.selection = [this.dx(g.start.x), this.dx(g.start.x)];
      }
      if (g.type === 'pan') {
        const v0 = g.view;
        const ddx = ((p.x - g.start.x) / r.w) * (v0.x1 - v0.x0);
        const ddy = ((p.y - g.start.y) / r.h) * (v0.y1 - v0.y0);
        this.view = { x0: v0.x0 - ddx, x1: v0.x1 - ddx, y0: v0.y0 + ddy, y1: v0.y1 + ddy };
        this.draw();
      } else if (g.type === 'select') {
        this.selection[1] = this.dx(p.x);
        this.draw();
      } else if (g.type === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = Array.from(this.pointers.values());
        const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const sx = Math.abs(a.x - b.x);
        const sy = Math.abs(a.y - b.y);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        let fx = 1, fy = 1;
        const MIN = 45;
        if (g.sx < MIN && g.sy < MIN) {
          fx = fy = g.d / Math.max(d, 1);
        } else {
          if (g.sx >= MIN) fx = g.sx / Math.max(sx, 10);
          if (g.sy >= MIN) fy = g.sy / Math.max(sy, 10);
        }
        const v0 = g.view;
        const w0 = v0.x1 - v0.x0;
        const h0 = v0.y1 - v0.y0;
        const ax = v0.x0 + ((g.c.x - r.x) / r.w) * w0;
        const ay = v0.y0 + ((r.y + r.h - g.c.y) / r.h) * h0;
        const w = w0 * fx;
        const h = h0 * fy;
        const x0 = ax - ((c.x - r.x) / r.w) * w;
        const y0 = ay - ((r.y + r.h - c.y) / r.h) * h;
        this.view = { x0, x1: x0 + w, y0, y1: y0 + h };
        this.draw();
      }
    }

    onUp(e, cancelled) {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this.localPoint(e);
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (g && g.type === 'pinch') {
        if (this.pointers.size === 1) {
          const rest = Array.from(this.pointers.values())[0];
          this.gesture = { type: 'pan', start: rest, view: { ...this.view } };
        } else if (this.pointers.size === 0) this.gesture = null;
        return;
      }
      if (this.pointers.size > 0) return;
      this.gesture = null;
      if (!g || cancelled) return;
      if (g.type === 'pending') {
        const now = performance.now();
        if (this.lastTap && now - this.lastTap.time < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30) {
          this.lastTap = null;
          this.fitAll();
          return;
        }
        this.lastTap = { time: now, x: p.x, y: p.y };
        this.pick(p);
      } else if (g.type === 'select') {
        const s = this.selection;
        if (Math.abs(this.sx(s[1]) - this.sx(s[0])) < 4) this.selection = null;
        else this.selection = [Math.min(s[0], s[1]), Math.max(s[0], s[1])];
        this.draw();
        if (this.opts.onSelect) this.opts.onSelect(this.selection);
      }
    }

    onWheel(e) {
      if (!this.view) return;
      e.preventDefault();
      const p = this.localPoint(e);
      const f = Math.pow(1.0015, e.deltaY);
      const ax = this.dx(p.x);
      const ay = this.dy(p.y);
      const v = this.view;
      const zx = !e.altKey;
      const zy = !e.shiftKey;
      this.view = {
        x0: zx ? ax - (ax - v.x0) * f : v.x0,
        x1: zx ? ax + (v.x1 - ax) * f : v.x1,
        y0: zy ? ay - (ay - v.y0) * f : v.y0,
        y1: zy ? ay + (v.y1 - ay) * f : v.y1,
      };
      this.draw();
    }

    pick(p) {
      let best = null;
      let bestD = 36 * 36;
      this.series.forEach((s, si) => {
        for (let i = 0; i < s.x.length; i++) {
          const x = s.x[i], y = s.y[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const ddx = this.sx(x) - p.x;
          const ddy = this.sy(y) - p.y;
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) { bestD = d; best = { si, i }; }
        }
      });
      this.picked = best;
      this.draw();
      this.emitPick();
    }

    emitPick() {
      if (!this.opts.onPick) return;
      if (!this.picked) { this.opts.onPick(null); return; }
      const s = this.series[this.picked.si];
      this.opts.onPick({ series: s, index: this.picked.i, x: s.x[this.picked.i], y: s.y[this.picked.i] });
    }

  }

  global.CapChart = Chart;
})(typeof window !== 'undefined' ? window : globalThis);
