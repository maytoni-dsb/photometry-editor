/**
 * Чтение и запись EULUMDAT (.ldt).
 *
 * Хранимые плоскости по Isym (спецификация EULUMDAT, индексы mc1…mc2):
 *   0 — все Mc;  1 — одна;  2 — C0…C180;  3 — C270…C0…C90;  4 — C0…C90.
 * Isym 3 при чтении отражается в C90…C270 (I(C) = I(180° − C)), чтобы модель
 * хранила возрастающие углы, и при записи отражается обратно.
 */

import { intensityC, uniformStep } from './angles';
import { computeFlux } from './flux';
import { issue, type Issue } from './issues';
import {
  emptyDimensions,
  emptyMetadata,
  type Dimensions,
  type LampSet,
  type ParseResult,
  type Photometry,
  type Symmetry,
} from './model';
import { decodeBytes, fmt, fmtFixed, fmtSig, parseNum, splitLines, tokenize } from './text';

const ISYM_TO_SYM: Record<number, Symmetry> = { 0: 'none', 1: 'axial', 2: 'c0c180', 3: 'c90c270', 4: 'quadrant' };

function dimsFromLdt(length: number, width: number, height: number): Dimensions {
  if (length === 0 && width === 0 && height === 0) return emptyDimensions();
  if (width === 0) return { shape: 'circle', length, width: 0, height };
  return { shape: 'rect', length, width, height };
}

