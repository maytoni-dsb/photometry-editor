/**
 * Генерация вариантов (ТЗ, раздел «Генерация вариантов»).
 *
 * Из одного измеренного файла — по файлу на строку таблицы: форма КСС та же, меняются поток
 * и паспортные данные (ЦТ, CRI, мощность, лампа). Силы света масштабируются на отношение потоков —
 * той же операцией, что «Нормировка → коэффициент» (поток ламп / заявленный поток умножаются на тот же
 * коэффициент, в относительной фотометрии кд/клм не меняются).
 * Имя файла — «<артикул> @ <суффикс>».
 */

import { applyOp, issue, referenceFlux, computeFlux, typeBToC, type Issue, type Photometry } from '../core/index';
import { clonePhotometry, type LampSet } from '../core/model';

export const VARIANTS_TYPE = 'photometry-editor/variants';

/** Строка таблицы вариантов. Пустое поле — значение исходного файла. */
export interface VariantRow {
  suffix: string;
  cct?: string;
  /** Поток, лм: для относительной фотометрии — поток ламп, для абсолютной — поток светильника. */
  flux?: number | null;
  /** Коэффициент к исходному потоку (если поток не задан). */
  factor?: number | null;
  cri?: string;
  watts?: number | null;
  lamp?: string;
}

export interface VariantTemplate {
  name: string;
  rows: VariantRow[];
}

export type VariantField = keyof VariantRow;
export const VARIANT_FIELDS: VariantField[] = ['suffix', 'cct', 'flux', 'factor', 'cri', 'watts', 'lamp'];

/** Число из ячейки: пробелы-разделители разрядов, запятая или точка. Пусто / мусор → null. */
export function cellNumber(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.replace(/[\s  ]/g, '').replace(',', '.').replace(/(лм|lm|вт|w)$/i, '');
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

/** Суффикс по умолчанию — ЦТ: «4000» → «4000K». */
export function defaultSuffix(r: VariantRow): string {
  const cct = (r.cct ?? '').trim();
  if (!cct) return '';
  return /^\d+(?:[.,]\d+)?$/.test(cct) ? `${cct}K` : cct;
}

const HEADER: Array<[VariantField, RegExp]> = [
  ['suffix', /^(суффикс|вариант|suffix|variant|suffix des namens|zusatz)$/i],
  ['cct', /^(цт|цв\.?\s*темп.*|цветовая температура.*|cct|colou?r\s*temp.*|farbtemperatur.*|tcp|k)$/i],
  ['flux', /^(поток.*|световой поток.*|flux.*|lumen.*|lichtstrom.*|лм|lm)$/i],
  ['factor', /^(коэфф.*|множитель|factor|faktor|k\s*потока)$/i],
  ['cri', /^(cri|ra|индекс цветопередачи|цветопередача|farbwiedergabe.*)$/i],
  ['watts', /^(мощность.*|вт|w|power.*|watt.*|leistung.*)$/i],
  ['lamp', /^(лампа.*|тип лампы|lamp.*|lampe.*)$/i],
];

/** Колонки без заголовка — в этом порядке. */
const DEFAULT_ORDER: VariantField[] = ['suffix', 'cct', 'flux', 'cri', 'watts', 'lamp'];

function headerField(cell: string): VariantField | null {
  const c = cell.trim().replace(/[,;:]?\s*\(.*\)$/, '').replace(/,\s*(лм|lm|вт|w|k|к)$/i, '').trim();
  for (const [f, re] of HEADER) if (re.test(c)) return f;
  return null;
}

/**
 * Таблица, вставленная из Excel / Google Таблиц (табуляция) или CSV (;).
 * Первая строка — заголовок, если в ней узнаются названия колонок; иначе порядок
 * «суффикс, ЦТ, поток, CRI, мощность, лампа». Поток со знаком % — коэффициент («95%» → 0,95).
 */
export function parseVariantTable(text: string): VariantRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : '\t';
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  const head = cells[0].map(headerField);
  const hasHeader = head.filter(Boolean).length >= 2 || (head.filter(Boolean).length === 1 && cells[0].length === 1);
  const order = hasHeader ? head : DEFAULT_ORDER;
  const rows: VariantRow[] = [];
  for (const r of hasHeader ? cells.slice(1) : cells) {
    const row: VariantRow = { suffix: '' };
    r.forEach((v, i) => {
      const f = order[i];
      if (!f || v === '') return;
      if (f === 'flux' && /%\s*$/.test(v)) {
        const k = cellNumber(v.replace('%', ''));
        if (k != null) row.factor = k / 100;
      } else if (f === 'flux' || f === 'factor' || f === 'watts') row[f] = cellNumber(v);
      else row[f] = v;
    });
    if (!row.suffix) row.suffix = defaultSuffix(row);
    if (VARIANT_FIELDS.some((f) => row[f] != null && row[f] !== '')) rows.push(row);
  }
  return rows;
}

