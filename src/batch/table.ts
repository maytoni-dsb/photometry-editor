/**
 * Сводная таблица параметров (ТЗ: поток, мощность, угол луча, макс. сила света, КПД по всем файлам)
 * и сводный отчёт проверки. Выгрузка — CSV (UTF-8 с BOM, разделитель «;» — открывается в Excel)
 * и XLSX (два листа: «Сводка» и «Замечания»).
 */

import JSZip from 'jszip';
import { beamAngles, formatIssue, summarize, type Issue, type Lang, type Photometry } from '../core/index';

export interface SummaryRow {
  /** Имя выходного файла (без расширения). */
  file: string;
  /** Исходный файл. */
  source: string;
  format: string;
  article: string;
  name: string;
  manufacturer: string;
  type: string;
  symmetry: string;
  grid: string;
  flux: number;
  lampFlux: number | null;
  watts: number | null;
  efficacy: number | null;
  peakCd: number;
  peakCdklm: number;
  peakDir: string;
  beam0: number | null;
  beam90: number | null;
  field0: number | null;
  field90: number | null;
  lor: number | null;
  dlor: number;
  cct: string;
  cri: string;
  lamp: string;
  errors: number;
  warnings: number;
  issues: Issue[];
}

const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function summaryRow(p: Photometry, file: string, source: string, issues: Issue[]): SummaryRow {
  const s = summarize(p);
  const ba = beamAngles(s.asC);
  const lamp = p.lamps[0];
  const axial = ba.length === 1;
  return {
    file,
    source,
    format: p.source.format,
    article: p.meta.article,
    name: p.meta.luminaireName,
    manufacturer: p.meta.manufacturer,
    type: p.photometryType,
    symmetry: s.asC.symmetry,
    grid: `${p.hAngles.length}×${p.vAngles.length}`,
    flux: r(s.flux.total, 1),
    lampFlux: !p.absolute && lamp?.flux ? r(lamp.flux, 1) : null,
    watts: p.inputWatts ?? lamp?.watts ?? null,
    efficacy: s.efficacy == null ? null : r(s.efficacy, 1),
    peakCd: r(s.peak.value, 1),
    peakCdklm: r((s.peak.value * 1000) / s.referenceFlux, 1),
    peakDir: `C${r(s.peak.c, 1)} γ${r(s.peak.g, 1)}`,
    beam0: ba[0].beam,
    beam90: axial ? ba[0].beam : ba[1].beam,
    field0: ba[0].field,
    field90: axial ? ba[0].field : ba[1].field,
    lor: s.lor == null ? null : r(s.lor, 1),
    dlor: r(s.dlor, 1),
    cct: lamp?.cct ?? '',
    cri: lamp?.cri ?? '',
    lamp: lamp?.type ?? '',
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    issues,
  };
}

type Col = { key: keyof SummaryRow; num?: number; width: number };

const COLS: Col[] = [
  { key: 'file', width: 34 },
  { key: 'source', width: 34 },
  { key: 'format', width: 7 },
  { key: 'article', width: 24 },
  { key: 'name', width: 24 },
  { key: 'manufacturer', width: 14 },
  { key: 'type', width: 6 },
  { key: 'symmetry', width: 10 },
  { key: 'grid', width: 8 },
  { key: 'flux', num: 1, width: 10 },
  { key: 'lampFlux', num: 1, width: 10 },
  { key: 'watts', num: 2, width: 9 },
  { key: 'efficacy', num: 1, width: 9 },
  { key: 'peakCd', num: 1, width: 10 },
  { key: 'peakCdklm', num: 1, width: 10 },
  { key: 'peakDir', width: 14 },
  { key: 'beam0', num: 1, width: 10 },
  { key: 'beam90', num: 1, width: 10 },
  { key: 'field0', num: 1, width: 10 },
  { key: 'field90', num: 1, width: 10 },
  { key: 'lor', num: 1, width: 8 },
  { key: 'dlor', num: 1, width: 8 },
  { key: 'cct', width: 8 },
  { key: 'cri', width: 6 },
  { key: 'lamp', width: 16 },
  { key: 'errors', num: 0, width: 7 },
  { key: 'warnings', num: 0, width: 7 },
  { key: 'issues', width: 60 },
];

