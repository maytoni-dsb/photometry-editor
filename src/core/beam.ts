/**
 * Угол луча и угол поля в плоскости пары C / C + 180°.
 *
 * Профиль плоскости строится по углу от −γmax (сторона C + 180°) до +γmax (сторона C).
 * От максимума профиля идём в обе стороны до первого значения ниже порога (50 % — луч,
 * 10 % — поле), точку пересечения находим линейной интерполяцией. Угол — расстояние
 * между точками. Если профиль не опускается ниже порога до края данных — null.
 *
 * Это предварительный расчёт для сводной таблицы (этап 5); полный набор расчётов
 * (зональные потоки, класс по CIE, сверка с эталонами) — этап 6.
 */

import { intensityC } from './angles';
import type { Photometry } from './model';

export interface PlaneAngles {
  /** Плоскость C пары C / C + 180°. */
  plane: number;
  /** Угол луча (50 % от максимума в плоскости), °. */
  beam: number | null;
  /** Угол поля (10 % от максимума в плоскости), °. */
  field: number | null;
}

/** Профиль плоскости: [угол, сила света], угол от −γmax до +γmax. */
function profile(p: Photometry, c: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const v = p.vAngles;
  for (let j = v.length - 1; j >= 0; j--) if (v[j] > 1e-9) out.push([-v[j], intensityC(p, c + 180, v[j])]);
  for (const g of v) out.push([g, intensityC(p, c, g)]);
  return out;
}

function spread(pr: Array<[number, number]>, i0: number, thr: number): number | null {
  const cross = (dir: 1 | -1): number | null => {
    for (let i = i0; i + dir >= 0 && i + dir < pr.length; i += dir) {
      const [a1, v1] = pr[i];
      const [a2, v2] = pr[i + dir];
      if (v2 < thr) return a1 + ((v1 - thr) / (v1 - v2)) * (a2 - a1);
    }
    return null;
  };
  const r = cross(1);
  const l = cross(-1);
  return r == null || l == null ? null : r - l;
}

/** Углы луча и поля в плоскостях C (тип C; для типа B — после пересчёта). */
export function planeAngles(p: Photometry, c: number): PlaneAngles {
  const pr = profile(p, c);
  let i0 = 0;
  for (let i = 1; i < pr.length; i++) if (pr[i][1] > pr[i0][1]) i0 = i;
  const max = pr[i0]?.[1] ?? 0;
  if (!(max > 0)) return { plane: c, beam: null, field: null };
  const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
  return { plane: c, beam: r1(spread(pr, i0, 0.5 * max)), field: r1(spread(pr, i0, 0.1 * max)) };
}

/** Углы в плоскостях C0–C180 и C90–C270 (для осевой симметрии — одна плоскость). */
export function beamAngles(p: Photometry): PlaneAngles[] {
  const axial = p.symmetry === 'axial' || p.hAngles.length === 1;
  return (axial ? [0] : [0, 90]).map((c) => planeAngles(p, c));
}
