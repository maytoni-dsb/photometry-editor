/**
 * Этап 5: пакетная обработка.
 * Приёмка по ТЗ: 100+ файлов обрабатываются одним действием (в браузере — в фоновом потоке,
 * здесь — тот же движок напрямую).
 */

import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { catalogStyle } from '../src/charts/style';
import { CATALOG_WIDTH } from '../src/charts/polar-catalog';
import { defaultChartOptions } from '../src/charts/series';
import type { FontSet } from '../src/charts/fonts';
import {
  applyOp,
  beamAngles,
  computeFlux,
  parseIES,
  parseLDT,
  peak,
  summarize,
  writeIES,
  writeLDT,
  type Photometry,
} from '../src/core/index';
import { commonScaleMax, type BatchCharts } from '../src/batch/charts';
import { NameRegistry, outputBase } from '../src/batch/naming';
import { applyRecipe, parseStep, recipeFromJson, recipeToJson, RecipeError, StepError } from '../src/batch/recipe';
import { BatchCancelled, runBatch, type BatchInput, type BatchJob } from '../src/batch/run';
import { summaryCsv, summaryRow, summaryXlsx } from '../src/batch/table';
import { lampBeamAngle, makeVariant, parseVariantTable, templateFromJson, templateToJson } from '../src/batch/variants';
import { asym, lambert, makeC } from './helpers';

const fonts: FontSet = {
  regular: new Uint8Array(readFileSync('public/fonts/Roboto-Regular.woff')),
  bold: new Uint8Array(readFileSync('public/fonts/Roboto-Medium.woff')),
};
const flux = (p: Photometry) => computeFlux(p).total;
const enc = (s: string) => new TextEncoder().encode(s);

/** cosⁿ-пучок вниз, I0 задаётся. */
const cosN = (n: number, i0 = 1000) => (_c: number, g: number) => (g <= 90 ? i0 * Math.cos((g * Math.PI) / 180) ** n : 0);

describe('рецепт', () => {
  it('JSON: сохранение и чтение без потерь, лишние поля отбрасываются', () => {
    const steps = [
      { op: 'normalize', mode: 'flux', value: 1500 },
      { op: 'rotate', axis: 'x', angle: 30 },
      { op: 'mirror', plane: 'updown' },
      { op: 'symmetrize', symmetry: 'axial' },
      { op: 'regrid', cStep: 10, gStep: 2.5, gRange: 'full' },
      { op: 'smooth', width: 5 },
      { op: 'normalize', mode: 'cdklm' },
    ] as const;
    const r = recipeFromJson(recipeToJson({ name: 'Тест', steps: [...steps] }));
    expect(r.name).toBe('Тест');
    expect(r.steps).toEqual(steps);
    expect(parseStep({ op: 'mirror', plane: 'c0c180', junk: 1 })).toEqual({ op: 'mirror', plane: 'c0c180' });
    // голый массив шагов тоже рецепт
    expect(recipeFromJson('[{"op":"rotate","axis":"z","angle":90}]', 'x').steps).toHaveLength(1);
  });

  it('неверные шаги и файлы отклоняются с понятной причиной', () => {
    expect(() => parseStep({ op: 'rotate', axis: 'w', angle: 1 }, 2)).toThrow(RecipeError);
    expect(() => parseStep({ op: 'normalize', mode: 'flux', value: -1 })).toThrow(RecipeError);
    expect(() => parseStep({ op: 'smooth', width: 45 })).toThrow(RecipeError);
    expect(() => recipeFromJson('{oops')).toThrow(RecipeError);
    expect(() => recipeFromJson('{"type":"other","steps":[]}')).toThrow(RecipeError);
    try {
      parseStep({ op: 'nope' }, 4);
    } catch (e) {
      expect((e as RecipeError).params.n).toBe(5);
    }
  });

  it('применение рецепта = те же операции по очереди', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const steps = [
      { op: 'rotate', axis: 'z', angle: 30 },
      { op: 'mirror', plane: 'c0c180' },
      { op: 'normalize', mode: 'flux', value: 2000 },
    ] as const;
    let q = p;
    for (const s of steps) q = applyOp(q, s).photometry;
    const r = applyRecipe(p, [...steps]);
    expect(r.photometry.candela).toEqual(q.candela);
    expect(flux(r.photometry)).toBeCloseTo(2000, 6);
  });

  it('ошибка шага сообщает номер шага', () => {
    const dark = makeC(() => 0, { cStep: 90, gStep: 10 });
    try {
      applyRecipe(dark, [{ op: 'mirror', plane: 'c0c180' }, { op: 'normalize', mode: 'flux', value: 100 }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StepError);
      expect((e as StepError).step).toBe(1);
    }
  });
});

