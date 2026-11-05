/*
 * Minimal PDF writer: one full-page JPEG image per page, with a bookmark
 * (outline) entry per page. No dependencies.
 *
 * CapPdf.build([{ jpeg: Uint8Array, width, height, widthPt, heightPt, title }], { title, author })
 *   -> Blob (application/pdf)
 */
(function (global) {
  'use strict';

  const ascii = new TextEncoder();

  /** PDF text string as UTF-16BE hex (works for Korean titles). */
  function textString(s) {
    let hex = '<FEFF';
    for (const ch of String(s || '')) {
      const cp = ch.codePointAt(0);
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
      } else {
        hex += cp.toString(16).padStart(4, '0');
      }
    }
    return hex.toUpperCase() + '>';
  }

  function pdfDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return '(D:' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ')';
  }

  function num(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function build(pages, meta) {
    if (!pages.length) throw new Error('PDF에 넣을 페이지가 없습니다');
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const put = (data) => {
      const b = typeof data === 'string' ? ascii.encode(data) : data;
      chunks.push(b);
      pos += b.length;
    };
    const obj = (n, ...parts) => {
      offsets[n] = pos;
      put(n + ' 0 obj\n');
      for (const p of parts) put(p);
      put('\nendobj\n');
    };

    // object numbers
    const CATALOG = 1, PAGES = 2, INFO = 3, OUTLINES = 4;
    const pageObj = (i) => 5 + i * 3;
    const contentObj = (i) => 6 + i * 3;
    const imageObj = (i) => 7 + i * 3;
    const outlineObj = (i) => 5 + pages.length * 3 + i;
    const total = 5 + pages.length * 4;

    put('%PDF-1.4\n');
    put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

    obj(CATALOG, '<< /Type /Catalog /Pages ' + PAGES + ' 0 R /Outlines ' + OUTLINES + ' 0 R /PageMode /UseOutlines >>');
    obj(PAGES, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => pageObj(i) + ' 0 R').join(' ') + '] >>');
    obj(INFO, '<< /Title ' + textString(meta && meta.title) + ' /Producer ' + textString('CAP 뷰어') +
      ' /Creator ' + textString('CAP 뷰어') + ' /CreationDate ' + pdfDate(new Date()) + ' >>');
    obj(OUTLINES, '<< /Type /Outlines /First ' + outlineObj(0) + ' 0 R /Last ' + outlineObj(pages.length - 1) + ' 0 R /Count ' + pages.length + ' >>');

    pages.forEach((p, i) => {
      const W = num(p.widthPt), H = num(p.heightPt);
      obj(pageObj(i), '<< /Type /Page /Parent ' + PAGES + ' 0 R /MediaBox [0 0 ' + W + ' ' + H + '] ' +
        '/Resources << /XObject << /Im0 ' + imageObj(i) + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' + contentObj(i) + ' 0 R >>');
      const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
      obj(contentObj(i), '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      obj(imageObj(i), '<< /Type /XObject /Subtype /Image /Width ' + p.width + ' /Height ' + p.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n', p.jpeg, '\nendstream');
    });

    pages.forEach((p, i) => {
      let s = '<< /Title ' + textString(p.title || 'Page ' + (i + 1)) + ' /Parent ' + OUTLINES + ' 0 R';
      if (i > 0) s += ' /Prev ' + outlineObj(i - 1) + ' 0 R';
      if (i < pages.length - 1) s += ' /Next ' + outlineObj(i + 1) + ' 0 R';
      s += ' /Dest [' + pageObj(i) + ' 0 R /Fit] >>';
      obj(outlineObj(i), s);
    });

    const xref = pos;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let n = 1; n < total; n++) x += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    put(x);
    put('trailer\n<< /Size ' + total + ' /Root ' + CATALOG + ' 0 R /Info ' + INFO + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  global.CapPdf = { build };
})(typeof window !== 'undefined' ? window : globalThis);
