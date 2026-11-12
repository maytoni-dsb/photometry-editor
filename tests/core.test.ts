import { describe, expect, it } from 'vitest';
import {
  computeFlux,
  diffIntensity,
  foldC,
  fullPlanes,
  intensityC,
  parseIES,
  parseLDT,
  writeIES,
  writeLDT,
  type Symmetry,
} from '../src/core/index';
import { asym, lambert, makeC, symC0, symC90, symQuad } from './helpers';

describe('углы и симметрия', () => {
  it('свёртка C для каждой симметрии', () => {
    expect(foldC('c0c180', 300)).toBe(60);
    expect(foldC('quadrant', 200)).toBe(20);
    expect(foldC('quadrant', 300)).toBe(60);
    expect(foldC('c90c270', 30)).toBe(150);
    expect(foldC('c90c270', 300)).toBe(240);
    expect(foldC('axial', 123)).toBe(0);
  });

  it('интерполяция совпадает с функцией в узлах и между ними', () => {
    const p = makeC(asym, { cStep: 5, gStep: 1 });
    expect(intensityC(p, 30, 0)).toBeCloseTo(150, 6);
    expect(intensityC(p, 32.5, 10)).toBeCloseTo(asym(32.5, 10), 0);
    expect(intensityC(p, 357.5, 0)).toBeCloseTo((asym(355, 0) + asym(0, 0)) / 2, 6);
  });

  it('разворот симметрии в полный круг', () => {
    const p = makeC(symQuad, { symmetry: 'quadrant', cStep: 15 });
    const planes = fullPlanes(p);
    expect(planes.length).toBe(24);
    for (const pl of planes) expect(pl.values[0]).toBeCloseTo(symQuad(pl.c, 0), 6);
  });
});

describe('световой поток', () => {
  it('равномерный источник 1 кд → 4π лм', () => {
    const p = makeC(() => 1, { symmetry: 'axial', gStep: 1 });
    expect(computeFlux(p).total).toBeCloseTo(4 * Math.PI, 3);
  });

  it('ламбертовский источник I0·cosγ → π·I0, весь поток вниз', () => {
    const p = makeC(lambert, { cStep: 10, gStep: 1 });
    const f = computeFlux(p);
    expect(f.total / (Math.PI * 1000)).toBeCloseTo(1, 3);
    expect(f.up).toBeLessThan(1e-9);
  });

  it('поток не зависит от способа хранения симметрии', () => {
    const full = computeFlux(makeC(symQuad, { cStep: 5, gStep: 1 })).total;
    const quad = computeFlux(makeC(symQuad, { symmetry: 'quadrant', cStep: 5, gStep: 1 })).total;
    expect(quad).toBeCloseTo(full, 6);
  });
});

const cases: Array<[Symmetry, (c: number, g: number) => number]> = [
  ['none', asym],
  ['axial', lambert],
  ['c0c180', symC0],
  ['c90c270', symC90],
  ['quadrant', symQuad],
];

describe('запись и повторное чтение', () => {
  for (const [sym, f] of cases) {
    it(`IES, симметрия ${sym}`, () => {
      const p = makeC(f, { symmetry: sym, cStep: 15 });
      const back = parseIES(writeIES(p)).photometry;
      expect(back.symmetry).toBe(sym);
      expect(diffIntensity(p, back).maxRelToPeak).toBeLessThan(1e-5);
      expect(back.meta.article).toBe('ART-001');
      expect(back.meta.luminaireName).toBe('Series');
    });

    it(`LDT, симметрия ${sym}`, () => {
      const p = makeC(f, { symmetry: sym, cStep: 15 });
      const back = parseLDT(writeLDT(p).text).photometry;
      expect(back.symmetry).toBe(sym);
      expect(diffIntensity(p, back).maxRelToPeak).toBeLessThan(1e-5);
      expect(back.absolute).toBe(true);
    });

    it(`IES → LDT → IES, симметрия ${sym}`, () => {
      const p = makeC(f, { symmetry: sym, cStep: 15 });
      const ldt = parseLDT(writeLDT(parseIES(writeIES(p)).photometry).text).photometry;
      const ies = parseIES(writeIES(ldt)).photometry;
      expect(diffIntensity(p, ies).maxRelToPeak).toBeLessThan(1e-5);
    });
  }

  it('несимметричный файл: ориентация C-плоскостей сохраняется при конвертации', () => {
    const p = makeC(asym, { cStep: 15 });
    const ldt = parseLDT(writeLDT(p).text).photometry;
    // максимум у C30 (см. asym)
    expect(intensityC(ldt, 30, 0)).toBeCloseTo(150, 3);
    expect(intensityC(ldt, 210, 0)).toBeCloseTo(50, 3);
  });

  it('относительная фотометрия: LDT хранит кд/клм, поток ламп сохраняется', () => {
    const p = makeC(lambert, { symmetry: 'axial', flux: 5000 });
    const text = writeLDT(p).text;
    const lines = text.split('\r\n');
    expect(lines[26]).toBe('1'); // число ламп
    expect(lines[28]).toBe('5000'); // поток ламп
    const back = parseLDT(text).photometry;
    expect(back.absolute).toBe(false);
    expect(intensityC(back, 0, 0)).toBeCloseTo(1000, 3);
    const ies = parseIES(writeIES(back)).photometry;
    expect(ies.absolute).toBe(false);
    expect(ies.lamps[0].flux).toBeCloseTo(5000, 6);
  });

  it('абсолютная фотометрия: LDT с −1 лампой и потоком светильника', () => {
    const p = makeC(lambert, { symmetry: 'axial', gStep: 1 });
    const lines = writeLDT(p).text.split('\r\n');
    expect(lines[26]).toBe('-1');
    expect(Number(lines[28])).toBeCloseTo(Math.PI * 1000, 0);
  });
});
