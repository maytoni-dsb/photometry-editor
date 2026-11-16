/**
 * Рабочее тело операций (2D-интерполянт), правки 16.11.2026.
 */

import { describe, expect, it } from 'vitest';
import { applyWork, computeFlux, denseFrom, peak, pchip, sample, sumWorks, workFrom, type Photometry, type Work } from '../src/core/index';
import { asym, lambert, makeC } from './helpers';

const flux = (p: Photometry) => computeFlux(p).total;
const chain = (w: Work, ...specs: Parameters<typeof applyWork>[1][]) => {
  let cur = w;
  let p: Photometry | null = null;
  for (const s of specs) {
    const r = applyWork(cur, s);
    cur = r.work;
    p = r.photometry;
  }
  return { work: cur, p: p! };
};
/** Узкий несимметричный пучок: лепесток в C30, γ 20°. */
const lobe = (c: number, g: number) => {
  const dc = ((((c - 30) % 360) + 540) % 360) - 180;
  return 1000 * Math.exp(-((dc / 25) ** 2) - ((g - 20) / 12) ** 2);
};

describe('интерполянт', () => {
  it('PCHIP: точно в узлах, без выбросов, монотонен на монотонных данных', () => {
    const x = [0, 10, 20, 30];
    const y = [0, 0, 100, 100];
    const xs = Array.from({ length: 31 }, (_, i) => i);
    const v = pchip(x, y, xs);
    expect(v[0]).toBe(0);
    expect(v[20]).toBe(100);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1] - 1e-12);
    expect(Math.max(...v)).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('плотная сетка содержит узлы файла, выборка на сетку файла даёт исходные значения точно', () => {
    for (const p of [makeC(asym, { cStep: 15, gStep: 5 }), makeC(lambert, { symmetry: 'axial', gStep: 2.5 }), makeC(asym, { cStep: 22.5, gStep: 10, symmetry: 'c0c180' })]) {
      const d = denseFrom(p);
      expect(d.symmetry).toBe('none');
      expect(d.hAngles[1] - d.hAngles[0]).toBeLessThanOrEqual(2 + 1e-9);
      expect(d.vAngles[1] - d.vAngles[0]).toBeLessThanOrEqual(1 + 1e-9);
      const back = sample(d, { symmetry: p.symmetry, hAngles: p.hAngles, vAngles: p.vAngles });
      back.candela.forEach((row, i) => row.forEach((x, j) => expect(x).toBeCloseTo(p.candela[i][j], 9)));
    }
  });
});

describe('операции над рабочим телом', () => {
  it('смена сетки обратима: туда и обратно — исходные значения', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const { work } = workFrom(p);
    const r = chain(work, { op: 'regrid', cStep: 7.5, gStep: 2.5 }, { op: 'regrid', cStep: 30, gStep: 10 }, { op: 'regrid', cStep: 15, gStep: 5 });
    expect(r.p.hAngles).toEqual(p.hAngles);
    r.p.candela.forEach((row, i) => row.forEach((x, j) => expect(x).toBeCloseTo(p.candela[i][j], 9)));
  });

  it('симметризация не уменьшает сетку C', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const { work } = workFrom(p);
    for (const symmetry of ['axial', 'c0c180', 'c90c270', 'quadrant'] as const) {
      const r = applyWork(work, { op: 'symmetrize', symmetry });
      expect(r.photometry.hAngles).toEqual(p.hAngles);
      expect(r.photometry.symmetry).toBe('none');
      expect(flux(r.photometry)).toBeCloseTo(flux(p), -1);
    }
    // осевая: все плоскости одинаковы
    const ax = applyWork(work, { op: 'symmetrize', symmetry: 'axial' }).photometry;
    ax.candela.forEach((row) => row.forEach((x, j) => expect(x).toBeCloseTo(ax.candela[0][j], 6)));
  });

  it('поворот вокруг Z не «дышит»: Iмакс и поток почти не зависят от угла, 4 × 90° = исходное', () => {
    const p = makeC(lobe, { cStep: 15, gStep: 5 });
    const { work } = workFrom(p);
    const peaks: number[] = [];
    for (let a = 0; a <= 45; a += 3) {
      const d = applyWork(work, { op: 'rotate', axis: 'z', angle: a }).work.dense;
      peaks.push(peak(d).value);
    }
    const spread = (Math.max(...peaks) - Math.min(...peaks)) / Math.max(...peaks);
    expect(spread).toBeLessThan(0.03);
    // для сравнения: прежний способ (интерполяция на сетку 15°) теряет у лепестка больше
    const r = chain(work, ...Array.from({ length: 4 }, () => ({ op: 'rotate' as const, axis: 'z' as const, angle: 90 })));
    r.p.candela.forEach((row, i) => row.forEach((x, j) => expect(x).toBeCloseTo(p.candela[i][j], 6)));
  });

  it('нормировка — точно по файлу, хотя считается на рабочем теле', () => {
    const p = makeC(lobe, { cStep: 15, gStep: 5 });
    const { work } = workFrom(p);
    const r = chain(work, { op: 'rotate', axis: 'x', angle: 33 }, { op: 'normalize', mode: 'flux', value: 1234 });
    expect(flux(r.p)).toBeCloseTo(1234, 6);
    const q = chain(work, { op: 'normalize', mode: 'peak', value: 777 });
    expect(peak(q.p).value).toBeCloseTo(777, 6);
  });

  it('осевое тело после поворота X раскрывается на полную сетку, обратный поворот возвращает осевое тело', () => {
    const p = makeC(lambert, { symmetry: 'axial', gStep: 5, flux: 1000 });
    const { work } = workFrom(p);
    const r1 = applyWork(work, { op: 'rotate', axis: 'x', angle: 40 });
    expect(r1.photometry.symmetry).not.toBe('axial');
    const r2 = applyWork(r1.work, { op: 'rotate', axis: 'x', angle: -40 });
    const back = sample(r2.work.dense, { symmetry: 'axial', hAngles: [0], vAngles: p.vAngles });
    // два поворота с интерполяцией по плотной сетке: расхождение — доли процента от Iмакс
    back.candela[0].forEach((x, j) => expect(Math.abs(x - p.candela[0][j])).toBeLessThan(0.002 * 1000));
  });

  it('сглаживание сохраняет поток файла', () => {
    const p = makeC(lobe, { cStep: 15, gStep: 5 });
    const { work } = workFrom(p);
    const r = applyWork(work, { op: 'smooth', width: 10 });
    expect(flux(r.photometry)).toBeCloseTo(flux(p), 6);
    expect(peak(r.photometry).value).toBeLessThan(peak(p).value);
  });

  it('сглаживание шириной 30° на плотной сетке — меньше 3 с', () => {
    const p = makeC(lobe, { cStep: 15, gStep: 5 });
    const { work } = workFrom(p);
    const t0 = Date.now();
    applyWork(work, { op: 'smooth', width: 30 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('сложение двух копий = удвоенный поток', () => {
    const p = makeC(lobe, { cStep: 15, gStep: 5 });
    const { work } = workFrom(p);
    const r = sumWorks([{ work, weight: 1 }, { work, weight: 1 }]);
    expect(flux(r.photometry)).toBeCloseTo(2 * flux(p), 6);
  });
});
