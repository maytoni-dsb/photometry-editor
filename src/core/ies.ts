/**
 * Чтение и запись IES (ANSI/IES LM-63: 1986, 1991, 1995, 2002, 2019).
 * Чтение терпимое (нарушения стандарта превращаются в замечания),
 * запись строгая (LM-63-2002).
 */

import { symmetryFromIesHorizontal } from './angles';
import { issue, type Issue } from './issues';
import {
  emptyDimensions,
  emptyMetadata,
  type Dimensions,
  type ParseResult,
  type Photometry,
  type Symmetry,
} from './model';
import { decodeBytes, fmt, fmtSig, splitLines, tokenize } from './text';

const KNOWN: Record<string, keyof Photometry['meta']> = {
  MANUFAC: 'manufacturer',
  LUMINAIRE: 'luminaireName',
  LUMCAT: 'article',
  TEST: 'testReport',
  TESTLAB: 'testLab',
  DATE: 'date',
  ISSUEDATE: 'issueDate',
  LAMPCAT: 'lampCatalog',
};

const CCT_KEYS = ['_SEARCH_COLORTEMP', 'COLORTEMP', '_COLORTEMP', 'CCT'];
const CRI_KEYS = ['_SEARCH_CRI', 'CRI', '_CRI'];

function dimsFromIes(width: number, length: number, height: number, toMm: number): Dimensions {
  const w = width * toMm;
  const l = length * toMm;
  const h = Math.abs(height * toMm);
  if (w === 0 && l === 0 && h === 0) return emptyDimensions();
  if (w < 0 || l < 0) {
    const d = Math.max(Math.abs(w), Math.abs(l));
    return { shape: 'circle', length: d, width: 0, height: h };
  }
  return { shape: 'rect', length: l, width: w, height: h };
}

