/** Сравнение двух фотометрий по силе света на общей сетке (для тестов и проверок конвертации). */

import { intensityC, peak } from './angles';
import type { Photometry } from './model';

export interface DiffResult {
  /** Максимальное отклонение, кд. */
  maxAbs: number;
  /** Максимальное отклонение относительно пика первой фотометрии. */
  maxRelToPeak: number;
  at: { c: number; g: number };
}

/** Сравнивает a и b в узлах сетки a (все C 0…360 с шагом cStep и все γ сетки a). */
export function diffIntensity(a: Photometry, b: Photometry, cStep = 5): DiffResult {
  const pk = peak(a).value || 1;
  let maxAbs = 0;
  let at = { c: 0, g: 0 };
  const cs: number[] = [];
  for (let c = 0; c < 360; c += cStep) cs.push(c);
  for (const c of [...cs, ...a.hAngles]) {
    for (const g of a.vAngles) {
      const d = Math.abs(intensityC(a, c, g) - intensityC(b, c, g));
      if (d > maxAbs) {
        maxAbs = d;
        at = { c, g };
      }
    }
  }
  return { maxAbs, maxRelToPeak: maxAbs / pk, at };
}
