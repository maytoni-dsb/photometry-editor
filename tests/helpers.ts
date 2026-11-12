import { emptyDimensions, emptyMetadata, storedPlanesFor, type Photometry, type Symmetry } from '../src/core/index';

/** Синтетическая фотометрия типа C: I = f(C, γ) на сетке с заданной симметрией. */
export function makeC(
  f: (c: number, g: number) => number,
  opts: { symmetry?: Symmetry; cStep?: number; gStep?: number; gMax?: number; flux?: number | null } = {},
): Photometry {
  const symmetry = opts.symmetry ?? 'none';
  const cStep = opts.cStep ?? 15;
  const gStep = opts.gStep ?? 5;
  const gMax = opts.gMax ?? 180;
  const hAngles = storedPlanesFor(symmetry, cStep);
  const vAngles: number[] = [];
  for (let g = 0; g <= gMax + 1e-9; g += gStep) vAngles.push(g);
  const absolute = opts.flux == null;
  return {
    photometryType: 'C',
    symmetry,
    hAngles,
    vAngles,
    candela: hAngles.map((c) => vAngles.map((g) => f(c, g))),
    absolute,
    lamps: [{ count: absolute ? -1 : 1, flux: opts.flux ?? null, type: 'LED', cct: '3000', cri: '90', watts: 10 }],
    inputWatts: 10,
    luminaire: { shape: 'rect', length: 600, width: 100, height: 50 },
    luminous: { shape: 'rect', length: 580, width: 80, height: 0 },
    meta: { ...emptyMetadata(), manufacturer: 'TEST', luminaireName: 'Series', article: 'ART-001' },
    source: { format: 'none', fileName: '', encoding: 'utf-8', lineEnding: 'LF' },
  };
}

export const point = emptyDimensions;

/** Асимметричное распределение без симметрии — для проверки ориентации плоскостей. */
export const asym = (c: number, g: number) => (g <= 90 ? (100 + 50 * Math.cos(((c - 30) * Math.PI) / 180)) * Math.cos((g * Math.PI) / 180) : 0);

/** Распределение с симметрией относительно C0–C180: I(C) = I(360 − C). */
export const symC0 = (c: number, g: number) => (g <= 90 ? (100 + 40 * Math.cos((c * Math.PI) / 180)) * Math.cos((g * Math.PI) / 180) : 0);

/** Симметрия относительно C90–C270: I(C) = I(180 − C). */
export const symC90 = (c: number, g: number) => (g <= 90 ? (100 + 40 * Math.sin((c * Math.PI) / 180)) * Math.cos((g * Math.PI) / 180) : 0);

/** Симметрия по обеим плоскостям. */
export const symQuad = (c: number, g: number) => (g <= 90 ? (100 + 40 * Math.cos((2 * c * Math.PI) / 180)) * Math.cos((g * Math.PI) / 180) : 0);

export const lambert = (_c: number, g: number) => (g <= 90 ? 1000 * Math.cos((g * Math.PI) / 180) : 0);
