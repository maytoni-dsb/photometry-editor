/**
 * EPS-рендер сцены (PostScript Level 2, EPSF-3.0, 7-битный).
 *
 * Текст всегда переводится в кривые. Illustrator при импорте EPS не использует встроенные
 * шрифты Type 42 со своей кодировкой и подменяет текст (проверено заказчиком 12.11.2026);
 * образец каталога (MATLAB) тоже сделан с текстом в кривых. Редактируемый текст — в SVG и PDF.
 * Каждая строка текста — отдельная группа с комментарием, линии — простые пути.
 * Цвета — setrgbcolor или setcmykcolor.
 */

import { openFont, textOutline, type FkFont } from './fonts';
import type { VectorExportOptions } from './render-pdf';
import type { Color, Scene } from './scene';
import { colorComponents, pageSizePt, placeRuns, walkVector, type ColorMode, type Seg } from './vector';

const f2 = (x: number) => {
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function colorOp(c: Color, mode: ColorMode): string {
  const v = colorComponents(c, mode).map(f2).join(' ');
  return mode === 'rgb' ? `${v} setrgbcolor` : `${v} setcmykcolor`;
}

function pathOps(segs: Seg[]): string {
  const out: string[] = ['newpath'];
  for (const s of segs) {
    switch (s[0]) {
      case 'M':
        out.push(`${f2(s[1])} ${f2(s[2])} moveto`);
        break;
      case 'L':
        out.push(`${f2(s[1])} ${f2(s[2])} lineto`);
        break;
      case 'C':
        out.push(`${f2(s[1])} ${f2(s[2])} ${f2(s[3])} ${f2(s[4])} ${f2(s[5])} ${f2(s[6])} curveto`);
        break;
      default:
        out.push('closepath');
    }
  }
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 6) lines.push(out.slice(i, i + 6).join(' '));
  return lines.join('\n');
}

function textWidth(f: FkFont, text: string, size: number): number {
  return (f.glyphsForString(text).reduce((s, g) => s + g.advanceWidth, 0) / f.unitsPerEm) * size;
}

const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');

export async function renderEps(scene: Scene, opts: VectorExportOptions): Promise<string> {
  const mode = opts.color;
  const [W, H] = pageSizePt(scene);
  const fkRegular = openFont(opts.fonts.regular);
  const fkBold = opts.fonts.bold ? openFont(opts.fonts.bold) : fkRegular;

  const body: string[] = [];
  body.push('1 setlinejoin 0 setlinecap 10 setmiterlimit');
  walkVector(scene, {
    begin(id) {
      body.push(`% --- ${ascii(id)}`);
    },
    end() {},
    path(segs, st, fl) {
      const p = pathOps(segs);
      if (fl && st) {
        body.push(`${colorOp(fl, mode)}\n${p}\ngsave fill grestore\n${colorOp(st.color, mode)} ${f2(st.width)} setlinewidth [${st.dash.map(f2).join(' ')}] 0 setdash stroke`);
      } else if (fl) {
        body.push(`${colorOp(fl, mode)}\n${p}\nfill`);
      } else if (st) {
        body.push(`${colorOp(st.color, mode)} ${f2(st.width)} setlinewidth [${st.dash.map(f2).join(' ')}] 0 setdash\n${p}\nstroke`);
      }
    },
    text(t) {
      const fk = t.bold ? fkBold : fkRegular;
      const segs: Seg[] = [];
      for (const r of placeRuns(t, (text, size) => textWidth(fk, text, size))) {
        segs.push(...textOutline(fk, r.text, r.x, r.y, r.size, t.rotate));
      }
      // строка текста — комментарием (только ASCII: файл объявлен Clean7Bit)
      if (segs.length) body.push(`% text: ${ascii(t.text)}\n${colorOp(t.color, mode)}\n${pathOps(segs)}\nfill`);
    },
  });

  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${f2(W)} ${f2(H)}`,
    `%%Title: ${ascii(scene.title)}`,
    '%%Creator: Photometry Editor',
    `%%CreationDate: ${date}`,
    '%%LanguageLevel: 2',
    '%%DocumentData: Clean7Bit',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '%%EndProlog',
    '%%Page: 1 1',
    'save',
    ...body,
    'restore',
    'showpage',
    '%%Trailer',
    '%%EOF',
    '',
  ].join('\n');
}