export function parseLDT(input: string | Uint8Array, fileName = ''): ParseResult {
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
  const L = splitLines(text).map((l) => l.trim());
  if (L.every((l) => l === '')) throw new Error('empty-file');
  if (L.length < 26) throw new Error('header-incomplete: LDT header');

  const num = (i: number, where: string): number => {
    const n = parseNum(L[i] ?? '');
    if (Number.isNaN(n)) {
      issues.push(issue('bad-number', 'error', { value: L[i] ?? '', where }));
      return 0;
    }
    return n;
  };

  const ityp = num(1, 'Ityp');
  let isym = num(2, 'Isym');
  const mc = Math.round(num(3, 'Mc'));
  const ng = Math.round(num(5, 'Ng'));
  if (![0, 1, 2, 3].includes(ityp)) issues.push(issue('ldt-ityp-invalid', 'warning', { value: ityp }));
  if (![0, 1, 2, 3, 4].includes(isym)) {
    issues.push(issue('ldt-isym-invalid', 'error', { value: isym }));
    isym = 0;
  }

  const n = Math.max(0, Math.round(num(25, 'n')));
  const lamps: LampSet[] = [];
  for (let s = 0; s < n; s++) {
    const b = 26 + 6 * s;
    const count = num(b, 'lamps');
    const fluxRaw = num(b + 2, 'flux');
    lamps.push({
      count,
      flux: Math.abs(fluxRaw),
      type: L[b + 1] ?? '',
      cct: L[b + 3] ?? '',
      cri: L[b + 4] ?? '',
      watts: Number.isNaN(parseNum(L[b + 5] ?? '')) ? null : parseNum(L[b + 5]),
    });
  }
  const absolute = lamps.some((s) => s.count < 0);
  if (lamps.some((s) => s.count === 0)) issues.push(issue('lamp-count-zero', 'warning'));
  // Силы света в LDT относятся к первому комплекту ламп; остальные — альтернативные лампы.
  const totalFlux = lamps[0]?.flux ?? 0;

  const tailStart = 26 + 6 * n;
  const tail: number[] = [];
  for (const tok of tokenize(L.slice(tailStart).join('\n'))) {
    const v = parseNum(tok);
    if (Number.isNaN(v)) issues.push(issue('bad-number', 'error', { value: tok, where: 'LDT data' }));
    else tail.push(v);
  }
  if (tail.length < 10 + mc + ng) throw new Error('header-incomplete: LDT angles');
  const directRatios = tail.slice(0, 10);
  const cList = tail.slice(10, 10 + mc);
  const gList = tail.slice(10 + mc, 10 + mc + ng);
  const data = tail.slice(10 + mc + ng);

  // какие плоскости хранятся
  let idx: number[];
  switch (isym) {
    case 1:
      idx = [0];
      break;
    case 2:
      idx = range(0, mc / 2);
      break;
    case 3: {
      const s = (3 * mc) / 4;
      idx = range(0, mc / 2).map((k) => (s + k) % mc);
      break;
    }
    case 4:
      idx = range(0, mc / 4);
      break;
    default:
      idx = range(0, mc - 1);
  }
  let symmetry: Symmetry = ISYM_TO_SYM[isym];
  if (isym !== 0 && idx.length < mc && data.length >= mc * ng && mc > 1) {
    issues.push(issue('isym-all-planes', 'warning', { isym, planes: mc }));
    idx = range(0, mc - 1);
    symmetry = 'none';
  }
  if (isym === 0 && mc === 1) {
    issues.push(issue('isym-single-plane', 'warning'));
    symmetry = 'axial';
  }

  const expected = idx.length * ng;
  if (data.length < expected) {
    issues.push(issue('value-count-short', 'error', { found: data.length, expected }));
    while (data.length < expected) data.push(0);
  } else if (data.length > expected) {
    issues.push(issue('value-count-long', 'warning', { found: data.length, expected }));
  }

  const cf = num(23, 'conversion factor') || 1;
  if (cf !== 1) issues.push(issue('ldt-conversion-factor', 'info', { value: cf }));
  const scale = (cf * totalFlux) / 1000;
  let planes = idx.map((ci, k) => ({
    c: symmetry === 'axial' ? 0 : (cList[ci] ?? 0),
    values: data.slice(k * ng, (k + 1) * ng).map((v) => v * scale),
  }));
  if (symmetry === 'c90c270') {
    planes = planes.map((pl) => ({ c: (((180 - pl.c) % 360) + 360) % 360, values: pl.values }));
    planes.sort((a, b) => a.c - b.c);
  }

  for (let i = 1; i < gList.length; i++) {
    if (gList[i] <= gList[i - 1]) {
      issues.push(issue('angles-not-ascending', 'error', { axis: 'γ' }));
      break;
    }
  }

  const meta = emptyMetadata();
  meta.manufacturer = L[0];
  meta.testReport = L[7] ?? '';
  meta.luminaireName = L[8] ?? '';
  meta.article = L[9] ?? '';
  meta.date = L[11] ?? '';

  const watts = lamps[0]?.watts ?? 0;
  const p: Photometry = {
    photometryType: 'C',
    symmetry,
    hAngles: planes.map((pl) => pl.c),
    vAngles: gList,
    candela: planes.map((pl) => pl.values),
    absolute,
    lamps,
    inputWatts: lamps.length ? watts : null,
    luminaire: dimsFromLdt(num(12, 'L'), num(13, 'B'), num(14, 'H')),
    luminous: dimsFromLdt(num(15, 'La'), num(16, 'B1'), num(17, 'HC0')),
    meta,
    ldt: {
      ityp,
      luminousHeights: [num(17, 'HC0'), num(18, 'HC90'), num(19, 'HC180'), num(20, 'HC270')],
      dff: num(21, 'DFF'),
      lorl: num(22, 'LORL'),
      conversionFactor: cf,
      measurementTilt: num(24, 'tilt'),
      directRatios,
      fileNameField: L[10] ?? '',
      dateUser: L[11] ?? '',
    },
    source: { format: 'LDT', fileName: fileName.replace(/^.*[\\/]/, ''), encoding, lineEnding },
  };
  return { photometry: p, issues };
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

// ---------------------------------------------------------------- запись

const SYM_TO_ISYM: Record<Symmetry, number> = { none: 0, axial: 1, c0c180: 2, c90c270: 3, quadrant: 4, bilateral: 0 };

export interface WriteLdtOptions {
  lineEnding?: 'LF' | 'CRLF';
  /** Значение строки 11 (имя файла). */
  fileName?: string;
}

export interface WriteLdtResult {
  text: string;
  issues: Issue[];
}

/** Подбирает равномерный шаг C, делящий 360° нацело. */
function pickCStep(p: Photometry): { step: number; resampled: boolean } {
  const h = p.hAngles.filter((c) => c < 360 - 1e-6);
  const u = uniformStep(h.length > 1 ? h : p.hAngles);
  if (u > 0 && Math.abs(360 / u - Math.round(360 / u)) < 1e-6) return { step: u, resampled: false };
  let min = 360;
  for (let i = 1; i < p.hAngles.length; i++) min = Math.min(min, p.hAngles[i] - p.hAngles[i - 1]);
  const step = 360 / Math.ceil(360 / Math.max(min, 0.5));
  return { step, resampled: true };
}

export function writeLDT(p: Photometry, opts: WriteLdtOptions = {}): WriteLdtResult {
  if (p.photometryType !== 'C') throw new Error('writeLDT: нужна фотометрия типа C (используйте typeBToC)');
  const issues: Issue[] = [];
  const nl = (opts.lineEnding ?? 'CRLF') === 'CRLF' ? '\r\n' : '\n';
  const sym = p.symmetry === 'bilateral' ? 'none' : p.symmetry;
  const isym = SYM_TO_ISYM[sym];

  // полный круг C
  let mc: number;
  let dc: number;
  let cFull: number[];
  if (sym === 'axial' || p.hAngles.length === 1) {
    mc = 1;
    dc = 0;
    cFull = [0];
  } else {
    const { step, resampled } = pickCStep(p);
    if (resampled) issues.push(issue('resampled-c-planes', 'info', { step: fmt(step, 3) }));
    dc = step;
    mc = Math.round(360 / step);
    cFull = Array.from({ length: mc }, (_, i) => Math.round(i * step * 1e6) / 1e6);
  }
  let stored: number[];
  switch (isym) {
    case 1:
      stored = [0];
      break;
    case 2:
      stored = cFull.slice(0, mc / 2 + 1);
      break;
    case 3: {
      const s = (3 * mc) / 4;
      stored = range(0, mc / 2).map((k) => cFull[(s + k) % mc]);
      break;
    }
    case 4:
      stored = cFull.slice(0, mc / 4 + 1);
      break;
    default:
      stored = cFull;
  }

  // потоки
  const flux = computeFlux({ ...p, symmetry: sym });
  const lampsIn = p.lamps.length ? p.lamps : [{ count: 1, flux: null, type: '', cct: '', cri: '', watts: p.inputWatts }];
  let lampFlux: number;
  const sets = lampsIn.map((s) => ({ ...s }));
  if (p.absolute) {
    lampFlux = sets[0].flux && sets[0].flux > 0 ? sets[0].flux : flux.total;
    sets[0].count = -1;
    sets[0].flux = lampFlux;
    for (let i = 1; i < sets.length; i++) sets[i].flux = 0;
  } else {
    lampFlux = sets[0].flux ?? 0;
    if (!(lampFlux > 0)) {
      lampFlux = flux.total;
      sets[0].flux = lampFlux;
    }
  }
  const toRel = lampFlux > 0 ? 1000 / lampFlux : 1;
  const dff = flux.total > 0 ? (flux.down / flux.total) * 100 : 0;
  const lorl = p.absolute ? 100 : lampFlux > 0 ? (flux.total / lampFlux) * 100 : 100;

  const ityp0 = p.ldt?.ityp;
  const ityp = ityp0 != null && [0, 1, 2, 3].includes(ityp0) ? ityp0 : sym === 'axial' ? 1 : 3;
  const gStep = uniformStep(p.vAngles);
  const lum = p.luminous;
  const lumr = p.luminaire;
  const heights = p.ldt?.luminousHeights ?? [lum.height, lum.height, lum.height, lum.height];
  const fileField =
    opts.fileName ?? (p.source.format === 'LDT' && p.ldt ? p.ldt.fileNameField : p.source.fileName.replace(/\.[^.]*$/, '') + (p.source.fileName ? '.ldt' : ''));

  const lines: string[] = [
    p.meta.manufacturer,
    String(ityp),
    String(isym),
    String(mc),
    fmt(dc, 3),
    String(p.vAngles.length),
    fmt(gStep, 3),
    p.meta.testReport,
    p.meta.luminaireName,
    p.meta.article,
    fileField,
    p.ldt?.dateUser ?? p.meta.date,
    fmt(lumr.length, 1),
    fmt(lumr.shape === 'circle' ? 0 : lumr.width, 1),
    fmt(lumr.height, 1),
    fmt(lum.length, 1),
    fmt(lum.shape === 'circle' ? 0 : lum.width, 1),
    ...heights.map((x) => fmt(x, 1)),
    fmtFixed(dff, 1),
    fmtFixed(lorl, 1),
    '1.000',
    fmtFixed(p.ldt?.measurementTilt ?? 0, 1),
    String(sets.length),
  ];
  for (const s of sets) {
    lines.push(
      String(Math.round(s.count)),
      s.type,
      fmt(s.flux ?? 0, 2),
      s.cct,
      s.cri,
      s.watts == null ? '' : fmt(s.watts, 2),
    );
  }
  const dr = p.ldt?.directRatios ?? [];
  for (let i = 0; i < 10; i++) lines.push(fmtFixed(dr[i] ?? 0, 3));
  for (const c of cFull) lines.push(fmtFixed(c, 1));
  for (const g of p.vAngles) lines.push(fmtFixed(g, 1));
  const model = { ...p, symmetry: sym };
  for (const c of stored) {
    for (const g of p.vAngles) lines.push(fmtSig(intensityC(model, c, g) * toRel));
  }
  return { text: lines.join(nl) + nl, issues };
}