export function parseIES(input: string | Uint8Array, fileName = ''): ParseResult {
  const issues: Issue[] = [];
  let text: string;
  let encoding = 'utf-8';
  let lineEnding: 'LF' | 'CRLF' = 'LF';
  if (typeof input === 'string') {
    text = input;
    lineEnding = text.includes('\r\n') ? 'CRLF' : 'LF';
  } else {
    const d = decodeBytes(input);
    text = d.text;
    encoding = d.encoding;
    lineEnding = d.lineEnding;
    if (d.encoding !== 'utf-8') issues.push(issue('encoding-fallback', 'info'));
  }
  const lines = splitLines(text);
  if (lines.every((l) => l.trim() === '')) throw new Error('empty-file');

  let idx = 0;
  let versionLine = '';
  const first = lines[0].trim();
  if (/^IES(NA)?[:\s]?/i.test(first) && /LM-?63|IESNA|IES:/i.test(first)) {
    versionLine = first;
    idx = 1;
  } else if (/^IESNA91/i.test(first)) {
    versionLine = first;
    idx = 1;
  } else {
    issues.push(issue('ies-no-version', 'info'));
  }

  const meta = emptyMetadata();
  const seen = new Set<string>();
  let tiltLine = -1;
  for (; idx < lines.length; idx++) {
    const raw = lines[idx];
    const t = raw.trim();
    if (/^TILT\s*=/i.test(t)) {
      tiltLine = idx;
      break;
    }
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(t);
    if (m) {
      const key = m[1].trim().toUpperCase();
      const value = m[2].trim();
      if (seen.has(key) && key !== 'MORE') issues.push(issue('ies-duplicate-keyword', 'warning', { keyword: key }));
      const field = KNOWN[key];
      if (field && !seen.has(key)) (meta[field] as string) = value;
      seen.add(key);
      meta.keywords.push([key, value]);
    } else if (t !== '') {
      meta.keywords.push(['', t]); // свободный текст (LM-63-1986)
    }
  }
  if (tiltLine < 0) throw new Error('header-incomplete: TILT');

  const tiltValue = lines[tiltLine].trim().replace(/^TILT\s*=\s*/i, '');
  const tokens = tokenize(lines.slice(tiltLine + 1).join('\n'));
  const nums: number[] = [];
  for (const tok of tokens) {
    const n = Number(tok);
    if (Number.isFinite(n)) nums.push(n);
    else issues.push(issue('bad-number', 'error', { value: tok, where: 'IES' }));
  }
  let k = 0;
  const take = (count: number, where: string): number[] => {
    if (k + count > nums.length) throw new Error(`header-incomplete: ${where}`);
    const r = nums.slice(k, k + count);
    k += count;
    return r;
  };

  let tiltData: { geometry: number; angles: number[]; factors: number[] } | undefined;
  if (/^INCLUDE$/i.test(tiltValue)) {
    const [geometry, n] = take(2, 'TILT');
    const angles = take(n, 'TILT angles');
    const factors = take(n, 'TILT factors');
    tiltData = { geometry, angles, factors };
    issues.push(issue('ies-tilt-include', 'info'));
  } else if (!/^NONE$/i.test(tiltValue)) {
    issues.push(issue('ies-tilt-file', 'warning', { file: tiltValue }));
  }

  const [nLamps, lumens, multiplier, nvRaw, nhRaw, ptype, units, width, length, height] = take(10, 'line 10');
  const [ballastFactor, fileGenerationType, inputWatts] = take(3, 'ballast line');
  const nv = Math.round(nvRaw);
  const nh = Math.round(nhRaw);
  const vAngles = take(nv, 'vertical angles');
  const hAngles = take(nh, 'horizontal angles');
  const expected = nv * nh;
  const available = nums.length - k;
  const values = nums.slice(k, k + expected);
  if (available < expected) {
    issues.push(issue('value-count-short', 'error', { found: available, expected }));
    while (values.length < expected) values.push(0);
  } else if (available > expected) {
    issues.push(issue('value-count-long', 'warning', { found: available, expected }));
  }

  for (const [axis, arr] of [
    ['V', vAngles],
    ['H', hAngles],
  ] as const) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1]) issues.push(issue('angles-duplicate', 'warning', { axis, value: arr[i] }));
      else if (arr[i] < arr[i - 1]) {
        issues.push(issue('angles-not-ascending', 'error', { axis }));
        break;
      }
    }
  }

  const mult = multiplier || 1;
  const candela: number[][] = [];
  for (let i = 0; i < nh; i++) candela.push(values.slice(i * nv, (i + 1) * nv).map((x) => x * mult));

  let photometryType: Photometry['photometryType'] = 'C';
  if (ptype === 2) photometryType = 'B';
  else if (ptype === 3) photometryType = 'A';
  else if (ptype !== 1) issues.push(issue('ies-unknown-type', 'error', { value: ptype }));

  let symmetry: Symmetry = 'none';
  if (photometryType === 'C') {
    const s = symmetryFromIesHorizontal(hAngles[0], hAngles[nh - 1], nh);
    if (s) symmetry = s;
    else issues.push(issue('ies-irregular-horizontal', 'warning', { first: hAngles[0], last: hAngles[nh - 1] }));
  } else if (nh > 1 && hAngles[0] >= 0) {
    symmetry = 'bilateral';
  } else if (nh === 1) {
    symmetry = 'axial';
  }

  if (multiplier !== 1) issues.push(issue('multiplier-not-one', 'info', { value: multiplier }));
  if (nLamps <= 0) issues.push(issue('lamp-count-zero', 'warning'));

  const toMm = units === 1 ? 304.8 : 1000;
  const absolute = lumens < 0;
  const kw = (keys: string[]) => meta.keywords.find(([key]) => keys.includes(key))?.[1] ?? '';
  const lampType = kw(['LAMP']);

  const p: Photometry = {
    photometryType,
    symmetry,
    hAngles,
    vAngles,
    candela,
    absolute,
    lamps: [
      {
        count: nLamps,
        flux: absolute ? null : lumens * Math.max(nLamps, 1),
        type: lampType,
        cct: kw(CCT_KEYS),
        cri: kw(CRI_KEYS),
        watts: inputWatts,
      },
    ],
    inputWatts,
    luminaire: emptyDimensions(),
    luminous: dimsFromIes(width, length, height, toMm),
    meta,
    ies: {
      versionLine,
      tilt: tiltValue,
      tiltData,
      multiplier,
      ballastFactor,
      fileGenerationType,
      units: units === 1 ? 1 : 2,
    },
    source: { format: 'IES', fileName: fileName.replace(/^.*[\\/]/, ''), encoding, lineEnding },
  };
  return { photometry: p, issues };
}

// ---------------------------------------------------------------- запись

export interface WriteIesOptions {
  /** Версия заголовка (пока только 2002). */
  version?: '2002';
  lineEnding?: 'LF' | 'CRLF';
  /** Сохранить нестандартные ключевые слова исходного файла (по умолчанию да). */
  keepCustomKeywords?: boolean;
}

/** Ширина строки значений: LM-63-2002 допускает до 256 символов. */
function wrapValues(values: string[], maxLen = 132): string[] {
  const out: string[] = [];
  let line = '';
  for (const v of values) {
    if (line.length + v.length + 1 > maxLen && line) {
      out.push(line);
      line = v;
    } else line = line ? `${line} ${v}` : v;
  }
  if (line) out.push(line);
  return out;
}

