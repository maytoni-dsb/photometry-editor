/**
 * Минимальное чтение и запись XLSX для таблицы пакетной обработки (ImportData):
 * листы, ячейки как текст. Формулы не вычисляются — берётся сохранённое значение.
 */
import JSZip from 'jszip';

export interface XlsxSheet {
  name: string;
  /** Путь листа в архиве, напр. «xl/worksheets/sheet1.xml». */
  path: string;
  /** Ячейки как текст; строки выровнены по самой длинной. */
  rows: string[][];
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const xmlEsc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Текст всех <t> внутри фрагмента (общая строка или inlineStr, в т. ч. с форматированием). */
const textOf = (frag: string) => [...frag.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unxml(m[1] ?? '')).join('');

/** Индекс колонки из ссылки «AB12» → 27. */
function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Число из Excel — без хвостов двоичной дроби (0.065000000000000002 → 0.065). */
function numText(v: string): string {
  const x = Number(v);
  if (!Number.isFinite(x)) return v;
  return String(parseFloat(x.toPrecision(15)));
}

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}

export async function readXlsx(bytes: Uint8Array): Promise<{ sheets: XlsxSheet[]; zip: JSZip }> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (p: string) => (await zip.file(p)?.async('string')) ?? null;
  const wb = await read('xl/workbook.xml');
  if (!wb) throw new Error('not-xlsx');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) relMap.set(id, resolve('xl/workbook.xml', target));
  }
  const ssXml = (await read('xl/sharedStrings.xml')) ?? '';
  const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const sheets: XlsxSheet[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unxml(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1] ?? /\bid="([^"]+)"/.exec(m[1])?.[1];
    const path = rid ? relMap.get(rid) : undefined;
    if (!path) continue;
    const xml = await read(path);
    if (xml == null) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rIdx = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
      const row: string[] = [];
      let next = 0;
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
        const body = cm[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let text = '';
        if (type === 's') text = v != null ? (shared[Number(v)] ?? '') : '';
        else if (type === 'inlineStr') text = textOf(body);
        else if (type === 'str' || type === 'e') text = v != null ? unxml(v) : '';
        else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else text = v != null ? numText(v) : '';
        row[ci] = text;
      }
      rows[rIdx] = Array.from(row, (x) => x ?? '');
    }
    const width = rows.reduce((w, r) => Math.max(w, r?.length ?? 0), 0);
    sheets.push({ name, path, rows: Array.from(rows, (r) => Array.from({ length: width }, (_, i) => r?.[i] ?? '')) });
  }
  return { sheets, zip };
}

/** Число в ячейке: «0.052», «-1», «0,052» (запятая — тоже). */
const NUM = /^-?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?$/i;

/** XML листа из текстовых ячеек; числа пишутся числами, остальное — строками. */
export function sheetXml(rows: string[][], widths?: number[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
  ];
  if (widths?.length) out.push(`<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`);
  out.push('<sheetData>');
  rows.forEach((row, ri) => {
    const cells = row
      .map((v, ci) => {
        const ref = `${colName(ci)}${ri + 1}`;
        const s = (v ?? '').trim();
        if (!s) return '';
        if (ri > 0 && NUM.test(s)) return `<c r="${ref}"><v>${Number(s.replace(',', '.'))}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      })
      .join('');
    out.push(`<row r="${ri + 1}">${cells}</row>`);
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

/**
 * Записать таблицу: если есть исходная книга — заменяется только её лист (остальные листы, напр. «Info»,
 * сохраняются), иначе — новая книга с одним листом.
 */
export async function writeXlsx(rows: string[][], opts: { sheetName: string; base?: { zip: JSZip; path: string } }): Promise<Uint8Array> {
  const widths = (rows[0] ?? []).map((_, i) => Math.min(48, Math.max(8, ...rows.slice(0, 200).map((r) => (r[i] ?? '').length + 2))));
  if (opts.base) {
    const zip = opts.base.zip;
    zip.file(opts.base.path, sheetXml(rows, widths));
    // вычисленные значения формул и кэш вычислений могут устареть — Excel пересчитает
    zip.remove('xl/calcChain.xml');
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${xmlEsc(opts.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file('xl/worksheets/sheet1.xml', sheetXml(rows, widths));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
