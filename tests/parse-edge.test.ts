import { describe, expect, it } from 'vitest';
import {
  checkArticle,
  comparePair,
  computeFlux,
  formatIssue,
  intensityC,
  parseFile,
  parseIES,
  parseLDT,
  typeBToC,
  validatePhotometry,
  writeIES,
  writeLDT,
} from '../src/core/index';
import { lambert, makeC } from './helpers';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('IES: терпимое чтение', () => {
  it('LM-63-1986 без строки версии, значения через запятую и на разных строках', () => {
    const text = [
      'Какой-то текст 1986 года',
      'TILT=NONE',
      '1, 1000, 1, 3, 1, 1, 2, 0, 0, 0',
      '1 1 10',
      '0 45',
      '90',
      '0',
      '100 70.7',
      '0',
    ].join('\r\n');
    const { photometry: p, issues } = parseIES(text);
    expect(codes(issues)).toContain('ies-no-version');
    expect(p.symmetry).toBe('axial');
    expect(p.candela[0]).toEqual([100, 70.7, 0]);
    expect(p.absolute).toBe(false);
    expect(p.lamps[0].flux).toBe(1000);
    expect(p.source.lineEnding).toBe('CRLF');
  });

  it('TILT=INCLUDE, множитель, повторное ключевое слово', () => {
    const text = [
      'IESNA:LM-63-2002',
      '[TEST] R1',
      '[MANUFAC] M',
      '[LUMINAIRE] A',
      '[LUMINAIRE] B',
      '[LUMCAT] ART',
      'TILT=INCLUDE',
      '1',
      '3',
      '0 45 90',
      '1 0.9 0.8',
      '1 -1 2 2 1 1 1 1 2 0',
      '1 1 20',
      '0 90',
      '0',
      '50 10',
    ].join('\n');
    const { photometry: p, issues } = parseIES(text);
    expect(codes(issues)).toEqual(expect.arrayContaining(['ies-duplicate-keyword', 'ies-tilt-include', 'multiplier-not-one']));
    expect(p.meta.luminaireName).toBe('A');
    expect(p.candela[0]).toEqual([100, 20]);
    expect(p.ies?.tiltData?.factors).toEqual([1, 0.9, 0.8]);
    // единицы — футы → мм
    expect(p.luminous.length).toBeCloseTo(609.6, 6);
    const back = parseIES(writeIES(p)).photometry;
    expect(back.ies?.tiltData?.angles).toEqual([0, 45, 90]);
    expect(back.candela[0]).toEqual([100, 20]);
  });

  it('обрезанный файл: недостающие значения = 0 и ошибка', () => {
    const text = ['IESNA:LM-63-2002', 'TILT=NONE', '1 -1 1 3 2 1 2 0 0 0', '1 1 5', '0 45 90', '0 90', '10 5 1', '9 4'].join('\n');
    const { photometry: p, issues } = parseIES(text);
    expect(codes(issues)).toContain('value-count-short');
    expect(p.candela[1]).toEqual([9, 4, 0]);
    expect(p.symmetry).toBe('quadrant');
  });

  it('Windows-1252 распознаётся', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('IESNA:LM-63-2002\n[MANUFAC] Gr'), 0xfc, ...new TextEncoder().encode('n\nTILT=NONE\n1 -1 1 1 1 1 2 0 0 0\n1 1 1\n0\n0\n5\n')]);
    const { photometry: p, issues } = parseIES(bytes);
    expect(p.meta.manufacturer).toBe('Grün');
    expect(codes(issues)).toContain('encoding-fallback');
  });
});

