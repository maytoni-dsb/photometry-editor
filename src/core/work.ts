/**
 * Рабочее тело операций — 2D-интерполянт (правки 16.11.2026).
 *
 * Операции выполняются не над сеткой файла, а над плотной сеткой полного круга («рабочее тело»):
 * C с шагом не крупнее 2°, γ — не крупнее 1°, и обе сетки содержат все узлы исходной сетки.
 * Значения между узлами файла берутся монотонной кубической интерполяцией (PCHIP: гладко
 * и без выбросов), в самих узлах — точно. Файл получается выборкой рабочего тела на «сетку вывода».
 *
 * Отсюда:
 *  - смена сетки меняет только сетку вывода — она обратима: вернули прежний шаг — получили
 *    прежние значения;
 *  - симметризация не уменьшает сетку C: данные становятся симметричными, сетка остаётся;
 *  - поворот на угол, не кратный шагу C файла, не «срезает» лепестки КСС: интерполяция идёт
 *    по плотной гладкой сетке, предпросмотр не «дышит».
 * Нормировка считается по выборке на сетку вывода, поэтому поток / Iмакс файла точно равны заданным.
 */

import { fullPlanes, intensityC, uniformStep } from './angles';
import { computeFlux } from './flux';
import type { Issue } from './issues';
import { clonePhotometry, type Photometry, type Symmetry } from './model';
import { applyOp, normalize, OpError, refreshStated, regrid, sumBodies, type OpSpec, type RotationStep } from './ops';
import { typeBToC } from './typeb';

const EPS = 1e-6;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export interface OutGrid {
  symmetry: Symmetry;
  hAngles: number[];
  vAngles: number[];
}

export interface Work {
  /** Плотное тело: симметрия none, C 0…360 − шаг, равномерно. */
  dense: Photometry;
  /** Сетка файла. */
  out: OutGrid;
}

// ——— монотонная кубическая интерполяция (Fritsch–Carlson) ———

function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const d = new Array<number>(n).fill(0);
  if (n < 2) return d;
  const h: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(x[i + 1] - x[i]);
    s.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  }
  d[0] = s[0];
  d[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) d[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / s[i - 1] + w2 / s[i]);
    }
  }
  return d;
}

