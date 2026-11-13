/**
 * Операции над фотометрическими телами (этап 4).
 *
 * Каждая операция — чистая функция: модель на входе не меняется, на выходе новая модель
 * и замечания. Операция задаётся сериализуемым описанием OpSpec — то же описание станет
 * шагом пакетного рецепта (этап 5).
 *
 * Оси (как в EULUMDAT): X — к C0, Y — к C90, Z — вверх; γ = 0° — надир.
 * Направление (C, γ):  d = (sinγ·cosC, sinγ·sinC, −cosγ).
 * Повороты — по правилу правой руки: +Z переводит C0 в C90, +X наклоняет надир к C90,
 * +Y — к C180. Тело поворачивается вместе со светильником: I'(d) = I(R⁻¹·d).
 *
 * Фотометрия типа B перед любой операцией пересчитывается в тип C.
 */

import { foldC, fullPlanes, intensityC, norm360, peak, planeValue, storedPlanesFor, uniformStep } from './angles';
import { computeFlux, gammaWeights } from './flux';
import { issue, type Issue } from './issues';
import { clonePhotometry, type Dimensions, type Photometry, type Symmetry } from './model';
import { referenceFlux } from './summary';
import { typeBToC } from './typeb';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EPS = 1e-6;

export type RotationAxis = 'x' | 'y' | 'z';
export type NormalizeMode = 'flux' | 'cdklm' | 'peak' | 'factor';
export type MirrorPlane = 'c0c180' | 'c90c270' | 'updown';
/** Диапазон γ при смене сетки: как в файле, нижняя полусфера, вся сфера. */
export type GammaRange = 'keep' | 'lower' | 'full';

export interface RotationStep {
  axis: RotationAxis;
  /** Угол, градусы. */
  angle: number;
}

/** Описание операции над одним телом. */
export type OpSpec =
  | { op: 'normalize'; mode: NormalizeMode; /** лм, кд или коэффициент; для cdklm не нужен */ value?: number }
  | { op: 'mirror'; plane: MirrorPlane }
  | { op: 'rotate'; axis: RotationAxis; angle: number }
  | { op: 'symmetrize'; symmetry: Exclude<Symmetry, 'bilateral'> }
  | { op: 'regrid'; cStep: number; gStep: number; gRange?: GammaRange }
  | { op: 'smooth'; /** ширина гауссова ядра на половине высоты, ° */ width: number; /** вернуть исходный поток (по умолчанию да) */ keepFlux?: boolean };

export interface OpResult {
  photometry: Photometry;
  issues: Issue[];
}

