import { describe, expect, it } from 'vitest';
import { buildBody, housingBox, meshCStep, meshLines, planeCurve } from '../src/charts/body3d';
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

  it('сетка тела: точки лежат на поверхности, меридианы через шаг файла', () => {
    const p = makeC(lambert, { symmetry: 'axial', gStep: 5 });
    expect(meshCStep(p)).toBe(15);
    const l = meshLines(p, 1000, 15, 10);
    expect(l.length % 6).toBe(0);
    // ламберт: точка на расстоянии cos γ от центра → |r|² = −z·r (сфера, касающаяся центра)
    for (let k = 0; k < l.length; k += 3) {
      const r2 = l[k] ** 2 + l[k + 1] ** 2 + l[k + 2] ** 2;
      expect(r2).toBeCloseTo(-l[k + 2], 2); // между узлами 5° — линейная интерполяция
    }
  });

  it('корпус: LDT — корпус и светящая часть, IES — светящая часть; наибольший размер = треть радиуса', () => {
    const p = makeC(lambert, { symmetry: 'axial' });
    p.source.format = 'LDT';
    const h = housingBox(p)!;
    expect(h.shape).toBe('rect');
    expect(Math.max(h.length, h.width, h.height)).toBeCloseTo(0.32, 9);
    expect(h.length / h.width).toBeCloseTo(600 / 100, 9);
    expect(h.luminous!.length / h.length).toBeCloseTo(580 / 600, 9);
    p.source.format = 'IES';
    p.luminaire = { shape: 'point', length: 0, width: 0, height: 0 };
    const i = housingBox(p)!;
    expect(i.luminous).toBeNull();
    expect(i.length / i.width).toBeCloseTo(580 / 80, 9);
    p.luminous = { shape: 'point', length: 0, width: 0, height: 0 };
    expect(housingBox(p)).toBeNull();
  });
});
