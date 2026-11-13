import { describe, expect, it } from 'vitest';
import { buildBody, planeCurve, rampColor } from '../src/charts/body3d';
import { rotate } from '../src/core/index';
import { asym, lambert, makeC } from './helpers';

const radius = (pos: Float32Array, k: number) => Math.hypot(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);

describe('3D-тело: геометрия', () => {
  it('ламбертовский источник: радиус 1 в надире, 0 на горизонте и выше', () => {
    const m = buildBody(makeC(lambert, { symmetry: 'axial', gStep: 5 }));
    expect(m.nc).toBe(72);
    expect(m.ng).toBe(73); // шаг γ 2,5°
    expect(m.indices.length).toBe(72 * 72 * 6);
    expect(m.positions[2]).toBeCloseTo(-1, 6); // надир вниз (Z)
    for (let i = 0; i < m.nc; i++) for (let j = 36; j < m.ng; j++) expect(radius(m.positions, i * m.ng + j)).toBeCloseTo(0, 6);
    expect(Math.max(...m.relative)).toBeCloseTo(1, 9);
  });

  it('ориентация: пучок, наклонённый поворотом X +90°, смотрит в +Y (C90)', () => {
    const p = rotate(makeC(lambert, { cStep: 15, gStep: 5 }), 'x', 90).photometry;
    const m = buildBody(p);
    let best = 0;
    let at = 0;
    for (let k = 0; k < m.relative.length; k++) if (m.relative[k] > best) [best, at] = [m.relative[k], k];
    expect(m.positions[at * 3 + 1]).toBeCloseTo(1, 2); // y
    expect(Math.abs(m.positions[at * 3])).toBeLessThan(0.05);
    expect(Math.abs(m.positions[at * 3 + 2])).toBeLessThan(0.05);
  });

  it('общий масштаб: тело вдвое слабее — радиус 0,5', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const m = buildBody(p, { scale: 2 * buildBody(p).peak });
    let r = 0;
    for (let k = 0; k < m.relative.length; k++) r = Math.max(r, radius(m.positions, k));
    expect(r).toBeCloseTo(0.5, 2);
  });

  it('линия плоскости C0–C180 лежит в плоскости XZ', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const pts = planeCurve(p, 0, 150);
    for (let k = 0; k < pts.length; k += 3) expect(Math.abs(pts[k + 1])).toBeLessThan(1e-9);
  });

  it('цветовая шкала монотонна по яркости', () => {
    const lum = (t: number) => rampColor(t).reduce((s, x, i) => s + x * [0.3, 0.59, 0.11][i], 0);
    for (let t = 0.1; t <= 1; t += 0.1) expect(lum(t)).toBeLessThan(lum(t - 0.1) + 1e-9);
  });
});
