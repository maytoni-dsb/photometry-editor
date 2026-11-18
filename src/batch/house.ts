/**
 * Правила оформления файлов MAYTONI — применяются при любой записи IES / LDT в приложении
 * (сохранение, «Сохранить как», пакетная обработка):
 *  - производитель всегда «MAYTONI GmbH»;
 *  - LDT: строка 8 (номер протокола) пустая, строка 12 — «<дата>/<пользователь> via MAYTONI Photometry Editor
 *    version <версия>» (высоты светящей части обнуляются только в пакете «По таблице» — import-table.ts);
 *  - IES: только [TEST] (пустой — обязателен в LM-63-2002), [MANUFAC], [LUMINAIRE], [LUMCAT], [LAMP],
 *    [_SEARCH_CRI], [_SEARCH_COLORTEMP], [ISSUEDATE] <дата>, [TESTLAB] MAYTONI Photometry Editor version <версия>,
 *    [_OPERATOR] <пользователь>.
 *  - LDT, строка 2 (Ityp): 2 — линейный (длина ≥ 5 × ширины), 1 — осевая симметрия, иначе 3 (`ldtTypeIndicator`);
 *    в пакете «По таблице» заполненная колонка TypeIndicator важнее;
 *  - LDT, строка 11 — имя файла, под которым он записывается.
 * Дата — ДД.ММ.ГГГГ.
 */
import { compactSymmetry, writeIES, writeLDT, typeBToC, type Photometry, type WriteIesOptions } from '../core/index';

/**
 * Перед записью: тип B → C, полная сетка с фактической симметрией сворачивается (Isym 1–4 в LDT, последний
 * угол C 0 / 90 / 180 в IES) — например, после симметрии XZ + YZ в файл попадает Isym 4 (четыре квадранта).
 */
export function forWrite(p: Photometry): Photometry {
  return compactSymmetry(p.photometryType === 'B' ? typeBToC(p).photometry : p);
}

export const HOUSE_MANUFACTURER = 'MAYTONI GmbH';
export const EDITOR_NAME = 'MAYTONI Photometry Editor';

export interface HouseContext {
  user: string;
  version: string;
  /** Дата ДД.ММ.ГГГГ; по умолчанию — сегодня. */
  date?: string;
}

export function houseDate(d = new Date()): string {
  const p2 = (x: number) => String(x).padStart(2, '0');
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const editorLine = (ctx: HouseContext) => `${EDITOR_NAME} version ${ctx.version}`;

/** Модель с полями по правилам оформления (исходная не меняется). */
export function applyHouse(p: Photometry, ctx: HouseContext): Photometry {
  const date = ctx.date ?? houseDate();
  const q: Photometry = structuredClone(p);
  q.meta.manufacturer = HOUSE_MANUFACTURER;
  q.meta.testReport = '';
  q.meta.testLab = editorLine(ctx);
  q.meta.issueDate = date;
  const h = q.luminous.height;
  q.ldt = {
    ...(q.ldt ?? { ityp: q.symmetry === 'axial' ? 1 : 3, luminousHeights: [h, h, h, h], dff: 0, lorl: 100, conversionFactor: 1, measurementTilt: 0, directRatios: [], fileNameField: '', dateUser: '' }),
    dateUser: `${date}/${ctx.user} via ${editorLine(ctx)}`,
  };
  return q;
}

/** Ключевые слова IES по правилам оформления, в заданном порядке. */
export function houseIesKeywords(p: Photometry, ctx: HouseContext): Array<[string, string]> {
  const lamp = p.lamps[0];
  return [
    ['TEST', ''],
    ['MANUFAC', HOUSE_MANUFACTURER],
    ['LUMINAIRE', p.meta.luminaireName],
    ['LUMCAT', p.meta.article],
    ['LAMP', lamp?.type ?? ''],
    ['_SEARCH_CRI', lamp?.cri ?? ''],
    ['_SEARCH_COLORTEMP', lamp?.cct ?? ''],
    ['ISSUEDATE', ctx.date ?? houseDate()],
    ['TESTLAB', editorLine(ctx)],
    ['_OPERATOR', ctx.user],
  ];
}

/** Текст IES по правилам оформления. */
export function houseIES(p: Photometry, ctx: HouseContext, opts: WriteIesOptions = {}): string {
  const q = applyHouse(forWrite(p), ctx);
  return writeIES(q, { lineEnding: 'CRLF', ...opts, keywords: houseIesKeywords(q, ctx) });
}

/** Во сколько раз длина должна превосходить ширину, чтобы светильник считался линейным (Ityp 2). */
export const LINEAR_RATIO = 5;

/**
 * Ityp LDT: 2 — линейный светильник (длина ≥ 5 × ширины корпуса; если размеров корпуса нет — светящей части),
 * 1 — точечный с осевой симметрией, 3 — точечный с другой симметрией или без неё.
 * p — уже свёрнутая модель (forWrite), чтобы осевая симметрия была видна по флагу.
 */
export function ldtTypeIndicator(p: Photometry): 1 | 2 | 3 {
  const d = p.luminaire.length > 0 ? p.luminaire : p.luminous;
  const linear = d.shape === 'rect' && d.width > 0 && d.length >= LINEAR_RATIO * d.width;
  if (linear) return 2;
  return p.symmetry === 'axial' || p.hAngles.length === 1 ? 1 : 3;
}

/** Текст LDT по правилам оформления. fileName — имя файла на диске (строка 11); ityp — задать явно (таблица). */
export function houseLDT(p: Photometry, ctx: HouseContext, fileName: string, ityp?: number): string {
  const q = applyHouse(forWrite(p), ctx);
  q.ldt!.ityp = ityp != null && [1, 2, 3].includes(ityp) ? ityp : ldtTypeIndicator(q);
  return writeLDT(q, { lineEnding: 'CRLF', fileName }).text;
}
