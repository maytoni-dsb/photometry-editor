/**
 * Правила оформления файлов MAYTONI — применяются при любой записи IES / LDT в приложении
 * (сохранение, «Сохранить как», пакетная обработка):
 *  - производитель всегда «MAYTONI GmbH»;
 *  - LDT: строка 8 (номер протокола) пустая, строка 12 — «<дата>/<пользователь> via MAYTONI Photometry Editor
 *    version <версия>», высоты светящей части во всех четырёх плоскостях — 0;
 *  - IES: только [TEST] (пустой — обязателен в LM-63-2002), [MANUFAC], [LUMINAIRE], [LUMCAT], [LAMP],
 *    [_SEARCH_CRI], [_SEARCH_COLORTEMP], [ISSUEDATE] <дата>, [TESTLAB] MAYTONI Photometry Editor version <версия>,
 *    [_OPERATOR] <пользователь>.
 * Дата — ДД.ММ.ГГГГ.
 */
import { writeIES, writeLDT, typeBToC, type Photometry, type WriteIesOptions } from '../core/index';

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
    luminousHeights: [0, 0, 0, 0],
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
  const q = applyHouse(p, ctx);
  return writeIES(q, { lineEnding: 'CRLF', ...opts, keywords: houseIesKeywords(q, ctx) });
}

/** Текст LDT по правилам оформления. */
export function houseLDT(p: Photometry, ctx: HouseContext, fileName: string): string {
  const q = applyHouse(p, ctx);
  return writeLDT(q.photometryType === 'B' ? typeBToC(q).photometry : q, { lineEnding: 'CRLF', fileName }).text;
}
