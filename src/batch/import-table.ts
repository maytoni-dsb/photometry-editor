/**
 * Пакетная обработка по таблице ImportData (как скрипт MATLAB заказчика):
 * строка таблицы = артикул; исходный файл в папке photometry ищется по артикулу (LDT приоритетнее IES);
 * тело симметрируется по SymmetryIndicator, нормируется (1000 лм × поток из таблицы), поля заполняются
 * из таблицы. NumberOfLampSets > 1 — по файлу на каждый комплект: «<артикул> @ <CCT>K».
 *
 * Размеры в таблице — в метрах (лист Info), в модели — мм. Ширина 0 — круглая форма (длина = диаметр).
 */
import { applyOp, type Issue, type LampSet, type Photometry, type Symmetry } from '../core/index';

/** Известные колонки (имена как в шаблоне ImportData; сравнение без учёта регистра). */
export const IMPORT_COLUMNS = [
  'ID',
  'Company',
  'LuminaireNumber',
  'LuminaireName',
  'TypeIndicator',
  'SymmetryIndicator',
  'LuminaireLength',
  'LuminaireWidth',
  'LuminaireHeight',
  'LEOlength',
  'LEOwidth',
  'NumberOfLampSets',
  'NumberOfLamps',
  'LampType',
  'LuminousFlux',
  'CCT',
  'CRI',
  'Power',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Колонки, где можно перечислить значения по комплектам через запятую. */
const LIST_COLUMNS: ImportColumn[] = ['NumberOfLamps', 'LampType', 'LuminousFlux', 'CCT', 'CRI', 'Power'];

export interface ImportTable {
  /** Заголовки (первая строка листа), в т. ч. незнакомые — они сохраняются при записи. */
  columns: string[];
  /** Ячейки как текст. */
  rows: string[][];
}

export interface RowMessage {
  level: 'error' | 'warning';
  code: string;
  col?: ImportColumn;
  params?: Record<string, string | number>;
}

/** Найденные исходные файлы: ключ — имя без расширения в нижнем регистре. */
export type SourceIndex = Map<string, { ies?: string; ldt?: string }>;

export interface OutputPlan {
  /** Имя без расширения. */
  base: string;
  set: number;
  flux: number;
  cct: string;
}

export interface RowPlan {
  row: number;
  article: string;
  status: 'ok' | 'warning' | 'error' | 'empty';
  messages: RowMessage[];
  /** Имя исходного файла (с расширением). */
  source?: string;
  sourceFormats: Array<'IES' | 'LDT'>;
  symmetry: Exclude<Symmetry, 'bilateral' | 'none'> | null;
  outputs: OutputPlan[];
}

export function emptyTable(): ImportTable {
  return { columns: [...IMPORT_COLUMNS], rows: [] };
}

/** Таблица из ячеек листа: первая строка — заголовки; пустые строки в конце отбрасываются. */
export function tableFromCells(cells: string[][]): ImportTable {
  const columns = (cells[0] ?? []).map((c) => c.trim());
  const rows = cells.slice(1).map((r) => columns.map((_, i) => (r[i] ?? '').trim()));
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return { columns, rows };
}

export const tableToCells = (t: ImportTable): string[][] => [t.columns, ...t.rows];

/** Лист с таблицей: «ImportData», иначе первый лист, где есть колонка LuminaireNumber. */
export function pickSheet<T extends { name: string; rows: string[][] }>(sheets: T[]): T | null {
  const has = (s: T) => (s.rows[0] ?? []).some((c) => c.trim().toLowerCase() === 'luminairenumber');
  return sheets.find((s) => s.name.trim().toLowerCase() === 'importdata' && has(s)) ?? sheets.find(has) ?? null;
}

export function colIdx(t: ImportTable, c: ImportColumn): number {
  const k = c.toLowerCase();
  return t.columns.findIndex((x) => x.toLowerCase() === k);
}

export function cell(t: ImportTable, row: number, c: ImportColumn): string {
  const i = colIdx(t, c);
  return i < 0 ? '' : (t.rows[row]?.[i] ?? '').trim();
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
const list = (s: string) => s.split(/[;,]/).map((x) => x.trim()).filter((x) => x !== '');

const SYM: Record<number, Exclude<Symmetry, 'bilateral' | 'none'> | null> = { 0: null, 1: 'axial', 2: 'c0c180', 3: 'c90c270', 4: 'quadrant' };

/** CCT для имени: «3000» → «3000K», «3000K» → «3000K». */
export const cctLabel = (cct: string) => (/k$/i.test(cct.trim()) ? cct.trim().replace(/k$/i, 'K') : `${cct.trim()}K`);

/** Индекс исходных файлов по именам (без расширения, без учёта регистра). */
export function indexSources(names: string[]): SourceIndex {
  const m: SourceIndex = new Map();
  for (const n of names) {
    const ext = /\.(ies|ldt)$/i.exec(n)?.[1]?.toLowerCase() as 'ies' | 'ldt' | undefined;
    if (!ext) continue;
    const key = n.replace(/\.(ies|ldt)$/i, '').trim().toLowerCase();
    const e = m.get(key) ?? {};
    e[ext] = n;
    m.set(key, e);
  }
  return m;
}

/** Значения по комплектам: список из n значений или одно — на все; иначе null (ошибка). */
function perSet(s: string, n: number): string[] | null {
  const v = list(s);
  if (v.length === 0) return Array(n).fill('');
  if (v.length === 1) return Array(n).fill(v[0]);
  return v.length === n ? v : null;
}

/** Разбор и проверка строки: что получится и что не так. */
export function planRow(t: ImportTable, row: number, sources: SourceIndex): RowPlan {
  const g = (c: ImportColumn) => cell(t, row, c);
  const article = g('LuminaireNumber');
  const msgs: RowMessage[] = [];
  const plan: RowPlan = { row, article, status: 'ok', messages: msgs, sourceFormats: [], symmetry: null, outputs: [] };
  if ((t.rows[row] ?? []).every((c) => !c.trim())) return { ...plan, status: 'empty' };
  const err = (code: string, col?: ImportColumn, params?: RowMessage['params']) => msgs.push({ level: 'error', code, col, params });
  const warn = (code: string, col?: ImportColumn, params?: RowMessage['params']) => msgs.push({ level: 'warning', code, col, params });

  for (const c of ['LuminaireNumber', 'LuminousFlux'] as const) if (colIdx(t, c) < 0) err('noColumn', undefined, { col: c });

  if (!article) err('noArticle', 'LuminaireNumber');
  else {
    const src = sources.get(article.toLowerCase());
    if (!src) err('noSource', 'LuminaireNumber');
    else {
      plan.source = src.ldt ?? src.ies;
      plan.sourceFormats = [...(src.ldt ? (['LDT'] as const) : []), ...(src.ies ? (['IES'] as const) : [])];
      if (src.ldt && src.ies) warn('bothFormats', 'LuminaireNumber', { file: src.ldt });
    }
  }

  // симметрия и тип
  const symS = g('SymmetryIndicator');
  if (symS !== '') {
    const s = num(symS);
    if (!(Number.isInteger(s) && s >= 0 && s <= 4)) err('badSymmetry', 'SymmetryIndicator', { v: symS });
    else plan.symmetry = SYM[s];
  }
  const typS = g('TypeIndicator');
  if (typS !== '' && !(Number.isInteger(num(typS)) && num(typS) >= 0 && num(typS) <= 3)) err('badType', 'TypeIndicator', { v: typS });

  // размеры, м
  for (const c of ['LuminaireLength', 'LuminaireWidth', 'LuminaireHeight', 'LEOlength', 'LEOwidth'] as const) {
    const s = g(c);
    if (s === '') continue;
    const v = num(s);
    if (!Number.isFinite(v) || v < 0) err('badNumber', c, { v: s });
    else if (v > 10) warn('mmNotM', c, { v: s });
  }

  // комплекты
  const setsS = g('NumberOfLampSets');
  let n = 1;
  if (setsS !== '') {
    n = num(setsS);
    if (!(Number.isInteger(n) && n >= 1 && n <= 20)) {
      err('badSets', 'NumberOfLampSets', { v: setsS });
      n = 1;
    }
  }
  const fluxes = perSet(g('LuminousFlux'), n);
  if (!fluxes) err('listLength', 'LuminousFlux', { n, got: list(g('LuminousFlux')).length });
  else if (fluxes.some((f) => !(num(f) > 0))) err('badFlux', 'LuminousFlux', { v: g('LuminousFlux') || '—' });
  const ccts = perSet(g('CCT'), n);
  for (const c of ['NumberOfLamps', 'LampType', 'CRI', 'Power'] as const) {
    if (!perSet(g(c), n)) err('listLength', c, { n, got: list(g(c)).length });
  }
  for (const c of ['NumberOfLamps', 'Power'] as const) {
    const v = perSet(g(c), n);
    if (v && v.some((x) => x !== '' && !Number.isFinite(num(x)))) err('badNumber', c, { v: g(c) });
  }
  if (!ccts) err('listLength', 'CCT', { n, got: list(g('CCT')).length });
  else if (n > 1) {
    if (ccts.some((c) => !c)) err('cctNeeded', 'CCT');
    else if (new Set(ccts.map((c) => cctLabel(c).toLowerCase())).size < n) err('cctRepeat', 'CCT');
  }

  if (fluxes && ccts && article) {
    plan.outputs = fluxes.map((f, i) => ({
      base: n > 1 ? `${article} @ ${cctLabel(ccts[i])}` : article,
      set: i,
      flux: num(f),
      cct: ccts[i],
    }));
  }
  plan.status = msgs.some((m) => m.level === 'error') ? 'error' : msgs.length ? 'warning' : 'ok';
  return plan;
}

/** Повторы артикулов — у второй и следующих строк ошибка (одинаковые имена файлов). */
export function planTable(t: ImportTable, sources: SourceIndex): RowPlan[] {
  const plans = t.rows.map((_, i) => planRow(t, i, sources));
  const seen = new Map<string, number>();
  for (const p of plans) {
    if (!p.article) continue;
    const k = p.article.toLowerCase();
    if (seen.has(k)) {
      p.messages.push({ level: 'error', code: 'duplicate', col: 'LuminaireNumber', params: { row: seen.get(k)! + 2 } });
      p.status = 'error';
    } else seen.set(k, p.row);
  }
  return plans;
}

/** Размеры корпуса / светящей части из метров таблицы. Ширина 0 — круг. */
function dims(lengthM: string, widthM: string, heightM: string, prev: Photometry['luminaire']): Photometry['luminaire'] {
  const mm = (s: string, d: number) => (s === '' ? d : Math.round(num(s) * 1000 * 100) / 100);
  const length = mm(lengthM, prev.length);
  const width = mm(widthM, prev.width);
  const height = mm(heightM, prev.height);
  return { shape: width === 0 && length > 0 ? 'circle' : 'rect', length, width, height };
}

/**
 * Файл для комплекта set строки: симметрия → нормировка (поток светильника = поток из таблицы,
 * т. е. 1000 лм в кд/клм × Φ) → поля из таблицы.
 */
export function applyRow(p0: Photometry, t: ImportTable, row: number, set: number): { photometry: Photometry; issues: Issue[] } {
  const plan = planRow(t, row, new Map([[cell(t, row, 'LuminaireNumber').toLowerCase(), { ldt: 'x.ldt' }]]));
  const g = (c: ImportColumn) => cell(t, row, c);
  const n = plan.outputs.length || 1;
  const pick = (c: ImportColumn) => (perSet(g(c), n) ?? [])[set] ?? '';
  const issues: Issue[] = [];
  let p = p0;
  if (plan.symmetry && p.photometryType === 'C') {
    const r = applyOp(p, { op: 'symmetrize', symmetry: plan.symmetry });
    p = r.photometry;
    issues.push(...r.issues);
  }
  const flux = plan.outputs[set]?.flux ?? num(pick('LuminousFlux'));
  const r = applyOp(p, { op: 'normalize', mode: 'flux', value: flux });
  p = r.photometry;
  issues.push(...r.issues);

  const q: Photometry = structuredClone(p);
  const company = g('Company');
  const name = g('LuminaireName');
  if (company) q.meta.manufacturer = company;
  if (name) q.meta.luminaireName = name;
  q.meta.article = g('LuminaireNumber');
  q.luminaire = dims(g('LuminaireLength'), g('LuminaireWidth'), g('LuminaireHeight'), q.luminaire);
  const lum = dims(g('LEOlength'), g('LEOwidth'), '', q.luminous);
  q.luminous = { ...lum, height: q.luminous.height };

  const countS = pick('NumberOfLamps');
  const count = countS === '' ? (q.lamps[0]?.count ?? 1) : Math.round(num(countS));
  const watts = pick('Power') === '' ? (q.lamps[0]?.watts ?? q.inputWatts) : num(pick('Power'));
  const lamp: LampSet = {
    count,
    flux,
    type: pick('LampType') || q.lamps[0]?.type || '',
    cct: pick('CCT') || q.lamps[0]?.cct || '',
    cri: pick('CRI') || q.lamps[0]?.cri || '',
    watts,
  };
  q.lamps = [lamp];
  q.absolute = count < 0;
  q.inputWatts = watts;
  const ityp = num(g('TypeIndicator'));
  const h = q.luminous.height;
  q.ldt = {
    ...(q.ldt ?? { luminousHeights: [h, h, h, h], dff: 0, lorl: 100, conversionFactor: 1, measurementTilt: 0, directRatios: [], fileNameField: '', dateUser: '' }),
    ityp: Number.isInteger(ityp) ? ityp : (q.ldt?.ityp ?? (plan.symmetry === 'axial' ? 1 : 3)),
  };
  return { photometry: q, issues };
}
