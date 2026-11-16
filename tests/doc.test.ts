/** История документа: «Удалить текущее состояние», признак «изменён» после сохранения. */
import { describe, expect, it } from 'vitest';
import { applyStep, deleteCurrent, isModified, liveStep, newDoc, redo, undo, type OpenFile } from '../src/app/doc';
import { lambert, makeC } from './helpers';

describe('doc history', () => {
  const p0 = makeC(lambert, { cStep: 30, gStep: 10 });
  const scaled = (k: number) => ({ ...p0, candela: p0.candela.map((r) => r.map((x) => x * k)) });

  it('deleteCurrent drops the current state and the redo branch', () => {
    let f = newDoc('a.ies', p0, [], 'open');
    f = applyStep(f, scaled(2), [], 'x2');
    f = applyStep(f, scaled(3), [], 'x3');
    f = undo(f);
    expect(f.future.length).toBe(1);
    const g = deleteCurrent(f);
    expect(g.past.length).toBe(0);
    expect(g.future.length).toBe(1); // ветка «повторить» остаётся как была
    expect(g.parse.photometry.candela[0][0]).toBeCloseTo(p0.candela[0][0]);
    expect(deleteCurrent(g)).toBe(g); // исходное состояние не удаляется
    expect(redo(g).parse.photometry.candela[0][0]).toBeCloseTo(p0.candela[0][0] * 3);
  });

  it('isModified follows savedLen', () => {
    let f: OpenFile = { ...newDoc('a.ies', p0, [], 'open'), derived: undefined };
    f = applyStep(f, scaled(2), [], 'x2');
    expect(isModified({ ...f, savedLen: 1 })).toBe(false);
    expect(isModified({ ...f, savedLen: 0 })).toBe(true);
    const back = deleteCurrent({ ...f, savedLen: 1 });
    expect(back.savedLen).toBe(0);
    expect(isModified(back)).toBe(false);
  });
});

describe('live step', () => {
  const p0 = makeC(lambert, { cStep: 30, gStep: 10 });
  const scaled = (k: number) => ({ ...p0, candela: p0.candela.map((r) => r.map((x) => x * k)) });
  const res = (k: number) => ({ p: scaled(k), issues: [], label: `x${k}`, work: undefined as never });

  it('adds, replaces and removes the step of one session', () => {
    const f0 = newDoc('a.ies', p0, [], 'open');
    const base = f0.summary;
    const f1 = liveStep(f0, base, { ...res(2), work: f0.work! });
    expect(f1.past.length).toBe(1);
    const f2 = liveStep(f1, base, { ...res(3), work: f0.work! });
    expect(f2.past.length).toBe(1);
    expect(f2.label).toBe('x3');
    const f3 = liveStep(f2, base, null);
    expect(f3.past.length).toBe(0);
    expect(f3.summary).toBe(base);
    // файл ушёл от base (отмена до исходного и другой шаг) — ничего не делается
    const other = applyStep(f0, scaled(5), [], 'other');
    const f4 = applyStep(other, scaled(6), [], 'other2');
    expect(liveStep(f4, base, res(2))).toBe(f4);
  });
});