export function templateToJson(t: VariantTemplate): string {
  return JSON.stringify({ type: VARIANTS_TYPE, version: 1, name: t.name, rows: t.rows }, null, 2);
}

export function templateFromJson(text: string, fallbackName = ''): VariantTemplate {
  const o = JSON.parse(text) as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !Array.isArray(o.rows) || (o.type != null && o.type !== VARIANTS_TYPE)) throw new Error('not-variants');
  const str = (x: unknown) => (x == null ? undefined : String(x));
  const nm = (x: unknown) => (x == null || x === '' ? null : typeof x === 'number' ? x : cellNumber(String(x)));
  const rows = (o.rows as Array<Record<string, unknown>>).map((r) => ({
    suffix: String(r.suffix ?? ''),
    cct: str(r.cct),
    flux: nm(r.flux),
    factor: nm(r.factor),
    cri: str(r.cri),
    watts: nm(r.watts),
    lamp: str(r.lamp),
  }));
  return { name: typeof o.name === 'string' ? o.name : fallbackName, rows };
}

/** Угол луча, указанный в названии лампы: «GU10 36°», «PAR16 60 deg» → 36 / 60. */
export function lampBeamAngle(s: string | undefined): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:°|º|deg\b|град)/i.exec(s ?? '');
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Проблемы строки, из-за которых вариант не построить. */
export function rowError(r: VariantRow): 'no-suffix' | 'bad-flux' | 'bad-factor' | null {
  if (!r.suffix.trim()) return 'no-suffix';
  if (r.flux != null && !(r.flux > 0)) return 'bad-flux';
  if (r.flux == null && r.factor != null && !(r.factor > 0)) return 'bad-factor';
  return null;
}

/** Поток исходного файла, от которого считается коэффициент (как в паспорте и кд/клм). */
export function variantBaseFlux(p: Photometry): number {
  const c = p.photometryType === 'B' ? typeBToC(p).photometry : p;
  return referenceFlux(p, computeFlux(c).total).value;
}

export interface VariantResult {
  photometry: Photometry;
  issues: Issue[];
  /** Коэффициент, на который умножены силы света. */
  factor: number;
}

/** Строит вариант. Ошибку строки нужно проверить заранее (rowError). */
export function makeVariant(p: Photometry, r: VariantRow): VariantResult {
  const base = variantBaseFlux(p);
  const k = r.flux != null && r.flux > 0 ? r.flux / base : r.factor != null && r.factor > 0 ? r.factor : 1;
  const issues: Issue[] = [];
  let out: Photometry;
  if (Math.abs(k - 1) > 1e-12) {
    const res = applyOp(p, { op: 'normalize', mode: 'factor', value: k });
    out = res.photometry;
    issues.push(...res.issues);
  } else out = clonePhotometry(p);

  const lamp: LampSet = out.lamps[0] ?? { count: out.absolute ? -1 : 1, flux: null, type: '', cct: '', cri: '', watts: out.inputWatts };
  if (!out.lamps.length) out.lamps.push(lamp);
  // поток задан точно — без накопления ошибки округления
  if (r.flux != null && r.flux > 0 && lamp.flux != null && lamp.flux > 0) lamp.flux = r.flux;
  if (r.cct?.trim()) lamp.cct = r.cct.trim();
  if (r.cri?.trim()) lamp.cri = r.cri.trim();
  if (r.lamp?.trim()) lamp.type = r.lamp.trim();
  if (r.watts != null && r.watts > 0) {
    lamp.watts = r.watts;
    out.inputWatts = r.watts;
  }

  // другой угол луча у лампы — масштабированием такую КСС не получить
  const newAngle = lampBeamAngle(r.lamp);
  const oldAngle = lampBeamAngle(p.lamps[0]?.type);
  if (newAngle != null && (oldAngle == null || Math.abs(newAngle - oldAngle) > 0.5)) {
    issues.push(issue('variant-beam-angle', 'warning', { suffix: r.suffix, angle: newAngle, source: oldAngle != null ? `${oldAngle}°` : '—' }));
  }
  return { photometry: out, issues, factor: k };
}