/** Значения PCHIP в точках xs (x — возрастающие узлы). Вне диапазона — 0. */
export function pchip(x: number[], y: number[], xs: number[]): number[] {
  if (x.length === 1) return xs.map((v) => (Math.abs(v - x[0]) < EPS ? y[0] : 0));
  const d = pchipSlopes(x, y);
  let i = 0;
  return xs.map((v) => {
    if (v < x[0] - EPS || v > x[x.length - 1] + EPS) return 0;
    while (i > 0 && v < x[i]) i--;
    while (i < x.length - 2 && v > x[i + 1]) i++;
    const h = x[i + 1] - x[i];
    const t = (v - x[i]) / h;
    if (t <= 1e-12) return y[i];
    if (t >= 1 - 1e-12) return y[i + 1];
    const t2 = t * t;
    const t3 = t2 * t;
    const val = (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * d[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * d[i + 1];
    return Math.max(0, val);
  });
}

/** Периодический PCHIP по кругу (x в [0, 360), без дубля 360). */
function pchipPeriodic(x: number[], y: number[], xs: number[]): number[] {
  const n = x.length;
  if (n === 1) return xs.map(() => y[0]);
  // по две точки с каждой стороны — наклоны на краях как внутри круга
  const xx = [x[n - 2] - 360, x[n - 1] - 360, ...x, x[0] + 360, x[1 % n] + 360];
  const yy = [y[n - 2], y[n - 1], ...y, y[0], y[1 % n]];
  return pchip(xx, yy, xs);
}

// ——— плотная сетка ———

function refine(nodes: number[], maxStep: number, fallback: number, lo: number, hi: number): number[] {
  const u = uniformStep(nodes);
  if (u > 0 && nodes.length > 1) {
    const k = Math.max(1, Math.ceil(u / maxStep - 1e-9));
    const step = u / k;
    const n = Math.round((hi - lo) / step);
    return Array.from({ length: n + 1 }, (_, i) => r6(lo + i * step));
  }
  // неравномерная сетка: равномерная мелкая плюс узлы файла
  const n = Math.round((hi - lo) / fallback);
  const set = new Set<number>([...Array.from({ length: n + 1 }, (_, i) => r6(lo + i * fallback)), ...nodes.map(r6)]);
  return [...set].filter((v) => v >= lo - EPS && v <= hi + EPS).sort((a, b) => a - b);
}

/** Рабочее тело из модели типа C. */
export function denseFrom(p: Photometry): Photometry {
  const planes = fullPlanes(p).filter((pl) => pl.c < 360 - EPS);
  const v = p.vAngles;
  const gs = v.length > 1 ? refine(v, 1, 0.5, v[0], v[v.length - 1]) : [...v];
  const axial = planes.length === 1;
  let cs: number[];
  if (axial) cs = Array.from({ length: 180 }, (_, i) => i * 2);
  else {
    const c = planes.map((pl) => pl.c);
    const u = uniformStep(c);
    const regular = u > 0 && Math.abs(c[0]) < EPS && Math.abs(360 / u - Math.round(360 / u)) < 1e-6;
    cs = regular ? refine([...c, 360], 2, 1, 0, 360).filter((x) => x < 360 - EPS) : refine([...c], 2, 1, 0, 360).filter((x) => x < 360 - EPS);
  }
  // сначала вдоль γ в каждой плоскости, потом по кругу C
  const alongG = planes.map((pl) => (v.length > 1 ? pchip(v, pl.values, gs) : [...pl.values]));
  const q = clonePhotometry(p);
  q.symmetry = 'none';
  q.hAngles = cs;
  q.vAngles = gs;
  if (axial) q.candela = cs.map(() => [...alongG[0]]);
  else {
    const cAt = planes.map((pl) => pl.c);
    const cols = gs.map((_, j) => pchipPeriodic(cAt, alongG.map((row) => row[j]), cs));
    q.candela = cs.map((_, i) => gs.map((_, j) => cols[j][i]));
  }
  return q;
}

/** Выборка рабочего тела на сетку вывода. */
export function sample(dense: Photometry, out: OutGrid): Photometry {
  const q = clonePhotometry(dense);
  q.symmetry = out.symmetry;
  q.hAngles = [...out.hAngles];
  q.vAngles = [...out.vAngles];
  q.candela = q.hAngles.map((c) => q.vAngles.map((g) => intensityC(dense, c, g)));
  return q;
}

const gridOf = (p: Photometry): OutGrid => ({ symmetry: p.symmetry, hAngles: [...p.hAngles], vAngles: [...p.vAngles] });

/** Наибольший шаг из «круглых», делящий span и не крупнее max (не мельче 1°). */
function niceStep(span: number, max: number): number {
  for (const st of [10, 6, 5, 4, 3, 2.5, 2, 1.5, 1]) if (st <= max + EPS && Math.abs(span / st - Math.round(span / st)) < 1e-6) return st;
  return 1;
}

/** Результат операции над плотным телом — снова на плотной сетке C (симметричный результат разворачивается). */
function keepDense(prev: Photometry, q: Photometry): Photometry {
  if (q.symmetry === 'none' && q.hAngles.length === prev.hAngles.length) return q;
  return sample(q, { symmetry: 'none', hAngles: prev.hAngles, vAngles: q.vAngles });
}

export function workFrom(p: Photometry): { work: Work; issues: Issue[] } {
  const issues: Issue[] = [];
  let c = p;
  if (p.photometryType === 'B') {
    const r = typeBToC(p);
    issues.push(...r.issues);
    c = r.photometry;
  }
  return { work: { dense: denseFrom(c), out: gridOf(c) }, issues };
}

export interface WorkResult {
  work: Work;
  /** Модель файла — выборка на сетку вывода. */
  photometry: Photometry;
  issues: Issue[];
}

/** Коэффициент операции «нормировка», вычисленный по выборке на сетку файла. */
function normalizeFactor(out: Photometry, spec: Extract<OpSpec, { op: 'normalize' }>): number {
  if (spec.mode === 'factor') {
    if (spec.value == null || !Number.isFinite(spec.value) || spec.value <= 0) throw new OpError('bad-value');
    return spec.value;
  }
  const r = normalize(out, spec.mode, spec.value).photometry;
  let bi = 0;
  let bj = 0;
  out.candela.forEach((row, i) => row.forEach((x, j) => (x > out.candela[bi][bj] ? ((bi = i), (bj = j)) : 0)));
  const a = out.candela[bi][bj];
  return a > 0 ? r.candela[bi][bj] / a : 1;
}

/** Операция над рабочим телом. */
export function applyWork(w: Work, spec: OpSpec): WorkResult {
  const out0 = sample(w.dense, w.out);
  if (spec.op === 'regrid') {
    const r = regrid(out0, spec.cStep, spec.gStep, spec.gRange);
    const out = gridOf(r.photometry);
    // запрошенная сетка шире рабочего тела по γ — рабочее тело расширяется (нулями)
    let dense = w.dense;
    const v = out.vAngles;
    if (v[v.length - 1] > dense.vAngles[dense.vAngles.length - 1] + EPS || v[0] < dense.vAngles[0] - EPS) {
      const gs = refine([...new Set([...dense.vAngles, ...v])].sort((a, b) => a - b), 1, 0.5, Math.min(v[0], dense.vAngles[0]), Math.max(v[v.length - 1], dense.vAngles[dense.vAngles.length - 1]));
      dense = sample(dense, { symmetry: 'none', hAngles: dense.hAngles, vAngles: gs });
    }
    const work = { dense, out };
    return { work, photometry: finish(work), issues: r.issues };
  }
  if (spec.op === 'normalize') {
    const k = normalizeFactor(out0, spec);
    const d = normalize(w.dense, 'factor', k).photometry;
    const work = { dense: d, out: w.out };
    return { work, photometry: finish(work), issues: [] };
  }
  // сетка вывода — та, что дала бы операция над файлом; симметризация сетку не уменьшает
  const outRes = applyOp(out0, spec);
  const out = spec.op === 'symmetrize' ? w.out : gridOf(outRes.photometry);
  let dense: Photometry;
  if (spec.op === 'smooth' && spec.width >= 8) {
    // широкое ядро даёт гладкий результат: считаем на сетке с шагом ≈ ширина / 6 и интерполируем
    // обратно на плотную — в разы быстрее, расхождение много меньше самого сглаживания
    const v = w.dense.vAngles;
    const cs = niceStep(360, spec.width / 6);
    const gs = niceStep(v[v.length - 1] - v[0], spec.width / 8);
    const coarse = sample(w.dense, {
      symmetry: 'none',
      hAngles: Array.from({ length: Math.round(360 / cs) }, (_, i) => r6(i * cs)),
      vAngles: Array.from({ length: Math.round((v[v.length - 1] - v[0]) / gs) + 1 }, (_, i) => r6(v[0] + i * gs)),
    });
    const sm = applyOp(coarse, spec).photometry;
    dense = sample(sm, { symmetry: 'none', hAngles: w.dense.hAngles, vAngles: v });
  } else dense = keepDense(w.dense, applyOp(w.dense, spec).photometry);
  if (spec.op === 'smooth' && spec.keepFlux !== false) {
    // поток файла сохраняется точно (по выборке на сетку вывода)
    const f0 = computeFlux(out0).total;
    const f1 = computeFlux(sample(dense, out)).total;
    if (f0 > 0 && f1 > 0) {
      dense = clonePhotometry(dense);
      dense.candela = dense.candela.map((row) => row.map((x) => (x * f0) / f1));
    }
  }
  const work = { dense, out };
  return { work, photometry: finish(work), issues: outRes.issues };
}

/** Выборка + пересчёт записанных КПД / доли вниз (как у applyOp). */
function finish(w: Work): Photometry {
  return refreshStated(sample(w.dense, w.out));
}

export interface WorkComponent {
  work: Work;
  weight: number;
  rotations?: RotationStep[];
  offset?: { x: number; y: number; z: number };
}

/** Сложение рабочих тел. Сетка результата — та, что дало бы сложение файлов. */
export function sumWorks(components: WorkComponent[]): WorkResult {
  const outs = sumBodies(components.map((c) => ({ ...c, photometry: sample(c.work.dense, c.work.out) })));
  const dense = sumBodies(components.map((c) => ({ ...c, photometry: c.work.dense })));
  const d0 = components[0].work.dense;
  let dd = dense.photometry;
  if (dd.symmetry !== 'none' || uniformStep(dd.hAngles) <= 0) dd = sample(dd, { symmetry: 'none', hAngles: d0.hAngles, vAngles: dd.vAngles });
  const work = { dense: dd, out: gridOf(outs.photometry) };
  return { work, photometry: finish(work), issues: outs.issues };
}

/** Правка паспорта (метаданные, размеры, лампы) — одинаково в файле и в рабочем теле. */
export function patchWork(w: Work, patch: (p: Photometry) => void): WorkResult {
  const dense = clonePhotometry(w.dense);
  patch(dense);
  const work = { dense, out: w.out };
  const photometry = sample(dense, w.out);
  return { work, photometry, issues: [] };
}