export function writeIES(p: Photometry, opts: WriteIesOptions = {}): string {
  const nl = opts.lineEnding === 'CRLF' ? '\r\n' : '\n';
  const keepCustom = opts.keepCustomKeywords ?? true;
  const out: string[] = ['IESNA:LM-63-2002'];

  // ключевые слова: известные — из модели, остальные — как были
  const fieldValue = (key: string): string | undefined => {
    const f = KNOWN[key];
    return f ? (p.meta[f] as string) : undefined;
  };
  const written = new Set<string>();
  const lamp = p.lamps[0];
  const kwOut: Array<[string, string]> = [];
  const pushKw = (key: string, value: string) => {
    kwOut.push([key, value]);
    written.add(key);
  };
  // обязательные в 2002
  pushKw('TEST', p.meta.testReport);
  if (p.meta.testLab) pushKw('TESTLAB', p.meta.testLab);
  if (p.meta.issueDate) pushKw('ISSUEDATE', p.meta.issueDate);
  pushKw('MANUFAC', p.meta.manufacturer);
  if (p.meta.luminaireName) pushKw('LUMINAIRE', p.meta.luminaireName);
  if (p.meta.article) pushKw('LUMCAT', p.meta.article);
  if (p.meta.lampCatalog) pushKw('LAMPCAT', p.meta.lampCatalog);
  if (p.meta.date) pushKw('DATE', p.meta.date);
  if (lamp?.type) pushKw('LAMP', lamp.type);
  for (const [key, value] of p.meta.keywords) {
    if (!key || written.has(key) || fieldValue(key) !== undefined || key === 'LAMP') continue;
    if (CCT_KEYS.includes(key) || CRI_KEYS.includes(key)) continue;
    if (key.startsWith('_') && !keepCustom) continue;
    kwOut.push([key, value]);
  }
  // цветовая температура и CRI — в нестандартных ключах, как в библиотеке заказчика
  const cctKey = p.meta.keywords.find(([k]) => CCT_KEYS.includes(k))?.[0] ?? '_SEARCH_COLORTEMP';
  const criKey = p.meta.keywords.find(([k]) => CRI_KEYS.includes(k))?.[0] ?? '_SEARCH_CRI';
  if (lamp?.cri) kwOut.push([criKey, lamp.cri]);
  if (lamp?.cct) kwOut.push([cctKey, lamp.cct]);
  for (const [k, v] of kwOut) out.push(v ? `[${k}] ${v}` : `[${k}]`);

  // TILT
  const tilt = p.ies?.tiltData;
  if (tilt) {
    out.push('TILT=INCLUDE');
    out.push(String(tilt.geometry));
    out.push(String(tilt.angles.length));
    out.push(...wrapValues(tilt.angles.map((x) => fmt(x))));
    out.push(...wrapValues(tilt.factors.map((x) => fmt(x))));
  } else out.push('TILT=NONE');

  // геометрия: всегда метры
  const lum = p.luminous;
  let w = lum.width / 1000;
  let l = lum.length / 1000;
  const h = lum.height / 1000;
  if (lum.shape === 'circle') {
    w = -lum.length / 1000;
    l = -lum.length / 1000;
  }

  let hAngles = p.hAngles;
  let candela = p.candela;
  if (p.photometryType === 'C' && p.symmetry === 'none' && hAngles.length > 1 && Math.abs(hAngles[hAngles.length - 1] - 360) > 1e-6) {
    hAngles = [...hAngles, 360];
    candela = [...candela, candela[0]];
  }

  const nLamps = lamp ? Math.max(1, Math.abs(Math.round(lamp.count)) || 1) : 1;
  const lumens = p.absolute || !lamp || lamp.flux == null ? -1 : lamp.flux / nLamps;
  const ptype = p.photometryType === 'C' ? 1 : p.photometryType === 'B' ? 2 : 3;
  const watts = p.inputWatts ?? lamp?.watts ?? 0;
  out.push(
    [nLamps, lumens === -1 ? '-1' : fmt(lumens, 3), '1', p.vAngles.length, hAngles.length, ptype, 2, fmt(w, 4), fmt(l, 4), fmt(h, 4)].join(' '),
  );
  out.push(`${fmt(p.ies?.ballastFactor ?? 1, 4)} ${fmt(p.ies?.fileGenerationType ?? 1, 5)} ${fmt(watts, 3)}`);
  out.push(...wrapValues(p.vAngles.map((x) => fmt(x))));
  out.push(...wrapValues(hAngles.map((x) => fmt(x))));
  for (const row of candela) out.push(...wrapValues(row.map((x) => fmtSig(x))));
  return out.join(nl) + nl;
}
