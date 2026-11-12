/**
 * Шрифты для векторного экспорта: разбор (fontkit), метрики, контуры глифов,
 * подмножество TrueType для встраивания в EPS (Type 42).
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

/** Шрифт с контурами CFF (OTF): в EPS его нельзя встроить как Type 42. */
export function isCff(f: FkFont): boolean {
  return 'CFF ' in f.directory.tables || 'CFF2' in f.directory.tables;
}

/** Ширина строки в единицах em (без кернинга — так же, как её рисует PostScript show). */
export function textWidthEm(f: FkFont, text: string): number {
  return f.glyphsForString(text).reduce((s, g) => s + g.advanceWidth, 0) / f.unitsPerEm;
}

/** Функция измерения текста (мм) по реальным метрикам шрифтов. */
export function fontMeasure(fonts: FontSet): MeasureText {
  const reg = openFont(fonts.regular);
  const bold = fonts.bold ? openFont(fonts.bold) : reg;
  return (text, sizePt, isBold) => textWidthEm(isBold ? bold : reg, text) * sizePt * PT_TO_MM;
}

/**
 * Контуры текста в пунктах (Y вверх): база (x, y), кегль, поворот против часовой стрелки.
 * Квадратичные сегменты TrueType переводятся в кубические.
 */
export function textOutline(f: FkFont, text: string, x: number, y: number, sizePt: number, rotateDeg: number): Seg[] {
  const s = sizePt / f.unitsPerEm;
  const a = (rotateDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const segs: Seg[] = [];
  let pen = 0;
  const T = (px: number, py: number): [number, number] => {
    const u = (pen + px) * s;
    const v = py * s;
    return [x + u * ca - v * sa, y + u * sa + v * ca];
  };
  for (const g of f.glyphsForString(text)) {
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
    pen += g.advanceWidth;
  }
  return segs;
}

/** Собирает подмножество шрифта (TrueType) с заданными глифами. Возвращает байты и новые номера глифов. */
export async function subsetFont(f: FkFont, glyphIds: number[]): Promise<{ bytes: Uint8Array; map: Map<number, number> }> {
  const subset = f.createSubset();
  const map = new Map<number, number>();
  for (const id of glyphIds) if (!map.has(id)) map.set(id, subset.includeGlyph(f.getGlyph(id)));
  const parts: Uint8Array[] = [];
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const st = subset.encodeStream();
    st.on('data', (b) => parts.push(b as Uint8Array));
    st.on('end', () => {
      const len = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(len);
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      resolve(out);
    });
    st.on('error', (e) => reject(e));
  });
  return { bytes, map };
}