describe('генерация вариантов', () => {
  it('таблица из Excel с заголовком: колонки по названиям, числа с пробелами и запятой', () => {
    const rows = parseVariantTable('Суффикс\tЦТ\tПоток, лм\tCRI\tМощность, Вт\tЛампа\r\n4000K\t4000\t1 250,5\t90\t12\tLED\r\n\t3000\t95%\t80\t\t\r\n');
    expect(rows).toEqual([
      { suffix: '4000K', cct: '4000', flux: 1250.5, cri: '90', watts: 12, lamp: 'LED' },
      { suffix: '3000K', cct: '3000', factor: 0.95, cri: '80' },
    ]);
  });

  it('таблица без заголовка — порядок «суффикс, ЦТ, поток, CRI, мощность, лампа»; CSV с «;»', () => {
    expect(parseVariantTable('6K;6000;900;80;10;LED 36°')).toEqual([{ suffix: '6K', cct: '6000', flux: 900, cri: '80', watts: 10, lamp: 'LED 36°' }]);
    expect(parseVariantTable('Flux\tCCT\n1000\t2700')).toEqual([{ suffix: '2700K', flux: 1000, cct: '2700' }]);
  });

  it('шаблон вариантов: JSON туда и обратно', () => {
    const t = { name: 'Цвета', rows: [{ suffix: '3000K', cct: '3000', flux: 1000, factor: null, cri: '90', watts: 10, lamp: 'LED' }] };
    expect(templateFromJson(templateToJson(t))).toEqual(t);
  });

  it('относительная фотометрия: силы света и поток ламп ×k, кд/клм не меняются, поля обновлены', () => {
    const p = makeC(lambert, { symmetry: 'axial', gStep: 5, flux: 1000 });
    const v = makeVariant(p, { suffix: '4000K', cct: '4000', flux: 1500, cri: '80', watts: 14, lamp: 'LED module' });
    const q = v.photometry;
    expect(v.factor).toBeCloseTo(1.5, 12);
    expect(q.lamps[0].flux).toBe(1500);
    expect(flux(q)).toBeCloseTo(flux(p) * 1.5, 6);
    expect(peak(q).value).toBeCloseTo(peak(p).value * 1.5, 6);
    expect(q.lamps[0]).toMatchObject({ cct: '4000', cri: '80', watts: 14, type: 'LED module' });
    expect(q.inputWatts).toBe(14);
    // исходник не изменён
    expect(p.lamps[0].cct).toBe('3000');

    // запись и чтение: LDT в кд/клм те же, IES — поток лампы, ЦТ, CRI, лампа
    const l0 = parseLDT(writeLDT(p).text).photometry;
    const l1 = parseLDT(writeLDT(q).text).photometry;
    expect(l1.candela[0][0] / l1.lamps[0].flux!).toBeCloseTo(l0.candela[0][0] / l0.lamps[0].flux!, 6);
    expect(l1.lamps[0]).toMatchObject({ flux: 1500, cct: '4000', cri: '80', watts: 14, type: 'LED module' });
    const ies = writeIES(q);
    expect(ies).toContain('[LAMP] LED module');
    expect(ies).toContain('[_SEARCH_COLORTEMP] 4000');
    expect(ies).toContain('[_SEARCH_CRI] 80');
    const i1 = parseIES(ies).photometry;
    expect(i1.lamps[0].flux).toBeCloseTo(1500, 3);
    expect(i1.inputWatts).toBe(14);
  });

  it('абсолютная фотометрия: поток светильника становится заданным', () => {
    const p = makeC(cosN(4), { symmetry: 'axial', gStep: 1 });
    const v = makeVariant(p, { suffix: '3000K', flux: 777 });
    expect(flux(v.photometry)).toBeCloseTo(777, 6);
    const f = parseIES(writeIES(v.photometry)).photometry;
    expect(flux(f)).toBeCloseTo(777, 1);
    // коэффициент
    const k = makeVariant(p, { suffix: 'x', factor: 0.5 });
    expect(flux(k.photometry)).toBeCloseTo(flux(p) * 0.5, 6);
  });

  it('другой угол луча у лампы — предупреждение', () => {
    expect(lampBeamAngle('GU10 36°')).toBe(36);
    expect(lampBeamAngle('PAR16 60 deg')).toBe(60);
    expect(lampBeamAngle('LED')).toBeNull();
    const p = makeC(lambert, { symmetry: 'axial', flux: 500 });
    p.lamps[0].type = 'GU10 36°';
    expect(makeVariant(p, { suffix: 'a', lamp: 'GU10 60°' }).issues.map((i) => i.code)).toContain('variant-beam-angle');
    expect(makeVariant(p, { suffix: 'b', lamp: 'GU10 36°' }).issues).toHaveLength(0);
  });
});