describe('LDT: терпимое чтение', () => {
  /** Минимальный LDT: Isym 1, одна плоскость, n комплектов ламп. */
  const ldt = (o: { isym?: number; mc?: number; dc?: number; data: number[]; sets?: string[][]; cf?: string; ityp?: string }) => {
    const mc = o.mc ?? 1;
    const sets = o.sets ?? [['1', 'LED', '1000', '3000', '90', '10']];
    return [
      'MAN', o.ityp ?? '1', String(o.isym ?? 1), String(mc), String(o.dc ?? 0), '3', '45', 'R1', 'Name', 'ART', 'f.ldt', 'date',
      '100', '0', '10', '90', '0', '0', '0', '0', '0', '100', '100', o.cf ?? '1.0', '0', String(sets.length),
      ...sets.flat(),
      ...Array(10).fill('0'),
      ...Array.from({ length: mc }, (_, i) => String(i * (o.dc ?? 0))),
      '0', '45', '90',
      ...o.data.map(String),
    ].join('\r\n');
  };

  it('несколько комплектов ламп: силы света относятся к первому', () => {
    const text = ldt({ data: [500, 300, 0], sets: [['1', 'A', '2000', '3000', '80', '20'], ['1', 'B', '4000', '4000', '80', '40']] });
    const { photometry: p } = parseLDT(text);
    expect(p.candela[0][0]).toBe(1000); // 500 кд/клм × 2000 лм
    expect(p.lamps.length).toBe(2);
    expect(p.inputWatts).toBe(20);
  });

  it('коэффициент пересчёта и недопустимый Ityp', () => {
    const { photometry: p, issues } = parseLDT(ldt({ data: [500, 300, 0], cf: '0.5', ityp: '49' }));
    expect(p.candela[0][0]).toBe(250);
    expect(codes(issues)).toEqual(expect.arrayContaining(['ldt-conversion-factor', 'ldt-ityp-invalid']));
    const out = writeLDT(p).text.split('\r\n');
    expect(out[1]).toBe('1'); // Ityp исправлен на осевую симметрию
  });

  it('Isym 1, но записаны все плоскости → читается как несимметричный', () => {
    const data = [100, 50, 0, 200, 80, 0, 100, 50, 0, 20, 10, 0];
    const { photometry: p, issues } = parseLDT(ldt({ isym: 1, mc: 4, dc: 90, data }));
    expect(codes(issues)).toContain('isym-all-planes');
    expect(p.symmetry).toBe('none');
    expect(intensityC(p, 90, 0)).toBe(200);
    expect(intensityC(p, 270, 0)).toBe(20);
  });

  it('Isym 0 и одна плоскость → осевая симметрия', () => {
    const { photometry: p, issues } = parseLDT(ldt({ isym: 0, mc: 1, data: [100, 50, 0] }));
    expect(codes(issues)).toContain('isym-single-plane');
    expect(p.symmetry).toBe('axial');
  });

  it('Isym 3: плоскости C270…C90 отражаются в C90…C270', () => {
    // Mc = 4: хранятся C270, C0, C90
    const data = [30, 0, 0, 10, 0, 0, 20, 0, 0];
    const { photometry: p } = parseLDT(ldt({ isym: 3, mc: 4, dc: 90, data }));
    expect(p.symmetry).toBe('c90c270');
    expect(p.hAngles).toEqual([90, 180, 270]);
    expect(intensityC(p, 0, 0)).toBe(10);
    expect(intensityC(p, 180, 0)).toBe(10);
    expect(intensityC(p, 270, 0)).toBe(30);
    expect(intensityC(p, 90, 0)).toBe(20);
    const back = parseLDT(writeLDT(p).text).photometry;
    expect(intensityC(back, 0, 0)).toBe(10);
    expect(intensityC(back, 270, 0)).toBe(30);
  });

  it('лишние значения отбрасываются с предупреждением', () => {
    const { issues } = parseLDT(ldt({ data: [1, 2, 3, 4] }));
    expect(codes(issues)).toContain('value-count-long');
  });
});

