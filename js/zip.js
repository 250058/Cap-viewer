/*
 * Minimal ZIP reader that works on a Blob/File without loading it whole.
 * Supports stored (0) and deflate (8) entries and ZIP64 sizes/offsets.
 * Deflate uses the browser's DecompressionStream when available and falls
 * back to a small pure-JS inflater (older iOS Safari etc.).
 */
(function (global) {
  'use strict';

  // ---------- pure JS inflate (raw DEFLATE, RFC 1951) ----------
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function buildHuffman(lengths, n) {
    const count = new Uint16Array(16);
    const symbol = new Uint16Array(n);
    const offs = new Uint16Array(16);
    for (let i = 0; i < n; i++) count[lengths[i]]++;
    count[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
    return { count, symbol };
  }

  let FIXED = null;
  function fixedTables() {
    if (FIXED) return FIXED;
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    const d = new Uint8Array(30).fill(5);
    FIXED = { lit: buildHuffman(l, 288), dist: buildHuffman(d, 30) };
    return FIXED;
  }

  function inflateRaw(data, sizeHint) {
    let out = new Uint8Array(Math.max(sizeHint || 0, 1024));
    let outPos = 0;
    let pos = 0;
    let bitBuf = 0;
    let bitCnt = 0;

    function grow(n) {
      if (outPos + n <= out.length) return;
      const nb = new Uint8Array(Math.max(out.length * 2, outPos + n));
      nb.set(out.subarray(0, outPos));
      out = nb;
    }
    function bits(n) {
      while (bitCnt < n) {
        if (pos >= data.length) throw new Error('압축 데이터가 중간에 끝났습니다');
        bitBuf |= data[pos++] << bitCnt;
        bitCnt += 8;
      }
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    }
    function decode(h) {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c;
        first += c;
        first <<= 1;
        code <<= 1;
      }
      throw new Error('잘못된 허프만 코드');
    }
    function codes(lit, dist) {
      for (;;) {
        let sym = decode(lit);
        if (sym < 256) {
          grow(1);
          out[outPos++] = sym;
        } else if (sym === 256) {
          return;
        } else {
          sym -= 257;
          if (sym >= 29) throw new Error('잘못된 길이 코드');
          const len = LBASE[sym] + bits(LEXT[sym]);
          const ds = decode(dist);
          if (ds >= 30) throw new Error('잘못된 거리 코드');
          const d = DBASE[ds] + bits(DEXT[ds]);
          if (d > outPos) throw new Error('거리가 출력보다 깁니다');
          grow(len);
          for (let i = 0; i < len; i++, outPos++) out[outPos] = out[outPos - d];
        }
      }
    }

    let last;
    do {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0;
        bitCnt = 0;
        if (pos + 4 > data.length) throw new Error('압축 데이터가 중간에 끝났습니다');
        const len = data[pos] | (data[pos + 1] << 8);
        pos += 4;
        if (pos + len > data.length) throw new Error('압축 데이터가 중간에 끝났습니다');
        grow(len);
        out.set(data.subarray(pos, pos + len), outPos);
        outPos += len;
        pos += len;
      } else if (type === 1) {
        const f = fixedTables();
        codes(f.lit, f.dist);
      } else if (type === 2) {
        const nlen = bits(5) + 257;
        const ndist = bits(5) + 1;
        const ncode = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
        const clh = buildHuffman(cl, 19);
        const lengths = new Uint8Array(nlen + ndist);
        let i = 0;
        while (i < nlen + ndist) {
          const sym = decode(clh);
          if (sym < 16) {
            lengths[i++] = sym;
          } else {
            let rep, val = 0;
            if (sym === 16) {
              if (i === 0) throw new Error('반복할 길이가 없습니다');
              val = lengths[i - 1];
              rep = 3 + bits(2);
            } else if (sym === 17) {
              rep = 3 + bits(3);
            } else {
              rep = 11 + bits(7);
            }
            if (i + rep > nlen + ndist) throw new Error('코드 길이가 너무 깁니다');
            while (rep--) lengths[i++] = val;
          }
        }
        codes(buildHuffman(lengths.subarray(0, nlen), nlen), buildHuffman(lengths.subarray(nlen), ndist));
      } else {
        throw new Error('잘못된 블록 형식');
      }
    } while (!last);

    return out.subarray(0, outPos);
  }

  async function inflateNative(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  let nativeOk = typeof DecompressionStream !== 'undefined';
  async function inflate(bytes, sizeHint) {
    if (nativeOk && !global.__capForceJsInflate) {
      try {
        return await inflateNative(bytes);
      } catch (e) {
        // e.g. 'deflate-raw' not supported -> use JS from now on
        if (e instanceof TypeError || e instanceof RangeError) nativeOk = false;
      }
    }
    return inflateRaw(bytes, sizeHint);
  }

  // ---------- ZIP container ----------
  async function readBytes(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; }
  function u64(b, o) { return u32(b, o) + u32(b, o + 4) * 0x100000000; }

  class ZipReader {
    constructor(blob, entries) {
      this.blob = blob;
      this.entries = entries;
      this.byName = new Map();
      for (const e of entries) this.byName.set(e.name.replace(/\\/g, '/').toLowerCase(), e);
    }

    static async open(blob) {
      const size = blob.size;
      if (size < 22) throw new Error('ZIP 형식이 아닙니다 (파일이 너무 작음)');
      const tailLen = Math.min(size, 22 + 65535);
      const tail = await readBytes(blob, size - tailLen, size);
      let eocd = -1;
      for (let i = tail.length - 22; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error('ZIP 형식이 아닙니다 (.cap 파일이 맞는지 확인하세요)');
      let count = u16(tail, eocd + 10);
      let cdSize = u32(tail, eocd + 12);
      let cdOffset = u32(tail, eocd + 16);

      if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
        const loc = eocd - 20;
        if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
          const z64Off = u64(tail, loc + 8);
          const z = await readBytes(blob, z64Off, z64Off + 56);
          if (u32(z, 0) === 0x06064b50) {
            count = u64(z, 32);
            cdSize = u64(z, 40);
            cdOffset = u64(z, 48);
          }
        }
      }

      const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
      const utf8 = new TextDecoder('utf-8');
      const entries = [];
      let p = 0;
      for (let n = 0; n < count && p + 46 <= cd.length; n++) {
        if (u32(cd, p) !== 0x02014b50) break;
        const flags = u16(cd, p + 8);
        const method = u16(cd, p + 10);
        let compSize = u32(cd, p + 20);
        let size = u32(cd, p + 24);
        const nameLen = u16(cd, p + 28);
        const extraLen = u16(cd, p + 30);
        const commentLen = u16(cd, p + 32);
        let offset = u32(cd, p + 42);
        const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));
        // ZIP64 extra field
        let e = p + 46 + nameLen;
        const eEnd = e + extraLen;
        while (e + 4 <= eEnd) {
          const id = u16(cd, e);
          const len = u16(cd, e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
            if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8; }
            if (offset === 0xffffffff) { offset = u64(cd, q); q += 8; }
          }
          e += 4 + len;
        }
        entries.push({ name, method, flags, compSize, size, offset });
        p += 46 + nameLen + extraLen + commentLen;
      }
      return new ZipReader(blob, entries);
    }

    get(name) {
      return this.byName.get(String(name).replace(/\\/g, '/').toLowerCase()) || null;
    }

    async read(entry) {
      if (typeof entry === 'string') {
        const e = this.get(entry);
        if (!e) throw new Error('파일 안에 ' + entry + ' 항목이 없습니다');
        entry = e;
      }
      if (entry.flags & 1) throw new Error('암호화된 ZIP 항목은 열 수 없습니다');
      const lh = await readBytes(this.blob, entry.offset, entry.offset + 30);
      if (u32(lh, 0) !== 0x04034b50) throw new Error('손상된 ZIP 항목: ' + entry.name);
      const start = entry.offset + 30 + u16(lh, 26) + u16(lh, 28);
      const raw = await readBytes(this.blob, start, start + entry.compSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return inflate(raw, entry.size);
      throw new Error('지원하지 않는 압축 방식(' + entry.method + '): ' + entry.name);
    }
  }

  global.CapZip = { ZipReader, inflateRaw };
})(typeof window !== 'undefined' ? window : globalThis);