describe('имена выходных файлов', () => {
  it('как исходный, по артикулу, вариант «<артикул> @ <суффикс>»', () => {
    const p = makeC(lambert, { symmetry: 'axial' });
    p.meta.article = 'C066CL-12W3-6K-B';
    expect(outputBase(p, 'C066CL-12W3-6K-B @ 3000K.ies', 'source')).toBe('C066CL-12W3-6K-B @ 3000K');
    expect(outputBase(p, 'lab_file_17.ies', 'article')).toBe('C066CL-12W3-6K-B');
    expect(outputBase(p, 'C066CL-12W3-6K-B @ 3000K.ies', 'source', '4000K')).toBe('C066CL-12W3-6K-B @ 4000K');
    expect(outputBase(p, 'lab_file_17.ies', 'article', '4000K')).toBe('C066CL-12W3-6K-B @ 4000K');
    p.meta.article = '';
    expect(outputBase(p, 'lab:file?.ies', 'article')).toBe('lab_file_');
  });

  it('совпадение имён → _2, _3 (без учёта регистра)', () => {
    const r = new NameRegistry();
    expect(r.take('', 'A', 'ies')).toBe('A');
    expect(r.take('', 'a', 'ies')).toBe('a_2');
    expect(r.take('', 'A', 'ldt')).toBe('A');
    expect(r.takeAll('', 'A', ['ies', 'ldt'])).toBe('A_3');
    expect(r.take('polar/', 'A', 'ies')).toBe('A');
  });
});

