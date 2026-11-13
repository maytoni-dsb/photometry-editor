/**
 * Геометрия 3D-фотометрического тела (без three.js — проверяется в тестах).
 *
 * Поверхность: для каждого направления (C, γ) точка на расстоянии I(C, γ) / scale от центра.
 * Координаты фотометрические (как в EULUMDAT): X — к C0, Y — к C90, Z — вверх, γ = 0° — надир.
 * Перевод в оси three.js (Y вверх) делает компонент просмотра.
 */

import { intensityC, peak, planeValue, type Photometry } from '../core/index';

export interface BodyMesh {
  /** Вершины x, y, z (фотометрические оси), нормированы на scale. */
  positions: Float32Array;
  /** Относительная сила света в вершине, 0…1 (от максимума этого тела). */
  relative: Float32Array;
  /** Треугольники. */
  indices: Uint32Array;
  /** Число узлов по C и по γ. */
  nc: number;
  ng: number;
  /** Максимум силы света тела, кд. */
  peak: number;
}

export interface BodyOptions {
  /** Сила света, которая станет радиусом 1 (общий масштаб для «до / после»). По умолчанию — максимум тела. */
  scale?: number;
  /** Шаги сетки, градусы. По умолчанию — не крупнее сетки файла, но не мельче 2° / 1°. */
  cStep?: number;
  gStep?: number;
}

const RAD = Math.PI / 180;

function minGap(a: number[]): number {
  let m = Infinity;
  for (let i = 1; i < a.length; i++) m = Math.min(m, a[i] - a[i - 1]);
  return m;
}

/** Делитель 360 / 180, не крупнее want и не мельче lo. */
function fit(span: number, want: number, lo: number): number {
  const w = Math.max(lo, Math.min(want, span));
  return span / Math.ceil(span / w);
}

/** Сила света тела типа C в направлении (C, γ); для осевой — одна плоскость. */
export function bodyIntensity(p: Photometry, c: number, g: number): number {
  if (p.symmetry === 'axial' || p.hAngles.length === 1) return planeValue(p, 0, g);
  return intensityC(p, c, g);
}

/** Строит сетку поверхности. p — фотометрия типа C (summary.asC). */
export function buildBody(p: Photometry, opts: BodyOptions = {}): BodyMesh {
  const pk = peak(p).value;
  const scale = opts.scale && opts.scale > 0 ? opts.scale : pk || 1;
  const axial = p.symmetry === 'axial' || p.hAngles.length === 1;
  const cStep = opts.cStep ?? fit(360, axial ? 5 : Math.min(5, minGap(p.hAngles)), 2);
  const gStep = opts.gStep ?? fit(180, Math.min(2.5, minGap(p.vAngles)), 1);
  const nc = Math.round(360 / cStep); // C = 360° совпадает с 0°, замыкаем индексами
  const ng = Math.round(180 / gStep) + 1;
  const positions = new Float32Array(nc * ng * 3);
  const relative = new Float32Array(nc * ng);
  for (let i = 0; i < nc; i++) {
    const c = i * cStep;
    const cc = Math.cos(c * RAD);
    const sc = Math.sin(c * RAD);
    for (let j = 0; j < ng; j++) {
      const g = j * gStep;
      const I = Math.max(0, bodyIntensity(p, c, g));
      const r = I / scale;
      const sg = Math.sin(g * RAD);
      const k = i * ng + j;
      positions[k * 3] = r * sg * cc;
      positions[k * 3 + 1] = r * sg * sc;
      positions[k * 3 + 2] = -r * Math.cos(g * RAD);
      relative[k] = pk > 0 ? I / pk : 0;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nc; i++) {
    const i2 = (i + 1) % nc;
    for (let j = 0; j < ng - 1; j++) {
      const a = i * ng + j;
      const b = i2 * ng + j;
      const c = i2 * ng + j + 1;
      const d = i * ng + j + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  return { positions, relative, indices: new Uint32Array(idx), nc, ng, peak: pk };
}

/** Линия плоскости C–(C + 180°) поверхности: точки от надира через C к зениту и обратно через C + 180°. */
export function planeCurve(p: Photometry, c: number, scale: number, gStep = 1): Float32Array {
  const pts: number[] = [];
  const s = scale > 0 ? scale : 1;
  for (const [cc, dir] of [[c, 1], [c + 180, -1]] as const) {
    const n = Math.round(180 / gStep);
    for (let k = 0; k <= n; k++) {
      const g = dir > 0 ? k * gStep : 180 - k * gStep;
      const r = Math.max(0, bodyIntensity(p, cc, g)) / s;
      const sg = Math.sin(g * RAD);
      pts.push(r * sg * Math.cos(cc * RAD), r * sg * Math.sin(cc * RAD), -r * Math.cos(g * RAD));
    }
  }
  return new Float32Array(pts);
}

// ——— общее для просмотра (без three.js, чтобы не тянуть его в основной бандл) ———

/** Связь камер нескольких окон (до / после): поворот одного повторяют остальные. */
export interface CameraLink {
  subs: Set<(pos: number[], target: number[], from: unknown) => void>;
}
export const createCameraLink = (): CameraLink => ({ subs: new Set() });

export type View3D = 'iso' | 'front' | 'side' | 'below' | 'above';
export const VIEWS: View3D[] = ['iso', 'front', 'side', 'below', 'above'];

/** Цвет по относительной силе света: бледно-жёлтый (как заливка каталога) → оранжевый → тёмно-красный. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [1.0, 0.99, 0.86]],
  [0.5, [1.0, 0.78, 0.3]],
  [0.85, [0.93, 0.42, 0.14]],
  [1, [0.75, 0.18, 0.1]],
];

export function rampColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (x <= t1) {
      const u = (x - t0) / (t1 - t0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Та же шкала для легенды (CSS-градиент). */
export const RAMP_CSS = `linear-gradient(90deg, ${STOPS.map(([t, c]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')}) ${t * 100}%`).join(', ')})`;
