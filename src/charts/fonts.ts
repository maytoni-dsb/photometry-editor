/**
 * Шрифты для векторного экспорта: разбор (fontkit), метрики, контуры глифов
 * (текст кривыми в EPS и по выбору в PDF).
 *
 * По умолчанию — Roboto (Apache 2.0), файлы лежат в public/fonts.
 * Пользователь может подключить свой TTF/OTF (фирменный шрифт).
 */

import fontkit from '@pdf-lib/fontkit';
import { PT_TO_MM, type MeasureText } from './scene';
import type { Seg } from './vector';

/** Сырые байты шрифтов, которыми рисуется график. */
export interface FontSet {
  regular: Uint8Array;
  /** Для заголовка; если нет — используется regular. */
  bold?: Uint8Array;
  /**
   * Запасной шрифт для символов, которых нет в основном (например, Φ и γ в Suisse Intl).
   * В приложении — встроенный Roboto.
   */
  fallback?: Uint8Array;
}

// Типы fontkit (минимально необходимые)
export interface FkPathCommand { command: string; args: number[] }
export interface FkGlyph { id: number; advanceWidth: number; path: { commands: FkPathCommand[] } }
export interface FkSubset { includeGlyph(g: FkGlyph | number): number; encodeStream(): { on(ev: string, cb: (x?: Uint8Array | Error) => void): unknown } }
export interface FkFont {
  unitsPerEm: number;
  postscriptName: string | null;
  familyName: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  directory: { tables: Record<string, unknown> };
  glyphsForString(s: string): FkGlyph[];
  glyphForCodePoint(cp: number): FkGlyph;
  hasGlyphForCodePoint(cp: number): boolean;
  getGlyph(id: number): FkGlyph;
  createSubset(): FkSubset;
}

const cache = new WeakMap<Uint8Array, FkFont>();

export function openFont(bytes: Uint8Array): FkFont {
  let f = cache.get(bytes);
  if (!f) {
    f = (fontkit as unknown as { create(b: Uint8Array): FkFont }).create(bytes);
    cache.set(bytes, f);
  }
  return f;
}

/** Шрифт с контурами CFF (OTF). */
export function isCff(f: FkFont): boolean {
  return 'CFF ' in f.directory.tables || 'CFF2' in f.directory.tables;
}

export interface PlacedGlyph {
  font: FkFont;
  glyph: FkGlyph;
}

/**
 * Глифы строки: символ берётся из основного шрифта, а если его там нет — из запасного.
 * Кернинг и лигатуры не применяются (так же текст рисует PostScript show и SVG без шейпинга).
 */
export function glyphsFor(f: FkFont, text: string, fallback?: FkFont | null): PlacedGlyph[] {
  const out: PlacedGlyph[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const font = !f.hasGlyphForCodePoint(cp) && fallback && fallback.hasGlyphForCodePoint(cp) ? fallback : f;
    out.push({ font, glyph: font.glyphForCodePoint(cp) });
  }
  return out;
}

/** Есть ли в шрифте все символы строки. */
export function hasAllGlyphs(f: FkFont, text: string): boolean {
  for (const ch of text) if (!f.hasGlyphForCodePoint(ch.codePointAt(0)!)) return false;
  return true;
}

/** Ширина строки в единицах em основного шрифта (с учётом запасного). */
export function textWidthEm(f: FkFont, text: string, fallback?: FkFont | null): number {
  return glyphsFor(f, text, fallback).reduce((s, g) => s + g.glyph.advanceWidth / g.font.unitsPerEm, 0);
}

/** Функция измерения текста (мм) по реальным метрикам шрифтов. */
export function fontMeasure(fonts: FontSet): MeasureText {
  const reg = openFont(fonts.regular);
  const bold = fonts.bold ? openFont(fonts.bold) : reg;
  const fb = fonts.fallback ? openFont(fonts.fallback) : null;
  return (text, sizePt, isBold) => textWidthEm(isBold ? bold : reg, text, fb) * sizePt * PT_TO_MM;
}

/**
 * Контуры текста в пунктах (Y вверх): база (x, y), кегль, поворот против часовой стрелки.
 * Квадратичные сегменты TrueType переводятся в кубические.
 */