describe('тип B', () => {
  /** Пучок, симметричный вокруг оси прибора: I = f(угол от оси). */
  const beam = (a: number) => Math.max(0, 1000 * Math.cos((a * Math.PI) / 180) ** 4);
  const typeB = () => {
    const h: number[] = [];
    const v: number[] = [];
    for (let x = -90; x <= 90; x += 2.5) {
      h.push(x);
      v.push(x);
    }
    const lines = ['IESNA:LM-63-1995', 'TILT=NONE', `1 -1 1 ${v.length} ${h.length} 2 2 0 0 0`, '1 1 50', v.join(' '), h.join(' ')];
    for (const hh of h) {
      lines.push(v.map((vv) => {
        const cosA = Math.cos((hh * Math.PI) / 180) * Math.cos((vv * Math.PI) / 180);
        return beam((Math.acos(Math.min(1, cosA)) * 180) / Math.PI).toFixed(4);
      }).join(' '));
    }
    return lines.join('\n');
  };

  it('пересчёт B → C: осесимметричный пучок становится осесимметричным в C', () => {
    const { photometry: b } = parseIES(typeB());
    expect(b.photometryType).toBe('B');
    const { photometry: c, issues } = typeBToC(b, { cStep: 15, gStep: 5 });
    expect(codes(issues)).toContain('converted-type-b');
    for (const cc of [0, 45, 90, 135, 180, 270]) {
      for (const g of [0, 20, 40, 60]) expect(intensityC(c, cc, g)).toBeCloseTo(beam(g), -1);
    }
    // поток пучка cos⁴: 2π·I0/5
    expect(computeFlux(typeBToC(b, { cStep: 5, gStep: 1 }).photometry).total / ((2 * Math.PI * 1000) / 5)).toBeCloseTo(1, 2);
  });

  it('тип B записывается в IES без пересчёта и читается обратно', () => {
    const { photometry: b } = parseIES(typeB());
    const back = parseIES(writeIES(b)).photometry;
    expect(back.photometryType).toBe('B');
    expect(back.candela[36][36]).toBeCloseTo(1000, 3);
  });

  it('LDT требует тип C', () => {
    const { photometry: b } = parseIES(typeB());
    expect(() => writeLDT(b)).toThrow();
  });
});

describe('проверки', () => {
  it('артикул: совпадает, перепутан, отсутствует, не совпадает; вариант «@ 3000K»', () => {
    const p = makeC(lambert, { symmetry: 'axial' });
    p.meta.article = 'DL055-10W';
    expect(checkArticle(p, 'DL055-10W @ 3000K.ldt')).toEqual([]);
    p.meta.article = 'Okno';
    p.meta.luminaireName = 'DL055-10W';
    expect(codes(checkArticle(p, 'DL055-10W.ies'))).toEqual(['article-swapped']);
    p.meta.article = '';
    p.meta.luminaireName = 'Okno';
    expect(codes(checkArticle(p, 'DL055-10W.ies'))).toEqual(['article-missing']);
    p.meta.article = '135';
    expect(codes(checkArticle(p, 'DL055-10W.ies'))).toEqual(['article-mismatch']);
  });

  it('обрезка на 90°, разброс в надире, расхождение потока', () => {
    const p = makeC((c, g) => (g === 0 ? 100 + (c === 0 ? 20 : 0) : 100 * Math.cos((g * Math.PI) / 360)), { gMax: 90, cStep: 90 });
    p.lamps[0].flux = 10;
    const found = codes(validatePhotometry(p));
    expect(found).toEqual(expect.arrayContaining(['truncated-at-90', 'pole-spread-nadir', 'flux-mismatch']));
  });

  it('пара файлов: масштаб и форма', () => {
    const a = makeC(lambert, { symmetry: 'axial' });
    const b = makeC((c, g) => lambert(c, g) * 10, { symmetry: 'axial' });
    expect(codes(comparePair(a, b))).toEqual(['pair-mismatch-scale']);
    const d = makeC((c, g) => (g <= 30 ? 1000 : 0), { symmetry: 'axial' });
    expect(codes(comparePair(a, d))).toEqual(['pair-mismatch-shape']);
    expect(comparePair(a, makeC(lambert, { symmetry: 'axial' }))).toEqual([]);
  });

  it('сообщения есть на трёх языках', () => {
    const i = { code: 'value-count-short' as const, severity: 'error' as const, params: { found: 2, expected: 4 } };
    expect(formatIssue(i, 'ru')).toContain('2 вместо 4');
    expect(formatIssue(i, 'en')).toContain('2 instead of 4');
    expect(formatIssue(i, 'de')).toContain('2 statt 4');
  });

  it('parseFile определяет формат по расширению и содержимому', () => {
    const ies = new TextEncoder().encode(writeIES(makeC(lambert, { symmetry: 'axial' })));
    expect(parseFile(ies, 'x.IES').photometry.source.format).toBe('IES');
    expect(parseFile(ies, 'noext').photometry.source.format).toBe('IES');
  });
});