describe('сводная таблица', () => {
  it('угол луча и поля: ламберт 120° / 168,5°; cos⁴-пучок по формуле', () => {
    const l = summarize(makeC(lambert, { symmetry: 'axial', gStep: 1 })).asC;
    const [a] = beamAngles(l);
    expect(a.beam).toBeCloseTo(120, 0);
    expect(a.field).toBeCloseTo(2 * (Math.acos(0.1) * 180) / Math.PI, 0);
    const n = summarize(makeC(cosN(4), { symmetry: 'axial', gStep: 1 })).asC;
    expect(beamAngles(n)[0].beam!).toBeCloseTo(2 * (Math.acos(0.5 ** 0.25) * 180) / Math.PI, 0);
    // несимметричный — две плоскости
    expect(beamAngles(makeC(asym, { cStep: 15, gStep: 5 }))).toHaveLength(2);
  });

  it('CSV для Excel и XLSX с двумя листами', async () => {
    const p = makeC(lambert, { symmetry: 'axial', gStep: 5, flux: 1000 });
    const row = summaryRow(p, 'ART-001', 'ART-001.ldt', [{ code: 'article-missing', severity: 'warning' }]);
    expect(row.lor).toBeCloseTo((flux(p) / 1000) * 100, 0);
    const csv = summaryCsv([row], 'ru');
    expect(csv.startsWith('﻿Файл;Исходный файл;')).toBe(true);
    expect(csv).toContain('Артикул не заполнен');
    expect(csv.split('\r\n')[1]).toMatch(/;120(,\d)?;/); // угол луча с десятичной запятой
    const x = await JSZip.loadAsync(await summaryXlsx([row], 'en'));
    expect(Object.keys(x.files)).toContain('xl/worksheets/sheet2.xml');
    const s1 = await x.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(s1).toContain('Beam angle C0–C180');
    expect(s1).toContain('<v>120</v>');
    expect(await x.file('xl/workbook.xml')!.async('string')).toContain('name="Issues"');
  });
});

// ——— движок пакета ———

function library(n: number): BatchInput[] {
  const out: BatchInput[] = [];
  for (let i = 0; i < n; i++) {
    const narrow = i % 3 === 0;
    const p = narrow ? makeC(cosN(2 + (i % 7), 500 + 10 * i), { symmetry: 'axial', gStep: 1 }) : makeC(asym, { cStep: 15, gStep: 5, flux: 800 + i });
    p.meta.article = `ART-${String(i).padStart(3, '0')}`;
    const name = `ART-${String(i).padStart(3, '0')}${i % 10 === 0 ? ' @ 3000K' : ''}`;
    out.push(i % 2 ? { name: `${name}.ldt`, bytes: enc(writeLDT(p).text) } : { name: `${name}.ies`, bytes: enc(writeIES(p)) });
  }
  return out;
}

const chartCfg = (over: Partial<BatchCharts> = {}): BatchCharts => ({
  kinds: ['polar', 'linear'],
  formats: ['svg', 'pdf', 'eps'],
  color: 'cmyk',
  textAsPaths: false,
  commonScale: false,
  settings: { ...defaultChartOptions(), layout: 'catalog', width: CATALOG_WIDTH, linearWidth: CATALOG_WIDTH, planes: null },
  style: catalogStyle(),
  ...over,
});

const job = (over: Partial<BatchJob> = {}): BatchJob => ({ steps: [], variants: [], files: [], charts: null, summary: [], naming: 'source', lang: 'ru', ...over });