export function textOutline(f: FkFont, text: string, x: number, y: number, sizePt: number, rotateDeg: number, fallback?: FkFont | null): Seg[] {
  let s = sizePt / f.unitsPerEm;
  const a = (rotateDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const segs: Seg[] = [];
  let pen = 0; // в пунктах
  const T = (px: number, py: number): [number, number] => {
    const u = pen + px * s;
    const v = py * s;
    return [x + u * ca - v * sa, y + u * sa + v * ca];
  };
  for (const { font, glyph: g } of glyphsFor(f, text, fallback)) {
    s = sizePt / font.unitsPerEm;
    let cx = 0;
    let cy = 0;
    let open = false;
    for (const c of g.path.commands) {
      const q = c.args;
      switch (c.command) {
        case 'moveTo':
          if (open) segs.push(['Z']);
          segs.push(['M', ...T(q[0], q[1])]);
          [cx, cy] = [q[0], q[1]];
          open = true;
          break;
        case 'lineTo':
          segs.push(['L', ...T(q[0], q[1])]);
          [cx, cy] = [q[0], q[1]];
          break;
        case 'quadraticCurveTo': {
          const c1 = T(cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy));
          const c2 = T(q[2] + (2 / 3) * (q[0] - q[2]), q[3] + (2 / 3) * (q[1] - q[3]));
          segs.push(['C', ...c1, ...c2, ...T(q[2], q[3])]);
          [cx, cy] = [q[2], q[3]];
          break;
        }
        case 'bezierCurveTo':
          segs.push(['C', ...T(q[0], q[1]), ...T(q[2], q[3]), ...T(q[4], q[5])]);
          [cx, cy] = [q[4], q[5]];
          break;
        case 'closePath':
          segs.push(['Z']);
          open = false;
          break;
      }
    }
    if (open) segs.push(['Z']);
    pen += g.advanceWidth * s;
  }
  return segs;
}

/**
 * Можно ли встроить шрифт в PDF текстом. Подмножества OTF с контурами CFF fontkit собирает
 * с ошибками (просмотрщики считают шрифт повреждённым), поэтому такой текст идёт кривыми.
 * TrueType (TTF, WOFF с glyf) встраивается подмножеством.
 */
export function canEmbed(f: FkFont): boolean {
  return !isCff(f);
}

/**
 * WOFF 1.0 → обычный TTF/OTF (sfnt). Подмножество для PDF fontkit собирает из WOFF в десятки раз
 * медленнее (таблицы распаковываются заново), поэтому в пакетной выгрузке встроенный Roboto
 * один раз распаковывается. Другие форматы возвращаются как есть.
 */
export async function woffToSfnt(bytes: Uint8Array): Promise<Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || dv.getUint32(0) !== 0x774f4646) return bytes; // 'wOFF'
  const flavor = dv.getUint32(4);
  const n = dv.getUint16(12);
  const tables: Array<{ tag: number; checksum: number; data: Uint8Array }> = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const tag = dv.getUint32(o);
    const offset = dv.getUint32(o + 4);
    const compLength = dv.getUint32(o + 8);
    const origLength = dv.getUint32(o + 12);
    const checksum = dv.getUint32(o + 16);
    let data = bytes.subarray(offset, offset + compLength);
    if (compLength < origLength) {
      const ds = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
      data = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    tables.push({ tag, checksum, data });
  }
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= n) entrySelector++;
  const searchRange = 2 ** entrySelector * 16;
  let size = 12 + 16 * n;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const w = new DataView(out.buffer);
  w.setUint32(0, flavor);
  w.setUint16(4, n);
  w.setUint16(6, searchRange);
  w.setUint16(8, entrySelector);
  w.setUint16(10, n * 16 - searchRange);
  let off = 12 + 16 * n;
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    w.setUint32(o, t.tag);
    w.setUint32(o + 4, t.checksum);
    w.setUint32(o + 8, off);
    w.setUint32(o + 12, t.data.length);
    out.set(t.data, off);
    off += (t.data.length + 3) & ~3;
  });
  return out;
}
