/** Пакетная обработка по таблице ImportData — выдуманные артикулы (реальная таблица в репозиторий не кладётся). */
import { describe, expect, it } from 'vitest';
import { parseFile, summarize, writeLDT, writeIES } from '../src/core/index';
import { applyRow, indexSources, pickSheet, planTable, tableFromCells, tableToCells, IMPORT_COLUMNS } from '../src/batch/import-table';
import { readXlsx, writeXlsx } from '../src/batch/xlsx-read';
import { asym, makeC } from './helpers';

const H = [...IMPORT_COLUMNS];
const row = (o: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>) => H.map((h) => o[h] ?? '');
const cells = [
  H,
  row({ ID: '1', Company: 'ACME', LuminaireNumber: 'TEST-A', LuminaireName: 'Alpha', TypeIndicator: '1', SymmetryIndicator: '1', LuminaireLength: '0.052', LuminaireWidth: '0', LuminaireHeight: '0.125', LEOlength: '0.05', LEOwidth: '0', NumberOfLampSets: '1', NumberOfLamps: '-1', LampType: 'LED', LuminousFlux: '590', CCT: '3000', CRI: '90', Power: '12' }),
  row({ ID: '2', LuminaireNumber: 'TEST-B', SymmetryIndicator: '4', LuminaireLength: '0.129', LuminaireWidth: '0.025', NumberOfLampSets: '3', NumberOfLamps: '1', LuminousFlux: '410, 510, 460', CCT: '3000, 4000, 6000', Power: '12' }),
  row({ ID: '3', LuminaireNumber: 'TEST-C', NumberOfLampSets: '3', LuminousFlux: '410, 510', CCT: '3000, 4000, 6000' }),
  row({ ID: '4', LuminaireNumber: 'TEST-MISSING', LuminousFlux: '100' }),
  row({ ID: '5', LuminaireNumber: 'test-a', LuminousFlux: '100', LuminaireHeight: '125' }),
];

describe('import table', () => {
  const t = tableFromCells(cells);
  const src = indexSources(['TEST-A.ldt', 'test-a.IES', 'TEST-B.ies', 'TEST-C.ldt']);

  it('plans rows: sources, LDT priority, lists, duplicates', () => {
    const p = planTable(t, src);
    expect(p[0].source).toBe('TEST-A.ldt');
    expect(p[0].status).toBe('warning'); // есть и IES, и LDT
    expect(p[0].symmetry).toBe('axial');
    expect(p[0].outputs.map((o) => o.base)).toEqual(['TEST-A']);
    expect(p[1].status).toBe('ok');
    expect(p[1].outputs.map((o) => o.base)).toEqual(['TEST-B @ 3000K', 'TEST-B @ 4000K', 'TEST-B @ 6000K']);
    expect(p[1].outputs.map((o) => o.flux)).toEqual([410, 510, 460]);
    expect(p[2].status).toBe('error');
    expect(p[2].messages.find((m) => m.code === 'listLength')?.col).toBe('LuminousFlux');
    expect(p[3].messages.some((m) => m.code === 'noSource')).toBe(true);
    expect(p[4].messages.some((m) => m.code === 'duplicate')).toBe(true);
    expect(p[4].messages.some((m) => m.code === 'mmNotM')).toBe(true);
  });

  it('applies a row: symmetry, flux, fields, dimensions in mm', () => {
    const p0 = makeC(asym, { cStep: 15, gStep: 5 });
    const a = applyRow(p0, t, 0, 0).photometry;
    expect(a.symmetry).toBe('axial');
    expect(summarize(a).flux.total).toBeCloseTo(590, 0);
    expect(a.absolute).toBe(true);
    expect(a.meta.manufacturer).toBe('ACME');
    expect(a.meta.article).toBe('TEST-A');
    expect(a.luminaire).toMatchObject({ shape: 'circle', length: 52, height: 125 });
    expect(a.lamps[0]).toMatchObject({ count: -1, flux: 590, cct: '3000', cri: '90', watts: 12 });
    expect(a.ldt?.ityp).toBe(1);
    const b = applyRow(p0, t, 1, 1).photometry;
    expect(b.symmetry).toBe('quadrant');
    expect(summarize(b).flux.total).toBeCloseTo(510, 0);
    expect(b.lamps[0]).toMatchObject({ count: 1, flux: 510, cct: '4000' });
    expect(b.absolute).toBe(false);
    expect(b.luminaire).toMatchObject({ shape: 'rect', length: 129, width: 25 });
    // записывается и читается обратно в обоих форматах
    for (const [text, name] of [[writeLDT(b, { fileName: 'x.ldt' }).text, 'x.ldt'], [writeIES(b), 'x.ies']] as const) {
      const back = parseFile(new TextEncoder().encode(text), name).photometry;
      expect(summarize(back).flux.total).toBeCloseTo(510, -1);
    }
  });

  it('xlsx round trip keeps other sheets', async () => {
    const bytes = await writeXlsx(tableToCells(t), { sheetName: 'ImportData' });
    const { sheets, zip } = await readXlsx(bytes);
    const s = pickSheet(sheets)!;
    expect(s.name).toBe('ImportData');
    const t2 = tableFromCells(s.rows);
    expect(t2.columns).toEqual(H);
    expect(t2.rows[0][H.indexOf('LuminaireLength')]).toBe('0.052');
    expect(t2.rows[1][H.indexOf('LuminousFlux')]).toBe('410, 510, 460');
    t2.rows[0][H.indexOf('LuminaireName')] = 'Changed';
    const again = await readXlsx(await writeXlsx(tableToCells(t2), { sheetName: 'ImportData', base: { zip, path: s.path } }));
    expect(tableFromCells(pickSheet(again.sheets)!.rows).rows[0][H.indexOf('LuminaireName')]).toBe('Changed');
  });
});