describe('пакет: 100+ файлов одним действием', () => {
  it('120 файлов: рецепт + IES и LDT + графики polar/linear в SVG/PDF/EPS + сводная таблица', async () => {
    const inputs = library(120);
    const phases = new Set<string>();
    let calls = 0;
    const r = await runBatch(
      inputs,
      job({ steps: [{ op: 'normalize', mode: 'cdklm' }, { op: 'rotate', axis: 'z', angle: 90 }], files: ['ies', 'ldt'], charts: chartCfg(), summary: ['csv', 'xlsx'] }),
      { fonts, onProgress: (p) => { phases.add(p.phase); calls++; } },
    );
    expect(r.errors).toEqual([]);
    expect(r.read).toBe(120);
    expect(r.outputs).toBe(120);
    // 120 × (ies + ldt) + 120 × 2 графика × 3 формата + сводка csv + замечания csv + xlsx
    expect(r.entries).toBe(240 + 720 + 3);
    expect([...phases]).toEqual(['read', 'write', 'charts', 'pack']);
    expect(calls).toBeGreaterThan(120);
    console.log(`120 файлов, ${r.entries} файлов в архиве, ${(r.zip.length / 1e6).toFixed(1)} МБ, ${r.ms} мс`);

    const zip = await JSZip.loadAsync(r.zip);
    const names = Object.keys(zip.files);
    expect(names).toContain('ART-000 @ 3000K.ies');
    expect(names).toContain('ART-000 @ 3000K.ldt');
    expect(names).toContain('polar/ART-001.pdf');
    expect(names).toContain('linear/ART-119.eps');
    expect(names).toContain('Сводная таблица.xlsx');
    // результат рецепта: нормировка к 1000 лм (кд/клм) — поток ламп 1000 лм, КСС повёрнута на 90°
    const back = parseLDT(await zip.file('ART-005.ldt')!.async('uint8array')).photometry;
    expect(back.lamps[0].flux).toBeCloseTo(1000, 3);
    const src = parseLDT(inputs[5].bytes).photometry;
    expect(peak(back).value / back.lamps[0].flux!).toBeCloseTo(peak(src).value / src.lamps[0].flux!, 4);
  }, 120_000);

  it('конвертация IES ↔ LDT («как исходный» и обе), имена по артикулу', async () => {
    const inputs = library(6);
    inputs[2] = { name: 'lab-file.ies', bytes: inputs[2].bytes };
    const r = await runBatch(inputs, job({ files: ['ldt'], naming: 'article' }));
    const zip = await JSZip.loadAsync(r.zip);
    expect(Object.keys(zip.files).sort()).toEqual(['ART-000.ldt', 'ART-001.ldt', 'ART-002.ldt', 'ART-003.ldt', 'ART-004.ldt', 'ART-005.ldt']);
    const src = parseIES(inputs[4].bytes).photometry;
    const out = parseLDT(await zip.file('ART-004.ldt')!.async('uint8array')).photometry;
    expect(flux(out)).toBeCloseTo(flux(src), 0);
    expect(peak(out).value).toBeCloseTo(peak(src).value, 0);
    const same = await runBatch(inputs.slice(0, 2), job({ files: ['same'] }));
    expect(Object.keys((await JSZip.loadAsync(same.zip)).files).sort()).toEqual(['ART-000 @ 3000K.ies', 'ART-001.ldt']);
    const other = await runBatch(inputs.slice(0, 2), job({ files: ['other'] }));
    expect(Object.keys((await JSZip.loadAsync(other.zip)).files).sort()).toEqual(['ART-000 @ 3000K.ldt', 'ART-001.ies']);
  });

  it('варианты для нескольких исходных файлов: «<артикул> @ <суффикс>», IES и LDT', async () => {
    const inputs = library(3);
    const rows = parseVariantTable('Суффикс\tЦТ\tПоток\n3000K\t3000\t1000\n4000K\t4000\t1100\n6500K\t6500\t95%');
    const r = await runBatch(inputs, job({ variants: rows, files: ['ies', 'ldt'], summary: ['csv'] }));
    expect(r.outputs).toBe(9);
    const zip = await JSZip.loadAsync(r.zip);
    const names = Object.keys(zip.files);
    expect(names).toContain('ART-000 @ 4000K.ldt');
    expect(names).toContain('ART-002 @ 6500K.ies');
    const v = parseLDT(await zip.file('ART-001 @ 4000K.ldt')!.async('uint8array')).photometry;
    expect(v.lamps[0].cct).toBe('4000');
    expect(v.lamps[0].flux).toBeCloseTo(1100, 1);
    const csv = await zip.file('Сводная таблица.csv')!.async('string');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(10);
  });

  it('битый файл и неудачный шаг не останавливают пакет — попадают в журнал', async () => {
    const inputs = [...library(3), { name: 'broken.ldt', bytes: enc('nothing here') }, { name: 'dark.ies', bytes: enc(writeIES(makeC(() => 0, { cStep: 90, gStep: 10 }))) }];
    const r = await runBatch(inputs, job({ steps: [{ op: 'normalize', mode: 'flux', value: 1000 }], files: ['ies'] }));
    expect(r.outputs).toBe(3);
    expect(r.errors.map((e) => e.file).sort()).toEqual(['broken.ldt', 'dark.ies']);
    expect(r.errors.find((e) => e.file === 'dark.ies')!.message).toMatch(/^шаг 1 \(Нормировка\)/);
    const zip = await JSZip.loadAsync(r.zip);
    expect(Object.keys(zip.files)).toContain('Журнал.txt');
  });

  it('пара IES/LDT с разным потоком — в отчёте проверки', async () => {
    const p = makeC(lambert, { symmetry: 'axial', gStep: 5, flux: 1000 });
    const q = applyOp(p, { op: 'normalize', mode: 'factor', value: 3 }).photometry;
    const r = await runBatch([{ name: 'X.ies', bytes: enc(writeIES(p)) }, { name: 'X.ldt', bytes: enc(writeLDT(q).text) }], job({ summary: ['csv'] }));
    const zip = await JSZip.loadAsync(r.zip);
    expect(await zip.file('Замечания.csv')!.async('string')).toMatch(/Пара файлов/);
  });

  it('общий масштаб — одна шкала на весь набор', async () => {
    const a = makeC(cosN(2, 300), { symmetry: 'axial', gStep: 1 });
    const b = makeC(cosN(2, 900), { symmetry: 'axial', gStep: 1 });
    const cfg = chartCfg({ commonScale: true, settings: { ...chartCfg().settings, unit: 'cd' } });
    const items = [a, b].map((p) => ({ p, s: summarize(p) }));
    expect(commonScaleMax(items, 'polar', cfg)).toBe(900);
    expect(commonScaleMax(items, 'polar', { ...cfg, commonScale: false })).toBeNull();
    // в SVG обоих файлов один и тот же максимум шкалы
    const r = await runBatch(
      [{ name: 'a.ies', bytes: enc(writeIES(a)) }, { name: 'b.ies', bytes: enc(writeIES(b)) }],
      job({ charts: { ...cfg, kinds: ['polar'], formats: ['svg'], settings: { ...cfg.settings, layout: 'standard', width: 100 } } }),
    );
    const zip = await JSZip.loadAsync(r.zip);
    const svgA = await zip.file('a.svg')!.async('string');
    const svgB = await zip.file('b.svg')!.async('string');
    const rings = (s: string) => (s.match(/<circle[^>]*>/g) ?? []).map((c) => /r="([\d.]+)"/.exec(c)?.[1]).join();
    expect(rings(svgA)).toBe(rings(svgB));
  });

  it('отмена останавливает пакет', async () => {
    let n = 0;
    await expect(runBatch(library(40), job({ files: ['ies'] }), { cancelled: () => ++n > 10 })).rejects.toBeInstanceOf(BatchCancelled);
  });
});