/** Ошибка в параметрах операции. Текст собирает интерфейс по коду (ops.err.<code>). */
export class OpError extends Error {
  constructor(
    public code: 'bad-value' | 'zero-flux' | 'zero-peak' | 'c-step' | 'g-step' | 'no-components' | 'smooth-width',
    public params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

// ——— общие помощники ———

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Модель типа C (тип B пересчитывается) и замечание о пересчёте. */
function asTypeC(p: Photometry, issues: Issue[]): Photometry {
  if (p.photometryType !== 'B') return clonePhotometry(p);
  const r = typeBToC(p);
  issues.push(...r.issues);
  return r.photometry;
}

/** Плоскости без дублирующей C360. */
function planesNo360(p: Photometry): number[] {
  return p.hAngles.filter((c) => c < 360 - EPS);
}

const isAxial = (p: Photometry) => p.symmetry === 'axial' || p.hAngles.length === 1;

/** Наибольший «круглый» шаг, делящий span, не крупнее limit. */
function niceDivisor(span: number, limit: number): number {
  const cands = [10, 5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1];
  for (const s of cands) if (s <= limit + EPS && Math.abs(span / s - Math.round(span / s)) < 1e-6) return s;
  return 0.1;
}

/**
 * Естественные шаги сетки тела: шаг C полного круга (если равномерный и делит 90°, иначе
 * подходящий «круглый» не крупнее наименьшего промежутка) и шаг γ так же (делит 180°).
 */
export function naturalSteps(p: Photometry): { cStep: number; gStep: number; exactC: boolean; exactG: boolean } {
  let cStep = 5;
  let exactC = true;
  if (!isAxial(p)) {
    const cs = fullPlanes(p).map((x) => x.c);
    const u = uniformStep(cs);
    if (u > 0 && Math.abs(90 / u - Math.round(90 / u)) < 1e-6 && Math.abs(cs[0]) < EPS) cStep = u;
    else {
      let min = 360;
      for (let i = 1; i < cs.length; i++) min = Math.min(min, cs[i] - cs[i - 1]);
      cStep = niceDivisor(90, min);
      exactC = false;
    }
  }
  const v = p.vAngles;
  const ug = uniformStep(v);
  let gStep: number;
  let exactG = true;
  if (ug > 0 && Math.abs(180 / ug - Math.round(180 / ug)) < 1e-6 && Math.abs(v[0] / ug - Math.round(v[0] / ug)) < 1e-6) gStep = ug;
  else {
    let min = 180;
    for (let i = 1; i < v.length; i++) min = Math.min(min, v[i] - v[i - 1]);
    gStep = niceDivisor(180, Math.min(min, 5));
    exactG = v.length < 2;
  }
  return { cStep, gStep, exactC, exactG };
}

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.round((b - a) / step);
  for (let i = 0; i <= n; i++) out.push(r6(a + i * step));
  return out;
}

/** Коэффициенты использования LDT после операции, меняющей форму КСС, неверны. */
function resetRatios(q: Photometry, issues: Issue[]): void {
  if (q.ldt && q.ldt.directRatios.some((x) => x !== 0)) {
    q.ldt.directRatios = q.ldt.directRatios.map(() => 0);
    issues.push(issue('op-ratios-reset', 'info'));
  }
}

/** Сводит полную («none») равномерную сетку к симметрии, если данные ей точно удовлетворяют. */
export function compactSymmetry(p: Photometry, allowed: Symmetry[] = ['axial', 'quadrant', 'c0c180', 'c90c270']): Photometry {
  if (p.symmetry !== 'none' || p.hAngles.length < 2) return p;
  const cs = planesNo360(p);
  const step = uniformStep(cs);
  if (!(step > 0) || Math.abs(cs[0]) > EPS || Math.abs(360 / step - Math.round(360 / step)) > 1e-6) return p;
  const pk = peak(p).value || 1;
  const tol = pk * 1e-7;
  const same = (map: (c: number) => number) =>
    cs.every((c) => p.vAngles.every((g) => Math.abs(intensityC(p, c, g) - intensityC(p, map(c), g)) <= tol));
  const axialOk = cs.every((c) => p.vAngles.every((g) => Math.abs(intensityC(p, c, g) - intensityC(p, 0, g)) <= tol));
  const div90 = Math.abs(90 / step - Math.round(90 / step)) < 1e-6;
  const div180 = Math.abs(180 / step - Math.round(180 / step)) < 1e-6;
  const s0 = div180 && same((c) => -c);
  const s90 = div90 && same((c) => 180 - c);
  let sym: Symmetry = 'none';
  if (axialOk && allowed.includes('axial')) sym = 'axial';
  else if (s0 && s90 && allowed.includes('quadrant')) sym = 'quadrant';
  else if (s0 && allowed.includes('c0c180')) sym = 'c0c180';
  else if (s90 && allowed.includes('c90c270')) sym = 'c90c270';
  if (sym === 'none') return p;
  const q = clonePhotometry(p);
  q.symmetry = sym;
  q.hAngles = storedPlanesFor(sym, step);
  q.candela = q.hAngles.map((c) => p.vAngles.map((g) => intensityC(p, c, g)));
  return q;
}

/** Полный круг без симметрии (C0…C360 − шаг) — точный разворот хранимых плоскостей. */
function unfold(p: Photometry): Photometry {
  const q = clonePhotometry(p);
  if (p.symmetry === 'none') {
    const keep = p.hAngles.map((c, i) => ({ c, v: p.candela[i] })).filter((x) => x.c < 360 - EPS);
    q.hAngles = keep.map((x) => x.c);
    q.candela = keep.map((x) => [...x.v]);
    return q;
  }
  if (isAxial(p)) {
    // осевая: разворачиваем на естественный шаг
    q.symmetry = 'none';
    q.hAngles = range(0, 355, 5);
    q.candela = q.hAngles.map(() => [...p.candela[0]]);
    return q;
  }
  const planes = fullPlanes(p);
  q.symmetry = 'none';
  q.hAngles = planes.map((x) => x.c);
  q.candela = planes.map((x) => [...x.values]);
  return q;
}

// ——— размеры ———

type Mat3 = [number, number, number, number, number, number, number, number, number];

export function rotationMatrix(axis: RotationAxis, angle: number): Mat3 {
  const c = Math.cos(angle * RAD);
  const s = Math.sin(angle * RAD);
  // точные значения для кратных 90°
  const cc = Math.abs(c) < 1e-12 ? 0 : c;
  const ss = Math.abs(s) < 1e-12 ? 0 : s;
  if (axis === 'x') return [1, 0, 0, 0, cc, -ss, 0, ss, cc];
  if (axis === 'y') return [cc, 0, ss, 0, 1, 0, -ss, 0, cc];
  return [cc, -ss, 0, ss, cc, 0, 0, 0, 1];
}

export function applyMat(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Направление (C, γ) → вектор. */
export function dirFromCG(c: number, g: number): [number, number, number] {
  const sg = Math.sin(g * RAD);
  return [sg * Math.cos(c * RAD), sg * Math.sin(c * RAD), -Math.cos(g * RAD)];
}

/** Вектор → (C, γ), C в [0, 360). */
export function cgFromDir(d: [number, number, number]): { c: number; g: number } {
  const g = Math.acos(Math.max(-1, Math.min(1, -d[2]))) * DEG;
  const c = Math.abs(d[0]) < 1e-12 && Math.abs(d[1]) < 1e-12 ? 0 : norm360(Math.atan2(d[1], d[0]) * DEG);
  return { c, g };
}

/** Габарит повёрнутого бокса (длина по X, ширина по Y, высота по Z). */
function rotateDims(d: Dimensions, m: Mat3): Dimensions {
  if (d.shape === 'point' || (d.length === 0 && d.width === 0 && d.height === 0)) return { ...d };
  const L = d.length;
  const W = d.shape === 'circle' ? d.length : d.width;
  const H = d.height;
  const ext = (row: number) => Math.abs(m[row * 3]) * L + Math.abs(m[row * 3 + 1]) * W + Math.abs(m[row * 3 + 2]) * H;
  const nl = r6(ext(0));
  const nw = r6(ext(1));
  const nh = r6(ext(2));
  if (d.shape === 'circle' && Math.abs(nl - L) < 1e-3 && Math.abs(nw - L) < 1e-3 && Math.abs(nh - H) < 1e-3) return { ...d };
  return { shape: d.shape === 'other' ? 'other' : 'rect', length: nl, width: nw, height: nh };
}

// ——— нормировка ———

/** Умножает силы света и поток ламп (первого комплекта) на k: форма и кд/клм не меняются. */
function scale(p: Photometry, k: number): Photometry {
  const q = clonePhotometry(p);
  q.candela = p.candela.map((row) => row.map((x) => x * k));
  const l = q.lamps[0];
  if (l && l.flux != null && l.flux > 0) l.flux = l.flux * k;
  return q;
}

export function normalize(p: Photometry, mode: NormalizeMode, value?: number): OpResult {
  const issues: Issue[] = [];
  const c = asTypeC(p, issues);
  const flux = computeFlux(c).total;
  let k: number;
  if (mode === 'cdklm') {
    const ref = referenceFlux(c, flux).value;
    if (!(ref > 0)) throw new OpError('zero-flux');
    k = 1000 / ref;
  } else {
    if (value == null || !Number.isFinite(value) || value <= 0) throw new OpError('bad-value');
    if (mode === 'flux') {
      if (!(flux > 0)) throw new OpError('zero-flux');
      k = value / flux;
    } else if (mode === 'peak') {
      const pk = peak(c).value;
      if (!(pk > 0)) throw new OpError('zero-peak');
      k = value / pk;
    } else k = value;
  }
  return { photometry: scale(c, k), issues };
}

// ——— отражение ———

export function mirror(p: Photometry, plane: MirrorPlane): OpResult {
  const issues: Issue[] = [];
  const src = asTypeC(p, issues);
  const q = clonePhotometry(src);
  if (plane === 'updown') {
    const set = [...new Set([...src.vAngles, ...src.vAngles.map((g) => r6(180 - g))])].sort((a, b) => a - b);
    q.vAngles = set;
    q.candela = src.candela.map((_, i) => set.map((a) => planeValue(src, i, 180 - a)));
    resetRatios(q, issues);
    return { photometry: q, issues };
  }
  const map = plane === 'c0c180' ? (c: number) => -c : (c: number) => 180 - c;
  if (!isAxial(src)) {
    if (src.symmetry === 'none') {
      const items = src.hAngles
        .map((c, i) => ({ c: r6(norm360(map(c))), v: src.candela[i] }))
        .filter((x, i) => src.hAngles[i] < 360 - EPS)
        .sort((a, b) => a.c - b.c);
      q.hAngles = items.map((x) => x.c);
      q.candela = items.map((x) => [...x.v]);
    } else {
      // симметрия сохраняется: отражения относительно перпендикулярных плоскостей коммутируют
      q.candela = src.hAngles.map((c) => src.vAngles.map((g) => intensityC(src, foldC(src.symmetry, map(c)), g)));
    }
  }
  // высоты светящей части C0, C90, C180, C270
  if (q.ldt) {
    const [h0, h90, h180, h270] = q.ldt.luminousHeights;
    q.ldt.luminousHeights = plane === 'c0c180' ? [h0, h270, h180, h90] : [h180, h90, h0, h270];
  }
  return { photometry: q, issues };
}

// ——— повороты ———

/** Поворот вокруг вертикальной оси Z: сдвиг C-плоскостей (с интерполяцией, если угол не кратен шагу). */
function rotateZ(src: Photometry, angle: number, issues: Issue[]): Photometry {
  const a = norm360(angle);
  if (isAxial(src) || a < EPS || a > 360 - EPS) return clonePhotometry(src);
  const full = unfold(src);
  const cs = full.hAngles;
  const step = uniformStep(cs);
  const regular = step > 0 && Math.abs(cs[0]) < EPS && Math.abs(360 / step - Math.round(360 / step)) < 1e-6;
  let q: Photometry;
  if (regular && Math.abs(a / step - Math.round(a / step)) < 1e-6) {
    // точный сдвиг плоскостей
    q = clonePhotometry(full);
    const items = cs.map((c, i) => ({ c: r6(norm360(c + a)), v: full.candela[i] })).sort((x, y) => x.c - y.c);
    q.hAngles = items.map((x) => x.c);
    q.candela = items.map((x) => x.v);
  } else {
    // интерполяция на исходную сетку (или на 5°, если сетка неравномерная)
    const grid = regular ? cs : range(0, 355, 5);
    if (!regular) issues.push(issue('op-resampled', 'info', { cStep: 5, gStep: uniformStep(src.vAngles) || '—' }));
    q = clonePhotometry(full);
    q.hAngles = grid;
    q.candela = grid.map((c) => src.vAngles.map((g) => intensityC(src, c - a, g)));
  }
  if (src.symmetry !== 'none') q = compactSymmetry(q);
  const m = rotationMatrix('z', angle);
  q.luminous = rotateDims(src.luminous, m);
  q.luminaire = rotateDims(src.luminaire, m);
  if (q.ldt) {
    const k = Math.round(a / 90);
    const h = src.ldt!.luminousHeights;
    q.ldt.luminousHeights =
      Math.abs(a - k * 90) < EPS ? ([0, 1, 2, 3].map((i) => h[(i - k + 4) % 4]) as [number, number, number, number]) : [q.luminous.height, q.luminous.height, q.luminous.height, q.luminous.height];
  }
  return q;
}

/** Поворот вокруг горизонтальной оси: пересчёт на полную сетку C 0…360, γ 0…180. */
function rotateXY(src: Photometry, axis: 'x' | 'y', angle: number, issues: Issue[]): Photometry {
  const a = norm360(angle);
  if (a < EPS || a > 360 - EPS) return clonePhotometry(src);
  const steps = naturalSteps(src);
  const cs = range(0, 360 - steps.cStep, steps.cStep);
  const gs = range(0, 180, steps.gStep);
  if (!steps.exactC || !steps.exactG) issues.push(issue('op-resampled', 'info', { cStep: steps.cStep, gStep: steps.gStep }));
  const inv = rotationMatrix(axis, -angle);
  const q = clonePhotometry(src);
  q.symmetry = 'none';
  q.hAngles = cs;
  q.vAngles = gs;
  q.candela = cs.map((c) =>
    gs.map((g) => {
      const s = cgFromDir(applyMat(inv, dirFromCG(c, g)));
      return intensityC(src, s.c, s.g);
    }),
  );
  let out = q;
  if (src.symmetry !== 'none') out = compactSymmetry(q);
  const m = rotationMatrix(axis, angle);
  out.luminous = rotateDims(src.luminous, m);
  out.luminaire = rotateDims(src.luminaire, m);
  if (out.ldt) {
    const h = out.luminous.height;
    out.ldt.luminousHeights = [h, h, h, h];
  }
  resetRatios(out, issues);
  return out;
}

export function rotate(p: Photometry, axis: RotationAxis, angle: number): OpResult {
  if (!Number.isFinite(angle)) throw new OpError('bad-value');
  const issues: Issue[] = [];
  const src = asTypeC(p, issues);
  const out = axis === 'z' ? rotateZ(src, angle, issues) : rotateXY(src, axis, angle, issues);
  return { photometry: out, issues };
}

/** Куда после поворотов попадает направление (C, γ) — для подсказки в интерфейсе. */
export function rotatedDirection(steps: RotationStep[], c = 0, g = 0): { c: number; g: number } {
  let d = dirFromCG(c, g);
  for (const s of steps) d = applyMat(rotationMatrix(s.axis, s.angle), d);
  return cgFromDir(d);
}

// ——— симметризация ———

export function symmetrize(p: Photometry, target: Exclude<Symmetry, 'bilateral'>): OpResult {
  const issues: Issue[] = [];
  const src = asTypeC(p, issues);
  if (target === 'none') return { photometry: unfold(src), issues };
  const q = clonePhotometry(src);
  if (target === 'axial') {
    if (isAxial(src)) return { photometry: q, issues };
    // среднее по C с весами промежутков: поток сохраняется точно
    const planes = fullPlanes(src);
    const n = planes.length;
    const w = planes.map((pl, i) => {
      const prev = i === 0 ? planes[n - 1].c - 360 : planes[i - 1].c;
      const next = i === n - 1 ? planes[0].c + 360 : planes[i + 1].c;
      return (next - prev) / 2 / 360;
    });
    q.symmetry = 'axial';
    q.hAngles = [0];
    q.candela = [src.vAngles.map((_, j) => planes.reduce((s, pl, i) => s + pl.values[j] * w[i], 0))];
    resetRatios(q, issues);
    return { photometry: q, issues };
  }
  const steps = naturalSteps(src);
  if (!steps.exactC) issues.push(issue('op-resampled', 'info', { cStep: steps.cStep, gStep: uniformStep(src.vAngles) || '—' }));
  const images: Record<string, (c: number) => number[]> = {
    c0c180: (c) => [c, -c],
    c90c270: (c) => [c, 180 - c],
    quadrant: (c) => [c, -c, 180 - c, 180 + c],
  };
  const img = images[target];
  q.symmetry = target;
  q.hAngles = storedPlanesFor(target, steps.cStep);
  q.candela = q.hAngles.map((c) =>
    src.vAngles.map((g) => {
      const cs = img(c);
      return cs.reduce((s, x) => s + intensityC(src, x, g), 0) / cs.length;
    }),
  );
  resetRatios(q, issues);
  return { photometry: q, issues };
}

// ——— смена сетки ———

export function regrid(p: Photometry, cStep: number, gStep: number, gRange: GammaRange = 'keep'): OpResult {
  const issues: Issue[] = [];
  const src = asTypeC(p, issues);
  if (!(gStep > 0) || !Number.isFinite(gStep)) throw new OpError('g-step', { step: gStep });
  const q = clonePhotometry(src);
  if (!isAxial(src)) {
    const [a, b] = src.symmetry === 'none' ? [0, 360] : src.symmetry === 'quadrant' ? [0, 90] : [0, 180];
    if (!(cStep > 0) || Math.abs((b - a) / cStep - Math.round((b - a) / cStep)) > 1e-6) throw new OpError('c-step', { step: cStep, span: b - a });
    q.hAngles = storedPlanesFor(src.symmetry, cStep);
  }
  const v = src.vAngles;
  const [g0, g1] = gRange === 'lower' ? [0, 90] : gRange === 'full' ? [0, 180] : [v[0], v[v.length - 1]];
  if (Math.abs((g1 - g0) / gStep - Math.round((g1 - g0) / gStep)) > 1e-6) throw new OpError('g-step', { step: gStep, span: g1 - g0 });
  q.vAngles = range(g0, g1, gStep);
  q.candela = q.hAngles.map((c) => q.vAngles.map((g) => (isAxial(src) ? planeValue(src, 0, g) : intensityC(src, c, g))));
  return { photometry: q, issues };
}

// ——— сглаживание ———

/**
 * Сглаживание гауссовым ядром на сфере: значение в узле — взвешенное среднее по соседним
 * направлениям, вес = exp(−θ²/2σ²) × телесный угол узла (θ — угол между направлениями,
 * σ = ширина / 2,355). Ядро изотропное: одинаково по C и γ, корректно в полюсах и
 * не нарушает симметрию. Сетка и симметрия файла сохраняются; если в файле нет части сферы
 * (например, только 0…90°), ядро у края обрезается и нормируется заново.
 */
export function smooth(p: Photometry, width: number, keepFlux = true): OpResult {
  if (!Number.isFinite(width) || width <= 0) throw new OpError('bad-value');
  if (width > 30) throw new OpError('smooth-width');
  const issues: Issue[] = [];
  const src = asTypeC(p, issues);
  const full = unfold(src); // полный круг, у осевой — плоскости через 5°
  const cs = full.hAngles;
  const vs = src.vAngles;
  const nc = cs.length;
  const nv = vs.length;
  const sigma = (width / 2.3548) * RAD;
  const cut = 2.5 * sigma;
  const cosCut = Math.cos(cut);
  const cutDeg = cut * DEG;

  // телесные углы узлов: по γ — зоны, по C — половины промежутков
  const gw = gammaWeights(vs);
  const cw = cs.map((_, i) => {
    if (nc === 1) return 2 * Math.PI;
    const prev = i === 0 ? cs[nc - 1] - 360 : cs[i - 1];
    const next = i === nc - 1 ? cs[0] + 360 : cs[i + 1];
    return ((next - prev) / 2) * RAD;
  });
  const sinV = vs.map((g) => Math.sin(g * RAD));
  const cosV = vs.map((g) => Math.cos(g * RAD));
  const step = uniformStep(cs);
  const uniform = step > 0 && Math.abs(cs[0]) < EPS && Math.abs(360 / step - Math.round(360 / step)) < 1e-6;

  // при малом θ: θ²/2 ≈ 1 − cosθ (ошибка ~θ⁴/24), поэтому вес считается без acos
  const inv = 1 / (sigma * sigma);
  // таблица cos ΔC для равномерной сетки (ΔC кратно шагу)
  const cosTab = uniform ? Array.from({ length: nc }, (_, k) => Math.cos(k * step * RAD)) : [];

  const value = (c: number, j: number): number => {
    const g = vs[j];
    const ic = uniform ? Math.round(c / step) : -1;
    const onGrid = uniform && Math.abs(ic * step - c) < 1e-6;
    let sw = 0;
    let si = 0;
    for (let j2 = 0; j2 < nv; j2++) {
      if (Math.abs(vs[j2] - g) > cutDeg + EPS) continue;
      const sMin = Math.min(sinV[j], sinV[j2]);
      // sinθ ≥ sin(min γ)·sin|ΔC| — дальше этого ΔC направления заведомо дальше cut
      const r = Math.sin(cut) / sMin;
      const dcMax = !(sMin > 0) || r >= 1 ? 180 : Math.asin(r) * DEG + 1e-6;
      const cc = cosV[j] * cosV[j2];
      const ss = sinV[j] * sinV[j2];
      const g2w = gw[j2];
      if (onGrid) {
        const half = Math.floor(nc / 2);
        const kMax = dcMax >= 180 ? half : Math.min(half, Math.floor(dcMax / step));
        const k0 = kMax * 2 === nc ? -kMax + 1 : -kMax; // ΔC = 180° не считать дважды
        for (let k = k0; k <= kMax; k++) {
          const cosT = cc + ss * cosTab[k < 0 ? k + nc : k];
          if (cosT < cosCut) continue;
          let i2 = ic + k;
          if (i2 < 0) i2 += nc;
          else if (i2 >= nc) i2 -= nc;
          const w = Math.exp((cosT - 1) * inv) * cw[i2] * g2w;
          sw += w;
          si += w * full.candela[i2][j2];
        }
      } else {
        for (let i2 = 0; i2 < nc; i2++) {
          const cosT = cc + ss * Math.cos((cs[i2] - c) * RAD);
          if (cosT < cosCut) continue;
          const w = Math.exp((cosT - 1) * inv) * cw[i2] * g2w;
          sw += w;
          si += w * full.candela[i2][j2];
        }
      }
    }
    // у полюса зона узла нулевой ширины по γ может дать нулевой вес — берём исходное значение
    return sw > 0 ? si / sw : intensityC(src, c, g);
  };

  const q = clonePhotometry(src);
  q.candela = src.hAngles.map((c) => vs.map((_, j) => value(c, j)));
  if (keepFlux) {
    const f0 = computeFlux(src).total;
    const f1 = computeFlux(q).total;
    if (f0 > 0 && f1 > 0) q.candela = q.candela.map((row) => row.map((x) => (x * f0) / f1));
  }
  resetRatios(q, issues);
  return { photometry: q, issues };
}

// ——— диспетчер ———

/**
 * Записанные в LDT КПД и доля потока вниз после операции устарели — пересчитываются по данным
 * (при записи LDT они и так считаются заново; здесь — чтобы паспорт показывал верные числа).
 */
function refreshStated(q: Photometry): Photometry {
  if (!q.ldt) return q;
  const f = computeFlux(q);
  const lamp = q.lamps[0]?.flux;
  q.ldt.dff = f.total > 0 ? (f.down / f.total) * 100 : 0;
  q.ldt.lorl = q.absolute || !(lamp && lamp > 0) ? 100 : (f.total / lamp) * 100;
  return q;
}

function runOp(p: Photometry, spec: OpSpec): OpResult {
  switch (spec.op) {
    case 'normalize':
      return normalize(p, spec.mode, spec.value);
    case 'mirror':
      return mirror(p, spec.plane);
    case 'rotate':
      return rotate(p, spec.axis, spec.angle);
    case 'symmetrize':
      return symmetrize(p, spec.symmetry);
    case 'regrid':
      return regrid(p, spec.cStep, spec.gStep, spec.gRange);
    case 'smooth':
      return smooth(p, spec.width, spec.keepFlux ?? true);
  }
}

export function applyOp(p: Photometry, spec: OpSpec): OpResult {
  const r = runOp(p, spec);
  return { photometry: refreshStated(r.photometry), issues: r.issues };
}

// ——— сложение ———

export interface SumComponent {
  photometry: Photometry;
  /** Вес (множитель сил света), ≥ 0. */
  weight: number;
  /** Повороты компонента, по порядку. */
  rotations?: RotationStep[];
  /** Смещение центра компонента, мм. Учитывается в размерах; силы света складываются в дальней зоне. */
  offset?: { x: number; y: number; z: number };
}

function sameGrid(a: Photometry, b: Photometry): boolean {
  const eq = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < EPS);
  return a.symmetry === b.symmetry && eq(a.hAngles, b.hAngles) && eq(a.vAngles, b.vAngles);
}

/** Сумма тел в дальней зоне. Метаданные — от первого слагаемого. */
export function sumBodies(components: SumComponent[]): OpResult {
  if (!components.length) throw new OpError('no-components');
  const issues: Issue[] = [];
  const bodies = components.map((comp) => {
    if (!(comp.weight >= 0) || !Number.isFinite(comp.weight)) throw new OpError('bad-value');
    let b = asTypeC(comp.photometry, issues);
    for (const r of comp.rotations ?? []) {
      if (Math.abs(norm360(r.angle)) < EPS) continue;
      const res = rotate(b, r.axis, r.angle);
      issues.push(...res.issues);
      b = res.photometry;
    }
    return { b, w: comp.weight, comp };
  });

  const first = bodies[0].b;
  const q = clonePhotometry(first);
  if (bodies.every((x) => sameGrid(x.b, first))) {
    // общая сетка — точная сумма
    q.candela = first.candela.map((row, i) => row.map((_, j) => bodies.reduce((s, x) => s + x.b.candela[i][j] * x.w, 0)));
  } else {
    const sym = bodies.every((x) => x.b.symmetry === first.symmetry) ? first.symmetry : 'none';
    const steps = bodies.map((x) => naturalSteps(x.b));
    const nonAxial = bodies.filter((x) => !isAxial(x.b));
    const cStep = Math.min(...(nonAxial.length ? steps.filter((_, i) => !isAxial(bodies[i].b)).map((s) => s.cStep) : [5]));
    const gStep = Math.min(...steps.map((s) => s.gStep));
    const gMax = Math.max(...bodies.map((x) => x.b.vAngles[x.b.vAngles.length - 1])) > 90 + EPS ? 180 : 90;
    q.symmetry = sym === 'axial' ? 'axial' : sym;
    q.hAngles = sym === 'axial' ? [0] : storedPlanesFor(sym, cStep);
    q.vAngles = range(0, gMax, gStep);
    q.candela = q.hAngles.map((c) => q.vAngles.map((g) => bodies.reduce((s, x) => s + intensityC(x.b, c, g) * x.w, 0)));
    issues.push(issue('op-sum-resampled', 'info', { cStep, gStep }));
  }

  // лампы и мощность
  const allRelative = bodies.every((x) => !x.b.absolute);
  const lamp0 = { ...(first.lamps[0] ?? { count: 1, flux: null, type: '', cct: '', cri: '', watts: null }) };
  const fluxes = bodies.map((x) => x.b.lamps[0]?.flux);
  const sumFlux = fluxes.every((f) => f != null && f > 0) ? bodies.reduce((s, x) => s + (x.b.lamps[0]!.flux as number) * x.w, 0) : null;
  const wattsOf = (x: Photometry) => x.inputWatts ?? x.lamps[0]?.watts ?? null;
  const sumWatts = bodies.every((x) => wattsOf(x.b) != null) ? bodies.reduce((s, x) => s + (wattsOf(x.b) as number) * x.w, 0) : null;
  q.absolute = !allRelative;
  if (allRelative && sumFlux == null) q.absolute = true;
  lamp0.flux = sumFlux;
  lamp0.watts = sumWatts;
  const counts = bodies.map((x) => Math.abs(x.b.lamps[0]?.count ?? 1));
  lamp0.count = q.absolute ? -1 : Math.max(1, Math.round(bodies.reduce((s, x, i) => s + counts[i] * x.w, 0)));
  q.lamps = [lamp0];
  q.inputWatts = sumWatts;

  // размеры: охватывающий бокс компонентов с учётом смещений
  const box = (key: 'luminous' | 'luminaire') => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let any = false;
    let circles = true;
    for (const x of bodies) {
      const d = x.b[key];
      const o = x.comp.offset ?? { x: 0, y: 0, z: 0 };
      const L = d.shape === 'point' ? 0 : d.length;
      const W = d.shape === 'circle' ? d.length : d.shape === 'point' ? 0 : d.width;
      const H = d.shape === 'point' ? 0 : d.height;
      if (d.shape !== 'circle' || Math.abs(o.x) > EPS || Math.abs(o.y) > EPS) circles = false;
      if (L || W || H || o.x || o.y || o.z) any = true;
      minX = Math.min(minX, o.x - L / 2); maxX = Math.max(maxX, o.x + L / 2);
      minY = Math.min(minY, o.y - W / 2); maxY = Math.max(maxY, o.y + W / 2);
      minZ = Math.min(minZ, o.z - H / 2); maxZ = Math.max(maxZ, o.z + H / 2);
    }
    if (!any) return { ...first[key] };
    const L = r6(maxX - minX);
    const W = r6(maxY - minY);
    const H = r6(maxZ - minZ);
    return circles ? { shape: 'circle' as const, length: L, width: 0, height: H } : { shape: 'rect' as const, length: L, width: W, height: H };
  };
  q.luminous = box('luminous');
  q.luminaire = box('luminaire');
  if (q.ldt) {
    const h = q.luminous.height;
    q.ldt.luminousHeights = [h, h, h, h];
  }
  if (components.some((c) => c.offset && (c.offset.x || c.offset.y || c.offset.z))) issues.push(issue('op-sum-offsets', 'info'));
  if (components.length > 1) resetRatios(q, issues);
  return { photometry: refreshStated(q), issues: dedupe(issues) };
}

function dedupe(list: Issue[]): Issue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = i.code + JSON.stringify(i.params ?? {});
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
