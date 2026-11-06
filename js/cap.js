/*
 * PASCO Capstone (.cap) parser.
 *
 * A .cap file is a ZIP archive:
 *   main.xml        experiment description (sensors, measurements, runs, workbook pages)
 *   data/*.tmp      raw samples, one file per measurement per run / data set
 *   images/*.png    pictures shown on workbook pages
 *
 * Sensor data files are arrays of 12-byte little-endian records:
 *   uint32 flag (1 = valid sample) + float64 value  (StorageType="0")
 * Values typed into a table by the user are stored as strings:
 *   uint32 type (2 = text) + uint32 byteLength + UTF-16LE text  (StorageType="7")
 * Time is usually not stored: IndependentStorageElement StorageType="1" gives
 * start + i * interval; StorageType="4" means row index (user data sets).
 */
(function (global) {
  'use strict';

  // Capstone unit codes. High byte = quantity, low byte = unit variant.
  // f = size of the unit in SI, used to convert between variants of one quantity.
  const UNITS = {
    256: { s: 's', f: 1 },
    1024: { s: 'V', f: 1 },
    1025: { s: 'mV', f: 1e-3 },
    1280: { s: 'm', f: 1 },
    1794: { s: 'T', f: 1 },
    2048: { s: 'm/s²', f: 1 },
    2304: { s: 'm/s', f: 1 },
    3330: { s: 'C', f: 1 },
    3584: { s: 'A', f: 1 },
    3585: { s: 'mA', f: 1e-3 },
    10496: { s: 'kg', f: 1 },
  };

  const ZERO_ID = '{00000000-0000-0000-0000-000000000000}';
  const IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp|svg)$/i;

  function attr(el, name, def) {
    const v = el && el.getAttribute(name);
    return v == null ? def : v;
  }
  function num(el, name, def) {
    const v = el && el.getAttribute(name);
    if (v == null || v === '') return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }
  function kids(el, tag) {
    const out = [];
    if (!el) return out;
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!tag || c.tagName === tag) out.push(c);
    return out;
  }
  function kid(el, tag) {
    if (!el) return null;
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === tag) return c;
    return null;
  }
  function decodeText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function roundTime(t) {
    return Math.round(t * 1e9) / 1e9;
  }
  function htmlToText(html) {
    if (!html) return '';
    const d = new DOMParser().parseFromString(html, 'text/html');
    return (d.body ? d.body.textContent : '').replace(/\s+/g, ' ').trim();
  }
  function rgba(el) {
    if (!el) return null;
    return 'rgba(' + num(el, 'R', 255) + ',' + num(el, 'G', 255) + ',' + num(el, 'B', 255) + ',' + (num(el, 'A', 255) / 255).toFixed(3) + ')';
  }

  // ---------- data files ----------
  function decodeSamples(bytes, count, warnings, label) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.min(count, Math.floor(bytes.length / 12));
    // Bit 0 of the flag word marks a valid sample. Capstone sometimes sets higher bits too
    // (e.g. 0x00020001 on a point kept in manual sampling), so only the low 16 bits must be 0 or 1.
    let ok = true;
    for (let i = 0; i < n; i++) if ((dv.getUint32(i * 12, true) & 0xffff) > 1) { ok = false; break; }
    if (ok) {
      if (n < count) warnings.push(label + ': 데이터 파일이 예상보다 작습니다.');
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 12, true) & 1 ? dv.getFloat64(i * 12 + 4, true) : NaN;
      return out;
    }
    if (bytes.length >= count * 8) {
      warnings.push(label + ': 알 수 없는 데이터 형식이라 float64 배열로 해석했습니다.');
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) out[i] = dv.getFloat64(i * 8, true);
      return out;
    }
    warnings.push(label + ': 데이터 형식을 알 수 없습니다.');
    return null;
  }

  /** Values typed in by the user: [uint32 type][uint32 len][UTF-16LE text] ... */
  function decodeUserEntries(bytes, count, warnings, label) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder('utf-16le');
    const out = new Float64Array(count).fill(NaN);
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 4 > bytes.length) break;
      const type = dv.getUint32(p, true);
      p += 4;
      if (type === 0) continue; // empty cell
      if (type === 2) {
        if (p + 4 > bytes.length) break;
        const len = dv.getUint32(p, true);
        p += 4;
        if (len > bytes.length - p) break;
        const s = dec.decode(bytes.subarray(p, p + len)).trim().replace(',', '.');
        p += len;
        const v = s === '' ? NaN : Number(s);
        out[i] = Number.isFinite(v) ? v : NaN;
      } else {
        warnings.push(label + ': 입력 데이터 일부를 해석하지 못했습니다 (형식 ' + type + ').');
        break;
      }
    }
    return out;
  }

  async function readDependent(zip, el, count, warnings, label) {
    const fileName = attr(el, 'FileName', '');
    if (!fileName) return null;
    const entry = zip.get(fileName);
    if (!entry) {
      warnings.push(label + ': 데이터 파일 ' + fileName + ' 이(가) 없습니다.');
      return null;
    }
    const bytes = await zip.read(entry);
    if (attr(el, 'StorageType', '0') === '7') return decodeUserEntries(bytes, count, warnings, label);
    return decodeSamples(bytes, count, warnings, label);
  }

  async function readIndependent(zip, el, count, warnings, label) {
    const type = attr(el, 'StorageType', '');
    if (type === '1') {
      const start = num(el, 'IntervalCacheStartValue', 0);
      const step = num(el, 'IntervalCacheInterval', 1);
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) out[i] = roundTime(start + i * step);
      return { t: out, indexBased: false };
    }
    if (type !== '4' && attr(el, 'FileName', '')) {
      const entry = zip.get(attr(el, 'FileName', ''));
      if (entry) {
        const v = decodeSamples(await zip.read(entry), count, warnings, label);
        if (v && v.length === count) return { t: v, indexBased: false };
      }
    }
    const out = new Float64Array(count);
    for (let i = 0; i < count; i++) out[i] = i + 1;
    return { t: out, indexBased: true };
  }

  function concat(arrays) {
    if (arrays.length === 1) return arrays[0];
    let n = 0;
    for (const a of arrays) n += a.length;
    const out = new Float64Array(n);
    let o = 0;
    for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  }

  // ---------- units ----------
  /** Unit to show for a measurement, optionally in a display's chosen unit. */
  function unitFor(meas, displayCode) {
    if (!meas) return { symbol: '', scale: 1 };
    if (meas.customUnit) return { symbol: meas.customUnit, scale: 1 };
    const base = UNITS[meas.baseCode];
    const want = displayCode || meas.defaultCode;
    const disp = UNITS[want];
    if (base && disp && want >> 8 === meas.baseCode >> 8) return { symbol: disp.s, scale: base.f / disp.f };
    return { symbol: base ? base.s : '', scale: 1 };
  }

  // ---------- calculator ----------
  // Expression tree node types seen in Capstone files.
  const AST = { NUMBER: 1, REF: 3, UNIT: 4, ADD: 5, SUB: 6, MUL: 9, POW: 14, ASSIGN: 27 };

  function evaluateCalculations(doc, cap, warnings) {
    const exprs = new Map();
    for (const ex of doc.getElementsByTagName('Expression')) {
      const root = kid(ex, 'ASTNode');
      if (root && Number(attr(root, 'Type', 0)) === AST.ASSIGN && root.getAttribute('EUID')) exprs.set(root.getAttribute('EUID'), root);
    }
    const busy = new Set();

    function ensure(measId) {
      const m = cap.measById.get(measId);
      if (!m || m.kind !== 'calc' || m.evaluated) return;
      const root = exprs.get(measId);
      m.evaluated = true;
      if (!root) return;
      if (busy.has(measId)) throw new Error('순환 참조');
      busy.add(measId);
      try {
        const refs = new Set();
        collectRefs(kid(root, 'ASTNode'), refs);
        refs.forEach(ensure);
        // data sets where every referenced (non-constant) measurement has data
        const varRefs = Array.from(refs).filter((id) => { const r = cap.measById.get(id); return r && r.kind !== 'const'; });
        let sets = null;
        for (const id of varRefs) {
          const ids = new Set();
          for (const [dsId, d] of cap.dataByDs) if (d.has(id)) ids.add(dsId);
          sets = sets ? new Set(Array.from(sets).filter((x) => ids.has(x))) : ids;
        }
        if (!sets) return; // constant-only expressions are not shown
        for (const dsId of sets) {
          const data = cap.dataByDs.get(dsId);
          const res = evalNode(kid(root, 'ASTNode'), data);
          if (res == null || typeof res === 'number') continue;
          data.set(measId, res);
        }
      } catch (e) {
        warnings.push('계산값 "' + m.name + '": ' + (e && e.message ? e.message : e));
      } finally {
        busy.delete(measId);
      }
    }

    function collectRefs(node, out) {
      if (!node) return;
      if (Number(attr(node, 'Type', 0)) === AST.REF && node.getAttribute('EUID')) out.add(node.getAttribute('EUID'));
      for (const c of kids(node, 'ASTNode')) collectRefs(c, out);
    }

    function binary(a, b, fn) {
      if (typeof a === 'number' && typeof b === 'number') return fn(a, b);
      const base = typeof a === 'number' ? b : a;
      const n = typeof a === 'number' ? b.v.length : typeof b === 'number' ? a.v.length : Math.min(a.v.length, b.v.length);
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) v[i] = fn(typeof a === 'number' ? a : a.v[i], typeof b === 'number' ? b : b.v[i]);
      return { t: base.t.subarray(0, n), v, indexBased: base.indexBased };
    }

    function evalNode(node, data) {
      if (!node) throw new Error('빈 수식');
      const type = Number(attr(node, 'Type', 0));
      const ch = kids(node, 'ASTNode');
      switch (type) {
        case AST.NUMBER: {
          const v = num(node, 'Value', NaN);
          if (!Number.isFinite(v)) throw new Error('숫자를 읽을 수 없음');
          return v;
        }
        case AST.REF: {
          const id = node.getAttribute('EUID');
          const m = cap.measById.get(id);
          if (!m) throw new Error('알 수 없는 측정값 ' + attr(node, 'Name', ''));
          let val;
          if (m.kind === 'const') {
            if (!Number.isFinite(m.constValue)) throw new Error('상수 값을 알 수 없음: ' + m.name);
            val = m.constValue;
          } else {
            const d = data.get(id);
            if (!d) return null;
            val = d;
          }
          const conv = ch.find((c) => Number(attr(c, 'Type', 0)) === AST.UNIT);
          if (conv) {
            const from = UNITS[m.baseCode];
            const to = UNITS[num(conv, 'BaseUnit', 0)];
            if (!from || !to) throw new Error('단위 변환을 지원하지 않음');
            const k = from.f / to.f;
            val = typeof val === 'number' ? val * k : { t: val.t, v: val.v.map((x) => x * k), indexBased: val.indexBased };
          }
          return val;
        }
        case AST.ASSIGN:
          return evalNode(ch[0], data);
        case AST.ADD: case AST.SUB: case AST.MUL: case AST.POW: {
          if (ch.length !== 2) throw new Error('지원하지 않는 수식 형태');
          const a = evalNode(ch[0], data);
          const b = evalNode(ch[1], data);
          if (a == null || b == null) return null;
          const fn = type === AST.ADD ? (x, y) => x + y : type === AST.SUB ? (x, y) => x - y : type === AST.MUL ? (x, y) => x * y : (x, y) => Math.pow(x, y);
          return binary(a, b, fn);
        }
        default:
          throw new Error('아직 지원하지 않는 함수/연산이 있습니다');
      }
    }

    for (const m of cap.measurements) if (m.kind === 'calc') ensure(m.id);
  }

  // ---------- workbook ----------
  function bundleInputs(el) {
    return kids(el, 'BundleInput')
      .map((b) => {
        const ad = kid(b, 'DataAdapter');
        const nf = kid(b, 'InputNumberFormatter');
        return {
          index: num(b, 'BundleIndex', 0),
          measId: attr(b, 'BundleMeasID', ZERO_ID),
          dsId: attr(b, 'BundleDataSetID', ZERO_ID),
          unitCode: ad ? num(ad, 'ConverterConverterUnit', 0) : 0,
          decimals: nf && attr(b, 'InputUsingDefaultNumberFormat', 'TRUE') === 'FALSE' ? num(nf, 'FixedDecimals', null) : null,
        };
      })
      .sort((a, b) => a.index - b.index);
  }

  function parseGraph(g) {
    const res = { x: null, y: [], runs: [], points: true, lines: true, fit: 'none' };
    const pa = g.getElementsByTagName('ZPlotArea')[0];
    if (!pa) return res;
    const xin = bundleInputs(kid(pa, 'ZLinearAxis')).find((b) => b.index === 0 && b.measId !== ZERO_ID);
    if (xin) res.x = { measId: xin.measId, unitCode: xin.unitCode };
    const props = kid(pa, 'ZTwoDimensionDataRenderBasicProperties');
    if (props) {
      res.points = attr(props, 'ZTDDRBPShowDataPoints', '1') === '1';
      res.lines = attr(props, 'ZTDDRBPShowConnectingLines', '1') === '1';
      if (!res.points && !res.lines) res.lines = true;
    }
    for (const rs of pa.getElementsByTagName('ZRenderSet')) {
      let y = bundleInputs(kid(rs, 'ZLinearAxis')).find((b) => b.index === 1 && b.measId !== ZERO_ID);
      const sel = kid(rs, 'ZRSNonDataSelectorProvidedInputs');
      if (!y && sel && attr(sel, 'EUID', ZERO_ID) !== ZERO_ID) y = { measId: attr(sel, 'EUID'), unitCode: num(sel, 'TokenUnitType', 0) };
      if (y) res.y.push({ measId: y.measId, unitCode: y.unitCode });
      for (const r of kids(rs, 'ZRSIndividualRenederer')) {
        const p = kid(r, 'ZTwoDimensionDataRenderBasicProperties');
        const ins = bundleInputs(r);
        if (p && attr(p, 'ZTDDRBPActive', '0') === '1' && ins[0] && ins[0].dsId !== ZERO_ID && !res.runs.includes(ins[0].dsId)) res.runs.push(ins[0].dsId);
      }
    }
    const fit = g.getElementsByTagName('LineGraphCurveFitChecked')[0];
    if (fit && attr(fit, 'LineGraphCurveFitType', '') === '1') res.fit = 'linear';
    return res;
  }

  function findImage(el) {
    const stack = [el];
    while (stack.length) {
      const e = stack.pop();
      const f = e.getAttribute && e.getAttribute('FileName');
      if (f && IMAGE_RE.test(f)) return f.replace(/\\/g, '/');
      for (let c = e.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
    }
    return null;
  }

  const OTHER_NAMES = {
    CSMeter: '미터', CSAnalogMeter: '미터', CSScope: '오실로스코프', CSFFT: 'FFT', CSMovie: '동영상', CSVideo: '동영상',
    CSHistogram: '히스토그램', CSMap: '지도', CSVectorDisplay: '벡터 표시', CSSignalGenerator: '신호 발생기', CSQuiz: '퀴즈',
  };

  function parseItem(it) {
    const guid = attr(it, 'GUID', '');
    const inner = kid(it, guid);
    const pos = kid(it, 'Position');
    const size = kid(it, 'Size');
    const dt = kid(it, 'DisplayTitle');
    const item = {
      guid,
      x: num(pos, 'X', 0),
      y: num(pos, 'Y', 0),
      w: num(size, 'Width', 1),
      h: num(size, 'Height', 1),
      z: num(it, 'ZValue', 0),
      frame: attr(it, 'ShowFrame', 'FALSE') === 'TRUE',
      bg: rgba(kid(it, 'BackgroundColor')),
      title: dt ? htmlToText(attr(dt, 'DisplayTitleText', '')) : '',
      titleVisible: attr(it, 'TitleVisible', 'FALSE') === 'TRUE',
      type: 'other',
    };
    if (/^\[.*here\]$/i.test(item.title)) item.titleVisible = false;

    if (guid === 'CSTextEdit') {
      item.type = 'text';
      item.html = attr(inner, 'HTML', '');
    } else if (guid === 'CSTextEntry') {
      item.type = 'entry';
      item.html = attr(inner, 'HTML', '');
      item.label = attr(inner, 'ObjectName', '');
    } else if (guid === 'CSLineGraph') {
      item.type = 'graph';
      item.graph = parseGraph(inner || it);
    } else if (guid === 'CSDataTable') {
      item.type = 'table';
      const db = inner && kid(inner, 'DataBundle');
      item.columns = db ? bundleInputs(db).filter((b) => b.measId !== ZERO_ID) : [];
    } else if (guid === 'CSDataDigits' || (inner && kid(inner, 'DataBundle') && /Meter/i.test(guid))) {
      item.type = 'digits';
      const db = inner && kid(inner, 'DataBundle');
      item.input = db ? bundleInputs(db).find((b) => b.measId !== ZERO_ID) || null : null;
    } else {
      const img = findImage(it);
      if (img) {
        item.type = 'image';
        item.file = img;
      } else {
        item.label = OTHER_NAMES[guid] || guid.replace(/^CS/, '') || '디스플레이';
      }
    }
    return item;
  }

  function parsePages(doc) {
    const wb = doc.getElementsByTagName('Workbook')[0];
    if (!wb) return { pages: [], current: 0 };
    const pages = kids(wb, 'WorkbookPage').map((pg, i) => {
      const ps = kid(pg, 'PageSize');
      return {
        name: attr(pg, 'Name', '') || '페이지 ' + (i + 1),
        width: num(ps, 'Width', 1120),
        height: num(ps, 'Height', 580),
        items: kids(pg, 'WorkbookItem').map(parseItem),
      };
    });
    return { pages, current: Math.max(0, Math.min(pages.length - 1, num(wb, 'CurrentPage', 0))) };
  }

  // ---------- main ----------
  async function parseCap(file, onProgress) {
    const progress = onProgress || function () {};
    const warnings = [];
    progress('ZIP 읽는 중…', 0);
    const zip = await global.CapZip.ZipReader.open(file);
    const mainEntry = zip.get('main.xml') || zip.entries.find((e) => /(^|\/)main\.xml$/i.test(e.name));
    if (!mainEntry) throw new Error('main.xml 이 없습니다. PASCO Capstone .cap 파일이 맞는지 확인하세요.');

    progress('실험 정보 읽는 중…', 0.05);
    const doc = new DOMParser().parseFromString(decodeText(await zip.read(mainEntry)), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('main.xml 을 해석할 수 없습니다 (XML 오류).');
    const header = doc.getElementsByTagName('Header')[0];

    // runs
    const runInfo = new Map();
    for (const set of doc.getElementsByTagName('RunParameterSet')) {
      const r = { number: NaN, name: '', start: null, stop: null, periods: [] };
      for (const pv of kids(set, 'ParameterValue')) {
        if (pv.hasAttribute('RunNumber')) r.number = Number(pv.getAttribute('RunNumber'));
        if (pv.hasAttribute('RunName')) r.name = pv.getAttribute('RunName');
        if (pv.hasAttribute('RunStartTime')) r.start = Number(pv.getAttribute('RunStartTime'));
        if (pv.hasAttribute('RunStopTime')) r.stop = Number(pv.getAttribute('RunStopTime'));
        for (const sr of kids(pv, 'SampleRates')) if (Number.isFinite(num(sr, 'Period', NaN))) r.periods.push(num(sr, 'Period', NaN));
      }
      runInfo.set(attr(set, 'RunParameterID', ''), r);
    }

    // sensors
    const sensors = [];
    for (const s of doc.getElementsByTagName('Sensor')) {
      const meas = Array.from(new Set(kids(s, 'Measurement').map((m) => (m.hasAttribute('Value') ? '' : attr(m, 'Name', ''))).filter((n) => n && !/^[?!]/.test(n))));
      const name = attr(s, 'Name', '센서');
      const same = sensors.find((x) => x.name === name);
      if (same) same.measurements = Array.from(new Set(same.measurements.concat(meas)));
      else sensors.push({ name, period: num(s, 'SamplePeriod', NaN), measurements: meas });
    }

    // measurements
    const timeEl = doc.getElementsByTagName('MasterTimeMeasurement')[0];
    const time = {
      id: attr(timeEl, 'EUID', 'time'),
      name: attr(timeEl, 'MeasurementName', 'Time'),
      kind: 'time',
      baseCode: num(timeEl, 'BaseUnit', 256),
      defaultCode: num(timeEl, 'DefaultUnit', 256),
      customUnit: '',
      decimals: 3,
    };
    const measById = new Map([[time.id, time]]);
    const measurements = [];
    const dataEls = [];
    for (const el of doc.getElementsByTagName('DataSource')) {
      const id = el.getAttribute('EUID');
      const name = attr(el, 'MeasurementName', '') || attr(el, 'LongName', '');
      if (!id || !name) continue;
      const src = num(el, 'DataMeasSourceType', 0);
      const kind = src === 100 ? 'const' : src === 1007 ? 'calc' : src === 1001 ? 'user' : 'sensor';
      const m = {
        id,
        name,
        kind,
        symbol: attr(el, 'SymbolName', ''),
        baseCode: num(el, 'BaseUnit', 0),
        defaultCode: num(el, 'DefaultUnit', 0),
        customUnit: attr(el, 'CustomUnitString', ''),
        decimals: num(kid(el, 'DataSourceNumberFormatter'), 'FixedDecimals', 3),
        sensor: attr(el, 'ChannelIDName', ''),
        constValue: NaN,
        runCount: 0,
      };
      if (kind === 'const') {
        const a = num(el, 'DefaultMinimumDisplayValue', NaN);
        const b = num(el, 'DefaultMaximumDisplayValue', NaN);
        if (a === b) m.constValue = a;
      }
      measById.set(id, m);
      measurements.push(m);
      if (kid(el, 'DataSet')) dataEls.push([el, m]);
    }

    // data
    const dsNames = new Map();
    const dataByDs = new Map();
    let total = 0;
    for (const [el] of dataEls) total += kids(el, 'DataSet').length;
    let done = 0;
    for (const [el, m] of dataEls) {
      for (const ds of kids(el, 'DataSet')) {
        done++;
        if (attr(ds, 'DataHasBeenDeleted', 'FALSE') === 'TRUE') continue;
        const dsId = attr(ds, 'DataSetID', '');
        if (attr(ds, 'Name', '') && !dsNames.has(dsId)) dsNames.set(dsId, attr(ds, 'Name', ''));
        const label = m.name + ' (' + (runInfo.get(dsId) ? '런 ' + runInfo.get(dsId).number : attr(ds, 'Name', '') || '데이터 세트') + ')';
        const tParts = [], vParts = [];
        let indexBased = false;
        for (const seg of kids(ds, 'DataSegmentElement')) {
          const dep = kid(seg, 'DependentStorageElement');
          const ind = kid(seg, 'IndependentStorageElement');
          if (!dep) continue;
          const count = num(dep, 'DataCacheDataSize', num(ind, 'CacheDataCount', 0));
          if (!count) continue;
          const v = await readDependent(zip, dep, count, warnings, label);
          if (!v) continue;
          const t = ind ? await readIndependent(zip, ind, v.length, warnings, label) : null;
          if (t && t.t.length === v.length) {
            tParts.push(t.t);
            indexBased = indexBased || t.indexBased;
          } else {
            const idx = new Float64Array(v.length);
            for (let i = 0; i < v.length; i++) idx[i] = i + 1;
            tParts.push(idx);
            indexBased = true;
          }
          vParts.push(v);
        }
        if (!vParts.length) continue;
        if (!dataByDs.has(dsId)) dataByDs.set(dsId, new Map());
        dataByDs.get(dsId).set(m.id, { t: concat(tParts), v: concat(vParts), indexBased });
        if (done % 8 === 0) progress('데이터 읽는 중… (' + done + '/' + total + ')', 0.1 + 0.8 * (done / total));
      }
    }

    const cap = { measById, measurements, dataByDs, time };
    evaluateCalculations(doc, cap, warnings);

    // runs / data sets in display order
    const runs = [];
    for (const [dsId, data] of dataByDs) {
      const info = runInfo.get(dsId);
      const isRun = info && Number.isFinite(info.number) && info.number < 1e9;
      let points = 0, duration = 0, indexBased = true;
      for (const d of data.values()) {
        points = Math.max(points, d.v.length);
        if (!d.indexBased) {
          indexBased = false;
          if (d.t.length) duration = Math.max(duration, d.t[d.t.length - 1]);
        }
      }
      runs.push({
        id: dsId,
        kind: isRun ? 'run' : 'set',
        number: isRun ? info.number : NaN,
        name: isRun ? info.name || '런 #' + info.number : dsNames.get(dsId) || '데이터 세트',
        start: isRun && info.start && info.start < 4e9 ? new Date(info.start * 1000) : null,
        stop: isRun && info.stop && info.stop < 4e9 ? new Date(info.stop * 1000) : null,
        periods: info ? info.periods : [],
        points,
        duration,
        indexBased,
        data,
      });
    }
    runs.sort((a, b) => (a.kind === b.kind ? (a.kind === 'run' ? a.number - b.number : a.name.localeCompare(b.name)) : a.kind === 'run' ? -1 : 1));
    runs.forEach((r, i) => { r.index = i; });

    for (const m of measurements) m.runCount = runs.filter((r) => r.data.has(m.id)).length;

    const { pages, current } = parsePages(doc);

    progress('완료', 1);
    return {
      zip,
      fileName: file.name || '',
      fileSize: file.size,
      version: attr(header, 'Version', ''),
      sensors,
      time,
      measById,
      allMeasurements: measurements,
      measurements: measurements.filter((m) => m.runCount > 0),
      runs,
      pages,
      currentPage: current,
      warnings,
    };
  }

  // ---------- data access helpers ----------
  function runById(cap, id) {
    return cap.runs.find((r) => r.id === id) || null;
  }

  /** Data of one measurement in one run; the time measurement is derived from any column. */
  function getData(cap, measId, run) {
    if (!run) return null;
    if (measId === cap.time.id) {
      for (const d of run.data.values()) if (!d.indexBased) return { t: d.t, v: d.t, indexBased: false };
      return null;
    }
    return run.data.get(measId) || null;
  }

  /** The run a display shows: the stored one if it has data, else the latest run with data. */
  function resolveRun(cap, measId, dsId) {
    const has = (r) => (measId === cap.time.id ? !r.indexBased : r.data.has(measId));
    if (dsId && dsId !== ZERO_ID) {
      const r = runById(cap, dsId);
      if (r && has(r)) return r;
    }
    const real = cap.runs.filter((r) => r.kind === 'run' && has(r));
    if (real.length) return real[real.length - 1];
    const sets = cap.runs.filter(has);
    return sets.length ? sets[sets.length - 1] : null;
  }

  function keyOf(d, i) {
    return d.indexBased ? 'i' + i : 't' + Math.round(d.t[i] * 1e6);
  }

  /** Pair two measurements of one run (by time stamps, or by row for typed-in data). */
  function seriesFor(cap, run, xMeasId, yMeasId) {
    const y = getData(cap, yMeasId, run);
    if (!y) return null;
    if (xMeasId === cap.time.id && !y.indexBased) return { x: y.t, y: y.v };
    const x = getData(cap, xMeasId, run);
    if (!x) return null;
    const byIndex = x.indexBased || y.indexBased;
    const map = new Map();
    for (let i = 0; i < x.v.length; i++) map.set(byIndex ? i : keyOf(x, i), x.v[i]);
    const xs = [], ys = [];
    for (let i = 0; i < y.v.length; i++) {
      const xv = map.get(byIndex ? i : keyOf(y, i));
      if (xv !== undefined) { xs.push(xv); ys.push(y.v[i]); }
    }
    return { x: Float64Array.from(xs), y: Float64Array.from(ys) };
  }

  /**
   * Merge columns [{measId, run}] into rows. Columns from time-based data are
   * aligned by time, typed-in data by row number.
   */
  function mergeColumns(cap, columns) {
    const rows = new Map();
    const order = [];
    columns.forEach((c, ci) => {
      const d = getData(cap, c.measId, c.run);
      if (!d) return;
      for (let i = 0; i < d.v.length; i++) {
        const key = keyOf(d, i);
        let row = rows.get(key);
        if (!row) {
          row = { key, t: d.indexBased ? NaN : d.t[i], idx: i, vals: new Array(columns.length).fill(NaN) };
          rows.set(key, row);
          order.push(row);
        }
        row.vals[ci] = d.v[i];
      }
    });
    order.sort((a, b) => {
      const ta = Number.isFinite(a.t), tb = Number.isFinite(b.t);
      if (ta && tb) return a.t - b.t;
      if (ta !== tb) return ta ? -1 : 1;
      return a.idx - b.idx;
    });
    return order;
  }

  /** All measurements of a run, with a time column when the run has timed data. */
  function tableFor(cap, run) {
    const cols = cap.measurements.filter((m) => run.data.has(m.id));
    const withTime = !run.indexBased;
    const columns = (withTime ? [cap.time] : []).concat(cols).map((m) => ({ meas: m, measId: m.id, run }));
    return { columns, rows: mergeColumns(cap, columns) };
  }

  global.CapParser = { parseCap, getData, resolveRun, seriesFor, mergeColumns, tableFor, unitFor, runById, UNITS, ZERO_ID };
})(typeof window !== 'undefined' ? window : globalThis);
