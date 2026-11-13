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

/**
 * Сетка тела (вид «mesh», без условных цветов): меридианы — плоскости C через cEvery°,
 * параллели — конусы γ через gEvery°. Отрезки парами точек (x, y, z), фотометрические оси.
 */
export function meshLines(p: Photometry, scale: number, cEvery = 15, gEvery = 10): Float32Array {
  const s = scale > 0 ? scale : 1;
  const pts: number[] = [];
  const point = (c: number, g: number): [number, number, number] => {
    const r = Math.max(0, bodyIntensity(p, c, g)) / s;
    const sg = Math.sin(g * RAD);
    return [r * sg * Math.cos(c * RAD), r * sg * Math.sin(c * RAD), -r * Math.cos(g * RAD)];
  };
  const seg = (a: [number, number, number], b: [number, number, number]) => {
    // нулевые отрезки (тело стянулось в центр) не рисуем
    if (Math.hypot(a[0], a[1], a[2]) < 1e-6 && Math.hypot(b[0], b[1], b[2]) < 1e-6) return;
    pts.push(...a, ...b);
  };
  for (let c = 0; c < 360 - 1e-9; c += cEvery) {
    let prev = point(c, 0);
    for (let g = 1; g <= 180; g += 1) {
      const cur = point(c, g);
      seg(prev, cur);
      prev = cur;
    }
  }
  for (let g = gEvery; g < 180 - 1e-9; g += gEvery) {
    let prev = point(0, g);
    for (let c = 2; c <= 360; c += 2) {
      const cur = point(c, g);
      seg(prev, cur);
      prev = cur;
    }
  }
  return new Float32Array(pts);
}

/** Шаг меридианов сетки: шаг плоскостей файла, но не мельче 10° и не крупнее 30°, делитель 360. */
export function meshCStep(p: Photometry): number {
  const axial = p.symmetry === 'axial' || p.hAngles.length === 1;
  const want = axial ? 15 : Math.min(30, Math.max(10, minGap(p.hAngles)));
  return fit(360, want, 10);
}

/** Корпус светильника для 3D-вида, в единицах тела (радиус 1 = масштаб силы света). */
export interface HousingBox {
  shape: 'rect' | 'circle';
  /** Вдоль C0 (X), поперёк (Y, для круга = length), высота (вверх от светящей части). */
  length: number;
  width: number;
  height: number;
  /** Светящая часть на нижней грани (LDT); null — не показывать. */
  luminous: { shape: 'rect' | 'circle'; length: number; width: number } | null;
  /** Миллиметров на единицу тела — для подписи масштаба. */
  mmPerUnit: number;
}

/**
 * Корпус в масштабе тела: размеры в мм и силы света в кд несоизмеримы, поэтому наибольший размер
 * корпуса делается долей radiusShare радиуса тела — корпус виден, но не заслоняет тело.
 * IES хранит только размеры светящей части — она и показывается как корпус.
 */
export function housingBox(p: Photometry, radiusShare = 0.32): HousingBox | null {
  const ldt = p.source.format === 'LDT' || (p.luminaire.length > 0 && p.luminaire.shape !== 'point');
  const body = ldt && p.luminaire.length > 0 ? p.luminaire : p.luminous;
  if (body.shape === 'point' || !(body.length > 0)) return null;
  const circle = body.shape === 'circle';
  const L = body.length;
  const W = circle ? body.length : body.width;
  const H = body.height;
  const k = radiusShare / Math.max(L, W || 0, H || 0);
  const lum = ldt && body === p.luminaire && p.luminous.length > 0 && p.luminous.shape !== 'point' ? p.luminous : null;
  return {
    shape: circle ? 'circle' : 'rect',
    length: L * k,
    width: (W || L * 0.05) * k,
    height: Math.max(H * k, 0.004),
    luminous: lum
      ? { shape: lum.shape === 'circle' ? 'circle' : 'rect', length: lum.length * k, width: (lum.shape === 'circle' ? lum.length : lum.width) * k }
      : null,
    mmPerUnit: 1 / k,
  };
}
