/** История документа: «Удалить текущее состояние», признак «изменён» после сохранения. */
import { describe, expect, it } from 'vitest';
import { applyStep, deleteCurrent, isModified, liveChain, liveCount, newDoc, redo, undo, type OpenFile } from '../src/app/doc';
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

describe('live chain', () => {
  const p0 = makeC(lambert, { cStep: 30, gStep: 10 });
  const scaled = (k: number) => ({ ...p0, candela: p0.candela.map((r) => r.map((x) => x * k)) });
  const res = (k: number) => ({ p: scaled(k), issues: [], label: `x${k}`, work: undefined as never });

  it('rebuilds the steps of one session from its base', () => {
    const f0 = newDoc('a.ies', p0, [], 'open');
    const base = f0.summary;
    const f1 = liveChain(f0, 's1', base, [res(2)]);
    expect(f1.past.length).toBe(1);
    expect(liveCount(f1, 's1')).toBe(1);
    const f2 = liveChain(f1, 's1', base, [res(3), res(4)]);
    expect(f2.past.length).toBe(2);
    expect(f2.past[1].label).toBe('x3');
    expect(f2.label).toBe('x4');
    expect(liveCount(f2, 's1')).toBe(2);
    const f3 = liveChain(f2, 's1', base, []);
    expect(f3.past.length).toBe(0);
    expect(f3.summary).toBe(base);
    // после другой правки сеанс устарел — ничего не делается
    const f4 = applyStep(f2, scaled(5), [], 'other');
    expect(liveCount(f4, 's1')).toBe(0);
    expect(liveChain(f4, 's1', base, [res(2)])).toBe(f4);
    // отмена шага сеанса: остался шаг x3 сеанса — liveCount 1, сеанс в панели считается устаревшим
    expect(liveCount(undo(f2), 's1')).toBe(1);
  });
});
