/** Декодирование текста файлов и разбор чисел. */

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'windows-1252';
  lineEnding: 'LF' | 'CRLF';
}

/** Декодирует байты: UTF-8 (с BOM или без), при ошибке — Windows-1252. */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  let text: string;
  let encoding: DecodedText['encoding'] = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
    encoding = 'windows-1252';
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lineEnding = text.includes('\r\n') ? 'CRLF' : 'LF';
  return { text, encoding, lineEnding };
}

/** Разбивает текст на строки, убирая \r. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Число из строки: допускает десятичную запятую. NaN, если не число. */
export function parseNum(s: string): number {
  const t = s.trim().replace(',', '.');
  if (t === '') return NaN;
  const n = Number(t);
  return n;
}

/** Разбивает поток значений IES на токены: пробелы, табы, переводы строк и запятые. */
export function tokenize(text: string): string[] {
  return text.split(/[\s,]+/).filter((t) => t.length > 0);
}

/**
 * Форматирует число для записи: не больше `digits` знаков после запятой,
 * без хвостовых нулей и без «-0».
 */
export function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** Форматирует число с фиксированным числом знаков (как принято в LDT: «100.0»). */
export function fmtFixed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return s.startsWith('-') && Number(s) === 0 ? s.slice(1) : s;
}

/** Значимые знаки: для сил света сохраняем ~6 значащих цифр. */
export function fmtSig(n: number, sig = 6): string {
  if (n === 0 || !Number.isFinite(n)) return '0';
  const mag = Math.floor(Math.log10(Math.abs(n)));
  const digits = Math.max(0, Math.min(8, sig - 1 - mag));
  return fmt(n, digits);
}
