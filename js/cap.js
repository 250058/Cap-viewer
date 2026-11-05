/*
 * PASCO Capstone (.cap) parser.
 *
 * A .cap file is a ZIP archive:
 *   main.xml        experiment description (sensors, measurements, runs, pages)
 *   data/*.tmp      raw samples, one file per measurement per run
 *
 * Each data file is an array of 12-byte little-endian records:
 *   uint32 flag (1 = valid sample, 0 = empty) + float64 value
 * The file is pre-allocated, so only the first `DataCacheDataSize` records are used.
 * Time values are usually not stored: IndependentStorageElement StorageType="1"
 * gives start + i * interval.
 */
(function (global) {
  'use strict';

  // Capstone unit codes (BaseUnit attribute) seen in real files.
  const UNIT_CODES = {
    256: 's',
    1280: 'm',
    2048: 'm/s²',
    2304: 'm/s',
    3330: 'C',
    10496: 'kg',
  };

  function unitOf(el) {
    const custom = el.getAttribute('CustomUnitString');
    if (custom) return custom;
    const code = Number(el.getAttribute('BaseUnit'));
    return UNIT_CODES[code] || '';
  }

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

  function childrenByTag(el, tag) {
    const out = [];
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === tag) out.push(c);
    return out;
  }

  function firstChild(el, tag) {
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

  /** Decode `count` samples from a Capstone data file. Invalid samples become NaN. */
  function decodeSamples(bytes, count, warnings, name) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Standard layout: 12-byte records (uint32 flag + float64).
    if (bytes.length >= count * 12) {
      let ok = true;
      for (let i = 0; i < count; i++) {
        const f = dv.getUint32(i * 12, true);
        if (f > 1) { ok = false; break; }
      }
      if (ok) {
        const out = new Float64Array(count);
        for (let i = 0; i < count; i++) {
          out[i] = dv.getUint32(i * 12, true) ? dv.getFloat64(i * 12 + 4, true) : NaN;
        }
        return out;
      }
    }
    // Fallback: plain float64 array.
    if (bytes.length >= count * 8) {
      warnings.push(name + ': 알 수 없는 데이터 형식이라 float64 배열로 해석했습니다.');
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) out[i] = dv.getFloat64(i * 8, true);
      return out;
    }
    warnings.push(name + ': 데이터 파일이 예상보다 작습니다.');
    const n = Math.floor(bytes.length / 12);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 12, true) ? dv.getFloat64(i * 12 + 4, true) : NaN;
    return out;
  }

  async function readStorage(zip, el, count, warnings, label) {
    const type = attr(el, 'StorageType', '');
    if (type === '1') {
      const start = num(el, 'IntervalCacheStartValue', 0);
      const step = num(el, 'IntervalCacheInterval', 1);
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) out[i] = roundTime(start + i * step);
      return out;
    }
    const fileName = attr(el, 'FileName', '');
    if (fileName) {
      const entry = zip.get(fileName);
      if (!entry) {
        warnings.push(label + ': 데이터 파일 ' + fileName + ' 이(가) 없습니다.');
        return null;
      }
      return decodeSamples(await zip.read(entry), count, warnings, label);
    }
    return null;
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

  function parseRuns(doc) {
    const runs = new Map();
    for (const set of doc.getElementsByTagName('RunParameterSet')) {
      const id = attr(set, 'RunParameterID', '');
      const run = { id, number: NaN, name: '', start: null, stop: null, comment: '', periods: [] };
      for (const pv of childrenByTag(set, 'ParameterValue')) {
        if (pv.hasAttribute('RunNumber')) run.number = Number(pv.getAttribute('RunNumber'));
        if (pv.hasAttribute('RunName')) run.name = pv.getAttribute('RunName');
        if (pv.hasAttribute('RunStartTime')) run.start = Number(pv.getAttribute('RunStartTime'));
        if (pv.hasAttribute('RunStopTime')) run.stop = Number(pv.getAttribute('RunStopTime'));
        if (pv.hasAttribute('RunComment')) run.comment = pv.getAttribute('RunComment');
        for (const sr of childrenByTag(pv, 'SampleRates')) {
          const p = num(sr, 'Period', NaN);
          if (Number.isFinite(p)) run.periods.push(p);
        }
      }
      runs.set(id, run);
    }
    return runs;
  }

  function parseSensors(doc) {
    const sensors = [];
    for (const s of doc.getElementsByTagName('Sensor')) {
      const meas = [];
      for (const m of childrenByTag(s, 'Measurement')) {
        const n = attr(m, 'Name', '');
        if (n && !/^[?!]/.test(n) && !m.hasAttribute('Value')) meas.push(n);
      }
      sensors.push({ name: attr(s, 'Name', '센서'), period: num(s, 'SamplePeriod', NaN), measurements: meas });
    }
    return sensors;
  }

  function parseGraphDefaults(doc) {
    const graph = doc.getElementsByTagName('CSLineGraph')[0];
    if (!graph) return null;
    const res = { yMeasId: null, xMeasId: null, runIds: [] };
    const sel = graph.getElementsByTagName('ZRSNonDataSelectorProvidedInputs')[0];
    if (sel) res.yMeasId = attr(sel, 'EUID', null);
    for (const r of graph.getElementsByTagName('ZRSIndividualRenederer')) {
      const props = firstChild(r, 'ZTwoDimensionDataRenderBasicProperties');
      const inputs = childrenByTag(r, 'BundleInput');
      for (const b of inputs) {
        const idx = attr(b, 'BundleIndex', '');
        if (idx === '0' && !res.xMeasId) res.xMeasId = attr(b, 'BundleMeasID', null);
        if (idx === '1' && !res.yMeasId) res.yMeasId = attr(b, 'BundleMeasID', null);
      }
      if (props && attr(props, 'ZTDDRBPActive', '0') === '1' && inputs[0]) {
        res.runIds.push(attr(inputs[0], 'BundleDataSetID', ''));
      }
    }
    return res;
  }

  async function parseCap(file, onProgress) {
    const progress = onProgress || function () {};
    const warnings = [];
    progress('ZIP 읽는 중…', 0);
    const zip = await global.CapZip.ZipReader.open(file);
    const mainEntry = zip.get('main.xml') || zip.entries.find((e) => /(^|\/)main\.xml$/i.test(e.name));
    if (!mainEntry) throw new Error('main.xml 이 없습니다. PASCO Capstone .cap 파일이 맞는지 확인하세요.');

    progress('실험 정보 읽는 중…', 0.05);
    const xmlText = decodeText(await zip.read(mainEntry));
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('main.xml 을 해석할 수 없습니다 (XML 오류).');

    const root = doc.documentElement;
    const header = doc.getElementsByTagName('Header')[0];
    const runsById = parseRuns(doc);
    const sensors = parseSensors(doc);

    const timeEl = doc.getElementsByTagName('MasterTimeMeasurement')[0];
    const time = {
      id: timeEl ? attr(timeEl, 'EUID', 'time') : 'time',
      name: timeEl ? attr(timeEl, 'MeasurementName', 'Time') : 'Time',
      unit: timeEl ? unitOf(timeEl) || 's' : 's',
      decimals: 3,
    };
    if (time.name === 'Time') time.label = '시간';

    // Every element that owns <DataSet> children is a measurement with recorded data.
    const owners = [];
    const seen = new Set();
    for (const ds of doc.getElementsByTagName('DataSet')) {
      const p = ds.parentElement;
      if (p && !seen.has(p)) { seen.add(p); owners.push(p); }
    }

    let totalSets = 0;
    for (const o of owners) totalSets += childrenByTag(o, 'DataSet').length;
    let doneSets = 0;

    const measurements = [];
    const runData = new Map(); // runId -> Map(measId -> {t, v})

    for (const el of owners) {
      const fmt = firstChild(el, 'DataSourceNumberFormatter');
      const name = attr(el, 'MeasurementName', '') || attr(el, 'LongName', '') || attr(el, 'ShortName', '') || '측정값';
      const meas = {
        id: attr(el, 'EUID', 'm' + measurements.length),
        name,
        longName: attr(el, 'LongName', name),
        symbol: attr(el, 'SymbolName', ''),
        unit: unitOf(el),
        unitCode: num(el, 'BaseUnit', null),
        decimals: num(fmt, 'FixedDecimals', 3),
        sensor: attr(el, 'ChannelIDName', ''),
        runCount: 0,
      };
      measurements.push(meas);

      for (const ds of childrenByTag(el, 'DataSet')) {
        doneSets++;
        if (attr(ds, 'DataHasBeenDeleted', 'FALSE') === 'TRUE') continue;
        const runId = attr(ds, 'DataSetID', '');
        const tParts = [];
        const vParts = [];
        for (const seg of childrenByTag(ds, 'DataSegmentElement')) {
          const dep = firstChild(seg, 'DependentStorageElement');
          const ind = firstChild(seg, 'IndependentStorageElement');
          if (!dep) continue;
          const count = num(dep, 'DataCacheDataSize', num(ind, 'CacheDataCount', 0));
          if (!count) continue;
          const label = name + ' (' + (runsById.get(runId) ? '런 ' + runsById.get(runId).number : runId) + ')';
          const v = await readStorage(zip, dep, count, warnings, label);
          if (!v) continue;
          let t = ind ? await readStorage(zip, ind, v.length, warnings, label + ' 시간') : null;
          if (!t || t.length !== v.length) {
            t = new Float64Array(v.length);
            for (let i = 0; i < v.length; i++) t[i] = i;
          }
          tParts.push(t);
          vParts.push(v);
        }
        if (!vParts.length) continue;
        if (!runData.has(runId)) runData.set(runId, new Map());
        runData.get(runId).set(meas.id, { t: concat(tParts), v: concat(vParts) });
        meas.runCount++;
        if (doneSets % 8 === 0) progress('데이터 읽는 중… (' + doneSets + '/' + totalSets + ')', 0.1 + 0.9 * (doneSets / totalSets));
      }
    }

    const usedMeasurements = measurements.filter((m) => m.runCount > 0);

    const runs = [];
    let fallbackNo = 0;
    for (const [runId, data] of runData) {
      const info = runsById.get(runId) || { id: runId, number: NaN, name: '', start: null, stop: null, comment: '', periods: [] };
      const number = Number.isFinite(info.number) && info.number < 1e9 ? info.number : 100000 + fallbackNo++;
      let points = 0;
      let duration = 0;
      for (const d of data.values()) {
        points = Math.max(points, d.v.length);
        if (d.t.length) duration = Math.max(duration, d.t[d.t.length - 1]);
      }
      runs.push({
        id: runId,
        number,
        name: info.name || (number < 100000 ? '런 #' + number : '런'),
        rawName: info.name,
        start: info.start ? new Date(info.start * 1000) : null,
        stop: info.stop ? new Date(info.stop * 1000) : null,
        comment: info.comment,
        periods: info.periods,
        points,
        duration,
        data,
      });
    }
    runs.sort((a, b) => a.number - b.number);

    const defaults = parseGraphDefaults(doc);

    progress('완료', 1);
    return {
      fileName: file.name || '',
      fileSize: file.size,
      rootTag: root.tagName,
      version: attr(header, 'Version', ''),
      sensors,
      time,
      measurements: usedMeasurements,
      runs,
      defaults,
      warnings,
    };
  }

  /**
   * Pair two measurements of one run by their time stamps.
   * xMeasId may be the time measurement id.
   */
  function seriesFor(cap, run, xMeasId, yMeasId) {
    const y = run.data.get(yMeasId);
    if (!y) return null;
    if (xMeasId === cap.time.id) return { x: y.t, y: y.v };
    const x = run.data.get(xMeasId);
    if (!x) return null;
    const map = new Map();
    for (let i = 0; i < x.t.length; i++) map.set(Math.round(x.t[i] * 1e6), x.v[i]);
    const xs = [];
    const ys = [];
    for (let i = 0; i < y.t.length; i++) {
      const xv = map.get(Math.round(y.t[i] * 1e6));
      if (xv !== undefined) { xs.push(xv); ys.push(y.v[i]); }
    }
    return { x: Float64Array.from(xs), y: Float64Array.from(ys) };
  }

  /** Merge all measurements of a run into rows keyed by time. */
  function tableFor(cap, run) {
    const cols = cap.measurements.filter((m) => run.data.has(m.id));
    const rows = new Map();
    cols.forEach((m, ci) => {
      const d = run.data.get(m.id);
      for (let i = 0; i < d.t.length; i++) {
        const key = Math.round(d.t[i] * 1e6);
        let row = rows.get(key);
        if (!row) {
          row = { t: d.t[i], vals: new Array(cols.length).fill(NaN) };
          rows.set(key, row);
        }
        row.vals[ci] = d.v[i];
      }
    });
    const list = Array.from(rows.values()).sort((a, b) => a.t - b.t);
    return { cols, rows: list };
  }

  global.CapParser = { parseCap, seriesFor, tableFor, UNIT_CODES };
})(typeof window !== 'undefined' ? window : globalThis);
