import { describe, expect, it } from 'vitest';
import { summarize } from '../src/core/index';
import { lampArticle, savePlan, sourceSuffix, sourceVariant } from '../src/batch/sources';
import { lambert, makeC } from './helpers';

const lamp = (o: Partial<{ count: number; flux: number; type: string; cct: string }>) => ({ count: 1, flux: 1000, type: 'LED', cct: '', cri: '', watts: 10, ...o });

describe('light sources', () => {
  it('lamp article and suffixes', () => {
    expect(lampArticle(lamp({ type: 'LED / GU10-7W-3K' }))).toBe('GU10-7W-3K');
    expect(lampArticle(lamp({ type: 'LED' }))).toBe('');
    const p = makeC(lambert, { cStep: 30, gStep: 10 });
    p.absolute = false;
    p.lamps = [lamp({ type: 'LED / L1' }), lamp({ type: 'LED / L2', flux: 500 })];
    expect(sourceSuffix(p, 1)).toBe('L2');
    p.absolute = true;
    p.lamps = [lamp({ cct: '3000' }), lamp({ cct: '4000K', flux: 1200 })];
    expect(sourceSuffix(p, 1)).toBe('4000K');
  });

  it('variant scales intensities by flux', () => {
    const p = makeC(lambert, { cStep: 30, gStep: 10 });
    const f0 = summarize(p).flux.total;
    p.absolute = true;
    p.lamps = [lamp({ flux: f0, cct: '3000' }), lamp({ flux: f0 * 2, cct: '4000' })];
    const v = sourceVariant(p, 1);
    expect(summarize(v).flux.total).toBeCloseTo(f0 * 2, 3);
    expect(v.lamps).toHaveLength(1);
    expect(v.lamps[0].count).toBe(-1);
  });

  it('save plan', () => {
    const p = makeC(lambert, { cStep: 30, gStep: 10 });
    p.absolute = true;
    p.lamps = [lamp({ cct: '3000' }), lamp({ cct: '4000' })];
    const plan = savePlan(p, 'ART', { ies: true, ldt: true, iesMode: 'each', ldtMode: 'all', source: 0 });
    expect(plan.map((x) => `${x.base}.${x.fmt}`)).toEqual(['ART @ 3000K.ies', 'ART @ 4000K.ies', 'ART.ldt']);
    expect(plan[2].photometry.lamps).toHaveLength(2);
    const one = savePlan(p, 'ART', { ies: false, ldt: true, iesMode: 'one', ldtMode: 'one', source: 1 });
    expect(one.map((x) => x.base)).toEqual(['ART @ 4000K']);
    p.lamps = [lamp({})];
    expect(savePlan(p, 'ART', { ies: true, ldt: false, iesMode: 'each', ldtMode: 'each', source: 0 }).map((x) => x.base)).toEqual(['ART']);
  });
});

describe('sources from Excel cells', async () => {
  const { lampsFromCells } = await import('../src/batch/lamps-xlsx');
  it('maps Russian and English headers', () => {
    const r = lampsFromCells([
      ['Количество', 'Тип', 'Световой поток, лм', 'Цветовая температура', 'CRI', 'Мощность, Вт'],
      ['2', 'LED / GU10-7W', '1400', '3000K', '90', '14'],
      ['', '', '', '', '', ''],
      ['1', 'LED / GU10-5W', '450,5', '4000', '80', ''],
    ]);
    expect(r).toEqual([
      { count: 2, type: 'LED / GU10-7W', flux: 1400, cct: '3000', cri: '90', watts: 14 },
      { count: 1, type: 'LED / GU10-5W', flux: 450.5, cct: '4000', cri: '80', watts: 0 },
    ]);
    expect(lampsFromCells([['NumberOfLamps', 'LampType', 'LuminousFlux', 'CCT'], ['1', 'LED', '800', '2700']])[0]).toMatchObject({ flux: 800, cct: '2700' });
    expect(lampsFromCells([['foo'], ['1']])).toEqual([]);
  });
});