type Labels = Record<Exclude<keyof SummaryRow, never>, string>;

const LABELS: Record<Lang, Labels> = {
  ru: {
    file: 'Файл', source: 'Исходный файл', format: 'Формат', article: 'Артикул', name: 'Название', manufacturer: 'Производитель',
    type: 'Тип', symmetry: 'Симметрия', grid: 'Сетка C×γ', flux: 'Поток светильника, лм', lampFlux: 'Поток ламп, лм',
    watts: 'Мощность, Вт', efficacy: 'Светоотдача, лм/Вт', peakCd: 'Iмакс, кд', peakCdklm: 'Iмакс, кд/клм', peakDir: 'Направление Iмакс',
    beam0: 'Угол луча C0–C180, °', beam90: 'Угол луча C90–C270, °', field0: 'Угол поля C0–C180, °', field90: 'Угол поля C90–C270, °',
    lor: 'КПД, %', dlor: 'Доля вниз, %', cct: 'ЦТ', cri: 'CRI', lamp: 'Лампа', errors: 'Ошибки', warnings: 'Предупр.', issues: 'Замечания',
  },
  en: {
    file: 'File', source: 'Source file', format: 'Format', article: 'Article', name: 'Name', manufacturer: 'Manufacturer',
    type: 'Type', symmetry: 'Symmetry', grid: 'Grid C×γ', flux: 'Luminaire flux, lm', lampFlux: 'Lamp flux, lm',
    watts: 'Power, W', efficacy: 'Efficacy, lm/W', peakCd: 'Imax, cd', peakCdklm: 'Imax, cd/klm', peakDir: 'Imax direction',
    beam0: 'Beam angle C0–C180, °', beam90: 'Beam angle C90–C270, °', field0: 'Field angle C0–C180, °', field90: 'Field angle C90–C270, °',
    lor: 'LOR, %', dlor: 'Downward, %', cct: 'CCT', cri: 'CRI', lamp: 'Lamp', errors: 'Errors', warnings: 'Warnings', issues: 'Issues',
  },
  de: {
    file: 'Datei', source: 'Ausgangsdatei', format: 'Format', article: 'Artikel', name: 'Bezeichnung', manufacturer: 'Hersteller',
    type: 'Typ', symmetry: 'Symmetrie', grid: 'Raster C×γ', flux: 'Leuchtenlichtstrom, lm', lampFlux: 'Lampenlichtstrom, lm',
    watts: 'Leistung, W', efficacy: 'Lichtausbeute, lm/W', peakCd: 'Imax, cd', peakCdklm: 'Imax, cd/klm', peakDir: 'Richtung Imax',
    beam0: 'Halbwertswinkel C0–C180, °', beam90: 'Halbwertswinkel C90–C270, °', field0: 'Feldwinkel C0–C180, °', field90: 'Feldwinkel C90–C270, °',
    lor: 'LOR, %', dlor: 'Anteil nach unten, %', cct: 'Farbtemp.', cri: 'CRI', lamp: 'Lampe', errors: 'Fehler', warnings: 'Warnungen', issues: 'Hinweise',
  },
};

const ISSUE_LABELS: Record<Lang, [string, string, string, string]> = {
  ru: ['Файл', 'Исходный файл', 'Уровень', 'Замечание'],
  en: ['File', 'Source file', 'Severity', 'Issue'],
  de: ['Datei', 'Ausgangsdatei', 'Stufe', 'Hinweis'],
};
const SEVERITY: Record<Lang, Record<Issue['severity'], string>> = {
  ru: { error: 'ошибка', warning: 'предупреждение', info: 'сведения' },
  en: { error: 'error', warning: 'warning', info: 'info' },
  de: { error: 'Fehler', warning: 'Warnung', info: 'Info' },
};

