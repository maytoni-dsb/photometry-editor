// Запись: фактическая симметрия полной сетки попадает в Isym LDT и в последний угол C IES; размеры LDT/IES.
import { describe, expect, it } from 'vitest';
import { parseLDT, parseIES, symmetrize, rotate } from '../src/core/index';
import { houseIES, houseLDT } from '../src/batch/house';
import { asym as asymFn, makeC } from './helpers';

const asym = () => makeC((c, g) => asymFn(c, g) + 30 * Math.cos((2 * (c - 10) * Math.PI) / 180) * (g <= 90 ? 1 : 0), { cStep: 15, gStep: 5 });

const ctx = { user: 'T. Tester', version: '0.0.0', date: '17.11.2026' };
const ldtLines = (t: string) => t.split(/\r?\n/);

describe('запись симметрии и размеров', () => {
  it('XZ + YZ (четыре квадранта) → Isym 4, хранятся C0…C90', () => {
    const q = symmetrize(asym(), 'quadrant').photometry;
    const text = houseLDT(q, ctx, 'a.ldt');
    expect(ldtLines(text)[2].trim()).toBe('4');
    const back = parseLDT(text).photometry;
    expect(back.symmetry).toBe('quadrant');
    expect(back.hAngles[0]).toBe(0);
    expect(back.hAngles[back.hAngles.length - 1]).toBe(90);
  });

  it('полная сетка с симметрией по квадрантам (после операций) тоже даёт Isym 4', () => {
    const full = symmetrize(symmetrize(asym(), 'quadrant').photometry, 'none').photometry;
    expect(full.symmetry).toBe('none');
    const text = houseLDT(full, ctx, 'a.ldt');
    expect(ldtLines(text)[2].trim()).toBe('4');
    const ies = parseIES(houseIES(full, ctx)).photometry;
    expect(ies.hAngles[ies.hAngles.length - 1]).toBe(90);
  });

  it('несимметричный файл остаётся Isym 0', () => {
    const r = rotate(asym(), 'z', 17).photometry;
    expect(ldtLines(houseLDT(r, ctx, 'a.ldt'))[2].trim()).toBe('0');
  });

  it('LDT: длина (строка 13) — вдоль C90, ширина (строка 14) — вдоль C0; IES: width вдоль C90, length вдоль C0', () => {
    const p = asym();
    p.luminaire = { shape: 'rect', length: 1200, width: 60, height: 50 };
    p.luminous = { shape: 'rect', length: 1150, width: 40, height: 0 };
    const l = ldtLines(houseLDT(p, ctx, 'a.ldt'));
    expect(Number(l[12])).toBe(1200);
    expect(Number(l[13])).toBe(60);
    expect(Number(l[15])).toBe(1150);
    expect(Number(l[16])).toBe(40);
    const ies = houseIES(p, ctx);
    const geo = ies.split(/\r?\n/).find((s) => /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+/.test(s) && !s.startsWith('['))!;
    const t = geo.trim().split(/\s+/).map(Number);
    expect(t[7]).toBeCloseTo(1.15, 6); // width (вдоль C90)
    expect(t[8]).toBeCloseTo(0.04, 6); // length (вдоль C0)
    expect(parseIES(ies).photometry.luminous).toMatchObject({ length: 1150, width: 40 });
  });
});
