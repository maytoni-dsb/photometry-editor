/**
 * Пересчёт фотометрии типа B в тип C.
 *
 * Соглашение (проверить на сверке с DIALux / Viso, см. docs/decisions.md):
 *   - ось прибора (H = 0, V = 0) направляется в надир (γ = 0);
 *   - полярная ось системы B — горизонтальная ось C90–C270;
 *   - +V наклоняет направление к C0, +H — к C90.
 * Направление (H, V):  d = (cosH·sinV, sinH, −cosH·cosV)  в осях X = C0, Y = C90, Z = вверх.
 * Направление (C, γ):  d = (sinγ·cosC, sinγ·sinC, −cosγ).
 */

import { locate } from './angles';
import { issue, type Issue } from './issues';
import { clonePhotometry, type Photometry } from './model';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Сила света типа B в точке (H, V) с билинейной интерполяцией. Вне диапазона — 0. */
export function intensityB(p: Photometry, h: number, v: number): number {
  let hh = h;
  if (p.symmetry === 'bilateral') hh = Math.abs(h);
  if (p.hAngles.length === 1) hh = p.hAngles[0];
  const lh = locate(p.hAngles, hh);
  const lv = locate(p.vAngles, v);
  if (!lh || !lv) return 0;
  const row = (i: number) => {
    const r = p.candela[i];
    return lv.t === 0 ? r[lv.i] : r[lv.i] * (1 - lv.t) + r[lv.i + 1] * lv.t;
  };
  if (p.hAngles.length === 1 || lh.t === 0) return row(lh.i);
  return row(lh.i) * (1 - lh.t) + row(lh.i + 1) * lh.t;
}

/** Углы (H, V) типа B для направления (C, γ). V в диапазоне (−180, 180]. */
export function cgToHV(c: number, g: number): { h: number; v: number } {
  const sg = Math.sin(g * RAD);
  const x = sg * Math.cos(c * RAD);
  const y = sg * Math.sin(c * RAD);
  const z = -Math.cos(g * RAD);
  const h = Math.asin(Math.max(-1, Math.min(1, y))) * DEG;
  const v = Math.atan2(x, -z) * DEG;
  return { h, v };
}

export interface TypeBToCOptions {
  cStep?: number;
  gStep?: number;
}

export function typeBToC(p: Photometry, opts: TypeBToCOptions = {}): { photometry: Photometry; issues: Issue[] } {
  if (p.photometryType !== 'B') throw new Error('typeBToC: нужна фотометрия типа B');
  const cStep = opts.cStep ?? 5;
  const gStep = opts.gStep ?? 2.5;
  const issues: Issue[] = [];

  // свет на границе измеренной области
  let max = 0;
  let edge = 0;
  const nh = p.hAngles.length;
  const nv = p.vAngles.length;
  p.candela.forEach((row, i) =>
    row.forEach((x, j) => {
      max = Math.max(max, x);
      const onEdge = j === 0 || j === nv - 1 || ((i === nh - 1 || (i === 0 && p.symmetry !== 'bilateral')) && nh > 1);
      if (onEdge) edge = Math.max(edge, x);
    }),
  );
  if (max > 0 && edge / max > 0.01) {
    issues.push(issue('typeb-light-outside', 'warning', { percent: Math.round((edge / max) * 1000) / 10 }));
  }

  const hAngles: number[] = [];
  for (let c = 0; c < 360 - 1e-9; c += cStep) hAngles.push(Math.round(c * 1e6) / 1e6);
  const vAngles: number[] = [];
  for (let g = 0; g <= 180 + 1e-9; g += gStep) vAngles.push(Math.round(g * 1e6) / 1e6);
  const candela = hAngles.map((c) =>
    vAngles.map((g) => {
      const { h, v } = cgToHV(c, g);
      return intensityB(p, h, v);
    }),
  );
  const out = clonePhotometry(p);
  out.photometryType = 'C';
  out.symmetry = 'none';
  out.hAngles = hAngles;
  out.vAngles = vAngles;
  out.candela = candela;
  issues.push(issue('converted-type-b', 'info', { cStep, gStep }));
  return { photometry: out, issues };
}
