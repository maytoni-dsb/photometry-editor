/**
 * Работа с угловой сеткой: симметрия, свёртка углов, интерполяция.
 */

import type { Photometry, Symmetry } from './model';

const EPS = 1e-6;

/** Приводит угол к [0, 360). */
export function norm360(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Диапазон хранимых C-плоскостей для симметрии (тип C). */
export function storedRange(sym: Symmetry): [number, number] {
  switch (sym) {
    case 'axial':
      return [0, 0];
    case 'quadrant':
      return [0, 90];
    case 'c0c180':
      return [0, 180];
    case 'c90c270':
      return [90, 270];
    default:
      return [0, 360];
  }
}

/** Переводит произвольный угол C в угол хранимой области с учётом симметрии. */
export function foldC(sym: Symmetry, c: number): number {
  let a = norm360(c);
  switch (sym) {
    case 'axial':
      return 0;
    case 'c0c180':
      return a > 180 ? 360 - a : a;
    case 'quadrant':
      if (a > 180) a = 360 - a;
      if (a > 90) a = 180 - a;
      return a;
    case 'c90c270':
      if (a < 90) return 180 - a;
      if (a > 270) return 540 - a;
      return a;
    default:
      return a;
  }
}

/** Индекс и доля для линейной интерполяции по возрастающему массиву. */
export function locate(arr: number[], x: number): { i: number; t: number } | null {
  const n = arr.length;
  if (n === 0) return null;
  if (n === 1) return Math.abs(x - arr[0]) < EPS ? { i: 0, t: 0 } : null;
  if (x < arr[0] - EPS || x > arr[n - 1] + EPS) return null;
  if (x <= arr[0]) return { i: 0, t: 0 };
  if (x >= arr[n - 1]) return { i: n - 2, t: 1 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = arr[hi] - arr[lo];
  return { i: lo, t: span > 0 ? (x - arr[lo]) / span : 0 };
}

/** Значение в плоскости iH при угле v (линейная интерполяция по V/γ). Вне диапазона — 0. */
export function planeValue(p: Photometry, iH: number, v: number): number {
  const loc = locate(p.vAngles, v);
  if (!loc) return 0;
  const row = p.candela[iH];
  if (loc.t === 0) return row[loc.i];
  return row[loc.i] * (1 - loc.t) + row[loc.i + 1] * loc.t;
}

/**
 * Сила света в направлении (C, γ) для фотометрии типа C:
 * свёртка по симметрии, затем билинейная интерполяция.
 */
export function intensityC(p: Photometry, c: number, g: number): number {
  const h = p.hAngles;
  if (h.length === 1) return planeValue(p, 0, g);
  const a = foldC(p.symmetry, c);
  if (p.symmetry === 'none') {
    // замыкание круга: между последней плоскостью и первой + 360
    const last = h[h.length - 1];
    if (a > last + EPS) {
      const span = h[0] + 360 - last;
      const t = span > 0 ? (a - last) / span : 0;
      return planeValue(p, h.length - 1, g) * (1 - t) + planeValue(p, 0, g) * t;
    }
    if (a < h[0] - EPS) {
      const span = h[0] + 360 - last;
      const t = span > 0 ? (a + 360 - last) / span : 0;
      return planeValue(p, h.length - 1, g) * (1 - t) + planeValue(p, 0, g) * t;
    }
  }
  const loc = locate(h, a);
  if (!loc) return 0;
  if (loc.t === 0) return planeValue(p, loc.i, g);
  return planeValue(p, loc.i, g) * (1 - loc.t) + planeValue(p, loc.i + 1, g) * loc.t;
}

/** Плоскость (массив по vAngles) в произвольном угле C. */
export function planeAt(p: Photometry, c: number): number[] {
  return p.vAngles.map((g) => intensityC(p, c, g));
}

/** Проверяет, что шаг массива постоянный; возвращает шаг или 0. */
export function uniformStep(arr: number[]): number {
  if (arr.length < 2) return 0;
  const step = arr[1] - arr[0];
  for (let i = 2; i < arr.length; i++) {
    if (Math.abs(arr[i] - arr[i - 1] - step) > 1e-3) return 0;
  }
  return step;
}

/** Определяет симметрию IES типа C по первому и последнему горизонтальному углу. */
export function symmetryFromIesHorizontal(first: number, last: number, count: number): Symmetry | null {
  if (count === 1) return 'axial';
  if (Math.abs(first) < EPS && Math.abs(last - 90) < EPS) return 'quadrant';
  if (Math.abs(first) < EPS && Math.abs(last - 180) < EPS) return 'c0c180';
  if (Math.abs(first - 90) < EPS && Math.abs(last - 270) < EPS) return 'c90c270';
  if (Math.abs(first) < EPS && Math.abs(last - 360) < EPS) return 'none';
  return null;
}

/** Углы плоскостей, которые нужно хранить для симметрии при полном шаге dc. */
export function storedPlanesFor(sym: Symmetry, dc: number): number[] {
  const [a, b] = storedRange(sym);
  if (sym === 'axial') return [0];
  const out: number[] = [];
  const end = sym === 'none' ? 360 - dc / 2 : b + EPS;
  for (let c = a; c <= end; c += dc) out.push(Math.round(c * 1e6) / 1e6);
  return out;
}

/**
 * Разворачивает хранимые плоскости в полный круг [0, 360) с учётом симметрии.
 * Возвращает углы и ссылки на значения (без копирования данных, где возможно).
 */
export function fullPlanes(p: Photometry): Array<{ c: number; values: number[] }> {
  if (p.symmetry === 'axial' || p.hAngles.length === 1) return [{ c: 0, values: p.candela[0] }];
  const set = new Map<number, number[]>();
  const add = (c: number, values: number[]) => {
    const k = Math.round(norm360(c) * 1e6) / 1e6;
    if (!set.has(k)) set.set(k, values);
  };
  p.hAngles.forEach((c, i) => {
    const v = p.candela[i];
    add(c, v);
    switch (p.symmetry) {
      case 'c0c180':
        add(360 - c, v);
        break;
      case 'c90c270':
        add(180 - c, v);
        break;
      case 'quadrant':
        add(180 - c, v);
        add(180 + c, v);
        add(360 - c, v);
        break;
    }
  });
  return [...set.entries()].sort((x, y) => x[0] - y[0]).map(([c, values]) => ({ c, values }));
}

/** Максимальная сила света и её положение. */
export function peak(p: Photometry): { value: number; h: number; v: number } {
  let best = { value: 0, h: 0, v: 0 };
  p.candela.forEach((row, i) =>
    row.forEach((x, j) => {
      if (x > best.value) best = { value: x, h: p.hAngles[i], v: p.vAngles[j] };
    }),
  );
  return best;
}