function cellText(row: SummaryRow, c: Col, lang: Lang): string | number | null {
  const v = row[c.key];
  if (c.key === 'issues') return row.issues.filter((i) => i.severity !== 'info').map((i) => formatIssue(i, lang)).join(' | ');
  if (v == null || v === '') return null;
  return v as string | number;
}

// ——— CSV ———

function csvCell(v: string | number | null, decimalComma: boolean): string {
  if (v == null) return '';
  if (typeof v === 'number') return decimalComma ? String(v).replace('.', ',') : String(v);
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV для Excel: UTF-8 с BOM, разделитель «;», десятичная запятая для ru / de. */
export function summaryCsv(rows: SummaryRow[], lang: Lang): string {
  const comma = lang !== 'en';
  const head = COLS.map((c) => csvCell(LABELS[lang][c.key], comma)).join(';');
  const body = rows.map((r) => COLS.map((c) => csvCell(cellText(r, c, lang), comma)).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

/** Сводный отчёт проверки: одно замечание — одна строка. */
export function issuesCsv(rows: SummaryRow[], lang: Lang): string {
  const lines = [ISSUE_LABELS[lang].map((x) => csvCell(x, false)).join(';')];
  for (const r of rows) for (const i of r.issues) lines.push([r.file, r.source, SEVERITY[lang][i.severity], formatIssue(i, lang)].map((x) => csvCell(x, false)).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ——— XLSX (минимальный OOXML: inline-строки, без общих строк) ———

const xml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** styles.xml: 0 — обычный, 1 — заголовок (полужирный, заливка), 2 — число 0, 3 — 0.0, 4 — 0.00 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE7FF"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

type Cell = { v: string | number | null; style?: number };

function sheetXml(rows: Cell[][], widths: number[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`,
    '<sheetData>',
  ];
  rows.forEach((row, ri) => {
    const cells = row
      .map((c, ci) => {
        const ref = `${colName(ci)}${ri + 1}`;
        const s = c.style ? ` s="${c.style}"` : '';
        if (c.v == null || c.v === '') return c.style === 1 ? `<c r="${ref}"${s}/>` : '';
        if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
      })
      .join('');
    out.push(`<row r="${ri + 1}">${cells}</row>`);
  });
  out.push('</sheetData>');
  if (rows.length > 1) out.push(`<autoFilter ref="A1:${colName(widths.length - 1)}${rows.length}"/>`);
  out.push('</worksheet>');
  return out.join('');
}

const SHEET_NAMES: Record<Lang, [string, string]> = { ru: ['Сводка', 'Замечания'], en: ['Summary', 'Issues'], de: ['Übersicht', 'Hinweise'] };

/** XLSX: лист «Сводка» и лист «Замечания». */
export async function summaryXlsx(rows: SummaryRow[], lang: Lang): Promise<Uint8Array> {
  const L = LABELS[lang];
  const numStyle = (d?: number) => (d == null ? 0 : d === 0 ? 2 : d === 1 ? 3 : 4);
  const sheet1: Cell[][] = [
    COLS.map((c) => ({ v: L[c.key], style: 1 })),
    ...rows.map((r) => COLS.map((c) => ({ v: cellText(r, c, lang), style: typeof r[c.key] === 'number' ? numStyle(c.num) : 0 }))),
  ];
  const sheet2: Cell[][] = [ISSUE_LABELS[lang].map((v) => ({ v, style: 1 }))];
  for (const r of rows) for (const i of r.issues) sheet2.push([{ v: r.file }, { v: r.source }, { v: SEVERITY[lang][i.severity] }, { v: formatIssue(i, lang) }]);

  const [n1, n2] = SHEET_NAMES[lang];
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${xml(n1)}" sheetId="1" r:id="rId1"/><sheet name="${xml(n2)}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file('xl/styles.xml', STYLES);
  zip.file('xl/worksheets/sheet1.xml', sheetXml(sheet1, COLS.map((c) => c.width)));
  zip.file('xl/worksheets/sheet2.xml', sheetXml(sheet2, [34, 34, 14, 100]));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
