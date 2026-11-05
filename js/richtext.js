/*
 * Renders the Qt rich-text HTML that Capstone stores for text boxes, text
 * entry boxes and display titles.
 *
 * The HTML comes from an untrusted file, so it is rebuilt from a whitelist:
 * only known tags, attributes and style properties survive; no scripts,
 * event handlers, external resources or unsafe URLs.
 *
 * mode 'layout' keeps the original pixel sizes (the page is scaled as a whole);
 * mode 'reflow' adapts font sizes and widths for a narrow phone column.
 */
(function (global) {
  'use strict';

  const TAGS = new Set(['P', 'SPAN', 'BR', 'B', 'I', 'U', 'S', 'STRONG', 'EM', 'SUB', 'SUP', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
    'UL', 'OL', 'LI', 'A', 'IMG', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FONT', 'HR', 'PRE', 'CODE', 'BLOCKQUOTE', 'SMALL', 'BIG',
    'CENTER', 'CAPTION', 'DL', 'DT', 'DD', 'TT', 'STRIKE', 'DEL', 'INS']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON',
    'SELECT', 'TEXTAREA', 'LINK', 'META', 'TITLE', 'HEAD', 'AUDIO', 'VIDEO', 'CANVAS', 'FRAME', 'FRAMESET', 'BASE']);
  const STYLE = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'vertical-align',
    'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent', 'line-height', 'padding-left', 'padding-right', 'padding-top',
    'padding-bottom', 'font-family', 'border-width', 'border-style', 'border-color', 'width', 'height']);
  const REFLOW_BASE = 15; // px, phone body text

  function parseStyle(s) {
    const out = [];
    String(s || '').split(';').forEach((decl) => {
      const i = decl.indexOf(':');
      if (i < 0) return;
      const k = decl.slice(0, i).trim().toLowerCase();
      const v = decl.slice(i + 1).trim();
      if (k && v) out.push([k, v]);
    });
    return out;
  }

  function toPx(v) {
    const m = /^(-?[\d.]+)\s*(px|pt)?$/i.exec(String(v).trim());
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    return m[2] && m[2].toLowerCase() === 'pt' ? (n * 96) / 72 : n;
  }

  function safeValue(v) {
    return !/url\s*\(|expression\s*\(|javascript:|@import|[<>]/i.test(v);
  }

  function fontFamily(v) {
    if (/courier|mono|consol/i.test(v)) return 'ui-monospace, Menlo, Consolas, monospace';
    if (/symbol/i.test(v)) return 'Symbol, serif';
    if (/times|serif/i.test(v) && !/sans/i.test(v)) return 'Georgia, "Times New Roman", serif';
    return null; // use the app font
  }

  /**
   * @param {string} html Qt rich text
   * @param {{mode?: 'layout'|'reflow', loadImage?: (path: string) => Promise<string|null>}} opts
   * @returns {HTMLDivElement}
   */
  function render(html, opts) {
    const mode = (opts && opts.mode) || 'layout';
    const loadImage = opts && opts.loadImage;
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const root = document.createElement('div');
    root.className = 'rt';

    // base font from <body style="font-size: 14px">
    let base = 14;
    const bs = doc.body ? doc.body.getAttribute('style') : '';
    for (const [k, v] of parseStyle(bs)) {
      if (k === 'font-size' && toPx(v) > 0) base = toPx(v);
      if (k === 'font-weight' && /^(bold|[6-9]00)$/.test(v)) root.style.fontWeight = 'bold';
    }
    const sizePx = (px) => {
      if (mode === 'layout') return px;
      const r = px / base;
      return Math.max(11, Math.round((r > 1 ? REFLOW_BASE * Math.pow(r, 0.6) : REFLOW_BASE * r) * 10) / 10);
    };
    root.style.fontSize = sizePx(base) + 'px';

    function cleanStyle(el, src, tag) {
      const parts = [];
      for (const [k, v] of parseStyle(src)) {
        if (!STYLE.has(k) || !safeValue(v)) continue;
        if (k === 'font-size') {
          const px = toPx(v);
          if (px > 0) parts.push('font-size:' + sizePx(px) + 'px');
          continue;
        }
        if (k === 'line-height') {
          // Qt treats percentages as proportional to each line's font (CSS would fix them to the block's font)
          const pm = /^([\d.]+)%$/.exec(v);
          if (pm) parts.push('line-height:' + Math.max(1, parseFloat(pm[1]) / 100));
          else if (/^[\d.]+$/.test(v)) parts.push('line-height:' + Math.max(1, parseFloat(v)));
          continue;
        }
        if (k === 'font-family') {
          const f = fontFamily(v);
          if (f) parts.push('font-family:' + f);
          continue;
        }
        if (k === 'width' || k === 'height') {
          if (mode === 'layout' && (tag === 'IMG' || tag === 'TD' || tag === 'TH' || tag === 'TABLE')) parts.push(k + ':' + v);
          continue;
        }
        if (mode === 'reflow' && /^margin-(left|right)$|^text-indent$/.test(k)) {
          const px = toPx(v);
          if (px > 0) parts.push(k + ':' + Math.min(px, 40) + 'px');
          continue;
        }
        parts.push(k + ':' + v);
      }
      if (parts.length) el.setAttribute('style', parts.join(';'));
    }

    function copy(src, dst) {
      for (let n = src.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          dst.appendChild(document.createTextNode(n.nodeValue));
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toUpperCase();
        if (DROP.has(tag)) continue;
        if (!TAGS.has(tag)) {
          copy(n, dst); // unknown wrapper (html/body/…): keep its children
          continue;
        }
        const el = document.createElement(tag === 'FONT' || tag === 'CENTER' ? (tag === 'CENTER' ? 'div' : 'span') : tag.toLowerCase());
        if (tag === 'CENTER') el.style.textAlign = 'center';
        cleanStyle(el, n.getAttribute('style'), tag);

        const align = n.getAttribute('align');
        if (align && /^(left|right|center|justify)$/i.test(align)) {
          if (tag === 'TABLE' || tag === 'IMG') {
            if (mode === 'layout' && /^center$/i.test(align)) el.style.marginLeft = el.style.marginRight = 'auto';
          } else el.style.textAlign = align.toLowerCase();
        }
        const valign = n.getAttribute('valign');
        if (valign && /^(top|middle|bottom|baseline)$/i.test(valign)) el.style.verticalAlign = valign.toLowerCase();
        for (const a of ['colspan', 'rowspan']) if (/^\d{1,3}$/.test(n.getAttribute(a) || '')) el.setAttribute(a, n.getAttribute(a));
        if (tag === 'FONT') {
          const c = n.getAttribute('color');
          if (c && /^#?[\w]+$/.test(c)) el.style.color = c;
        }
        const bg = n.getAttribute('bgcolor');
        if (bg && /^#?[\w]+$/.test(bg)) el.style.backgroundColor = bg;
        if (tag === 'TABLE') {
          const border = Number(n.getAttribute('border') || 0);
          if (border > 0) el.classList.add('rt-bordered');
          const pad = n.getAttribute('cellpadding');
          if (/^\d{1,2}$/.test(pad || '')) el.dataset.pad = pad;
          const w = n.getAttribute('width');
          if (mode === 'layout' && w && /^\d+%?$/.test(w)) el.style.width = /%$/.test(w) ? w : w + 'px';
        }
        if ((tag === 'TD' || tag === 'TH') && mode === 'layout') {
          const w = n.getAttribute('width');
          if (w && /^\d+%?$/.test(w)) el.style.width = /%$/.test(w) ? w : w + 'px';
        }
        if (tag === 'A') {
          const href = n.getAttribute('href') || '';
          if (/^(https?:|mailto:)/i.test(href)) {
            el.setAttribute('href', href);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        }
        if (tag === 'IMG') {
          const srcPath = n.getAttribute('src') || '';
          const w = Number(n.getAttribute('width'));
          const h = Number(n.getAttribute('height'));
          if (mode === 'layout' && w > 0) el.style.width = w + 'px';
          if (mode === 'layout' && h > 0) el.style.height = h + 'px';
          el.setAttribute('alt', n.getAttribute('alt') || '');
          if (/^data:image\/(png|jpe?g|gif|bmp|webp);base64,/i.test(srcPath)) {
            el.setAttribute('src', srcPath);
          } else if (loadImage && srcPath && !/^[a-z]+:\/\//i.test(srcPath)) {
            const path = srcPath.replace(/^file:\/*/i, '').replace(/^\.\//, '').replace(/\\/g, '/');
            loadImage(path).then((url) => { if (url) el.src = url; else el.remove(); }, () => el.remove());
          } else {
            continue;
          }
        }
        copy(n, el);
        dst.appendChild(el);
      }
    }

    copy(doc.body || doc.documentElement, root);
    return root;
  }

  function isEmpty(html) {
    const d = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return !(d.body && (d.body.textContent.trim() || d.body.querySelector('img')));
  }

  global.CapRichText = { render, isEmpty };
})(typeof window !== 'undefined' ? window : globalThis);
