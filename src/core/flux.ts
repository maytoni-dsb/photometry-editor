/**
 * Расчёт светового потока интегрированием по сфере (тип C).
 * Каждой точке сетки приписывается телесный угол её зоны: по γ — между
 * серединами соседних интервалов, по C — половина промежутков до соседних плоскостей.
 */

import { fullPlanes } from './angles';
import type { Photometry } from './model';

const RAD = Math.PI / 180;

/** Веса по γ: ∫ sinγ dγ по зоне каждой точки (в стерадианах на радиан по C). */
export function gammaWeights(g: number[]): number[] {
  const n = g.length;
  if (n === 1) return [0];
  return g.map((_, j) => {
    const lo = j === 0 ? g[0] : (g[j - 1] + g[j]) / 2;
    const hi = j === n - 1 ? g[n - 1] : (g[j] + g[j + 1]) / 2;
    return Math.cos(lo * RAD) - Math.cos(hi * RAD);
  });
}

export interface FluxResult {
  /** Полный поток, лм. */
  total: number;
  /** Поток в нижнюю полусферу (γ < 90°), лм. */
  down: number;
  /** Поток в верхнюю полусферу, лм. */
  up: number;
}

/** Поток фотометрии типа C. Для типа B сначала пересчитайте в C (typeBToC). */
export function computeFlux(p: Photometry): FluxResult {
  if (p.photometryType !== 'C') throw new Error('computeFlux: нужна фотометрия типа C');
  const g = p.vAngles;
  const planes = fullPlanes(p);
  const n = planes.length;
  // веса по C (в радианах), сумма = 2π
  const cw = planes.map((pl, i) => {
    if (n === 1) return 2 * Math.PI;
    const prev = i === 0 ? planes[n - 1].c - 360 : planes[i - 1].c;
    const next = i === n - 1 ? planes[0].c + 360 : planes[i + 1].c;
    return ((next - prev) / 2) * RAD;
  });
  let down = 0;
  let up = 0;
  // делим вес зоны, пересекающей 90°, пропорционально
  const n1 = g.length;
  for (let j = 0; j < n1; j++) {
    const lo = j === 0 ? g[0] : (g[j - 1] + g[j]) / 2;
    const hi = j === n1 - 1 ? g[n1 - 1] : (g[j] + g[j + 1]) / 2;
    const wTotal = Math.cos(lo * RAD) - Math.cos(hi * RAD);
    let wDown = 0;
    if (hi <= 90) wDown = wTotal;
    else if (lo < 90) wDown = Math.cos(lo * RAD) - Math.cos(90 * RAD);
    const wUp = wTotal - wDown;
    let s = 0;
    for (let i = 0; i < n; i++) s += planes[i].values[j] * cw[i];
    down += s * wDown;
    up += s * wUp;
  }
  return { total: down + up, down, up };
}