describe('прочее', () => {
  it('WOFF → TTF: те же глифы и метрики (ускорение PDF в пакете)', async () => {
    const { openFont, woffToSfnt } = await import('../src/charts/fonts');
    const ttf = await woffToSfnt(fonts.regular);
    const a = openFont(fonts.regular) as unknown as { numGlyphs: number; glyphForCodePoint(c: number): { advanceWidth: number; path: { commands: unknown[] } } };
    const b = openFont(ttf) as unknown as typeof a;
    expect(b.numGlyphs).toBe(a.numGlyphs);
    for (const ch of 'AΦγ0°') {
      const ga = a.glyphForCodePoint(ch.codePointAt(0)!);
      const gb = b.glyphForCodePoint(ch.codePointAt(0)!);
      expect(gb.advanceWidth).toBe(ga.advanceWidth);
      expect(gb.path.commands).toEqual(ga.path.commands);
    }
  });

  it('переводы пакета: одинаковые ключи в ru / en / de', () => {
    const keys = (o: unknown, pre = ''): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
    const load = (l: string) => JSON.parse(readFileSync(`src/app/locales/${l}.json`, 'utf8'));
    const ru = keys(load('ru')).sort();
    expect(keys(load('en')).sort()).toEqual(ru);
    expect(keys(load('de')).sort()).toEqual(ru);
  });
});
