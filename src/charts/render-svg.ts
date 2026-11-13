/**
 * SVG-рендер сцены. Используется и для показа на экране, и для экспорта:
 * линии остаются линиями, текст — текстом, группы верхнего уровня — слоями
 * (Illustrator берёт имя из id, Inkscape — из inkscape:label).
 */

import { openFont, textOutline, textWidthEm, type FontSet } from './fonts';
import { MM_TO_PT, PT_TO_MM, type Color, type Prim, type Scene, type Stroke } from './scene';
import { rgbHex } from './style';
import { placeRuns, type Seg } from './vector';

const n = (x: number) => {
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function strokeAttrs(s: Stroke | undefined): string {
  if (!s) return ' stroke="none"';
  let a = ` stroke="${rgbHex(s.color)}" stroke-width="${n(s.width)}"`;
  if (s.dash?.length) a += ` stroke-dasharray="${s.dash.map(n).join(' ')}"`;
  return a;
}

function fillAttr(f: Color | undefined): string {
  return f ? ` fill="${rgbHex(f)}"` : ' fill="none"';
}

/** Текст кривыми (для PNG: картинка SVG не видит шрифты страницы). Путь в мм, Y вниз. */
function textPath(p: Extract<Prim, { t: 'text' }>, fonts: FontSet): string {
  const fk = openFont(p.bold && fonts.bold ? fonts.bold : fonts.regular);
  const fb = fonts.fallback ? openFont(fonts.fallback) : null;
  const runs = (p.runs?.length ? p.runs : [{ text: p.text, scale: 1, dy: 0 }]).map((r) => ({ ...r, dy: r.dy * MM_TO_PT }));
  const vt = { x: 0, y: 0, text: p.text, size: p.size, color: p.color, anchor: p.anchor, bold: !!p.bold, rotate: p.rotate ?? 0, runs };
  const segs: Seg[] = [];
  for (const r of placeRuns(vt, (t, size) => textWidthEm(fk, t, fb) * size)) segs.push(...textOutline(fk, r.text, r.x, r.y, r.size, vt.rotate, fb));
  const X = (x: number) => n(p.x + x * PT_TO_MM);
  const Y = (y: number) => n(p.y - y * PT_TO_MM);
  return segs
    .map((s) => (s[0] === 'Z' ? 'Z' : s[0] === 'C' ? `C${X(s[1])},${Y(s[2])} ${X(s[3])},${Y(s[4])} ${X(s[5])},${Y(s[6])}` : `${s[0]}${X(s[1])},${Y(s[2])}`))
    .join('');
}

function prim(p: Prim, indent: string, top: boolean, outline?: FontSet): string {
  switch (p.t) {
    case 'group': {
      const layer = top ? ` inkscape:groupmode="layer" inkscape:label="${escapeXml(p.id)}"` : '';
      return `${indent}<g id="${escapeXml(p.id)}"${layer}>\n${p.children.map((c) => prim(c, indent + '  ', false, outline)).join('')}${indent}</g>\n`;
    }
    case 'line':
      return `${indent}<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}"${strokeAttrs(p.stroke)}/>\n`;
    case 'polyline': {
      const tag = p.closed ? 'polygon' : 'polyline';
      const pts = p.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
      return `${indent}<${tag} points="${pts}"${fillAttr(p.fill)}${strokeAttrs(p.stroke)} stroke-linejoin="round"/>\n`;
    }
    case 'circle':
      return `${indent}<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}"${fillAttr(p.fill)}${strokeAttrs(p.stroke)}/>\n`;
    case 'arc': {
      const x0 = p.cx + p.r * Math.cos(p.a0);
      const y0 = p.cy + p.r * Math.sin(p.a0);
      const x1 = p.cx + p.r * Math.cos(p.a1);
      const y1 = p.cy + p.r * Math.sin(p.a1);
      const large = p.a1 - p.a0 > Math.PI + 1e-9 ? 1 : 0;
      return `${indent}<path d="M${n(x0)},${n(y0)} A${n(p.r)},${n(p.r)} 0 ${large} 1 ${n(x1)},${n(y1)}" fill="none"${strokeAttrs(p.stroke)}/>\n`;
    }
    case 'rect':
      return `${indent}<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${fillAttr(p.fill)}${strokeAttrs(p.stroke)}/>\n`;
    case 'text': {
      if (outline) {
        const d = textPath(p, outline);
        return d ? `${indent}<path d="${d}" fill="${rgbHex(p.color)}"><title>${escapeXml(p.text)}</title></path>\n` : '';
      }
      const anchor = p.anchor === 'start' ? '' : ` text-anchor="${p.anchor}"`;
      const weight = p.bold ? ' font-weight="500"' : '';
      const rot = p.rotate ? ` transform="rotate(${n(-p.rotate)} ${n(p.x)} ${n(p.y)})"` : '';
      let body = escapeXml(p.text);
      if (p.runs?.length) {
        // tspan с относительным dy: каждый кусок сдвигается от предыдущего
        let prev = 0;
        body = p.runs
          .map((r) => {
            const dy = r.dy - prev;
            prev = r.dy;
            const size = r.scale !== 1 ? ` font-size="${n(p.size * r.scale * PT_TO_MM)}"` : '';
            const shift = Math.abs(dy) > 1e-9 ? ` dy="${n(dy)}"` : '';
            return `<tspan${size}${shift}>${escapeXml(r.text)}</tspan>`;
          })
          .join('');
      }
      return `${indent}<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(p.size * PT_TO_MM)}"${anchor}${weight} fill="${rgbHex(p.color)}"${rot}>${body}</text>\n`;
    }
  }
}

export interface SvgOptions {
  /** Добавить XML-заголовок (для файла). */
  xmlDeclaration?: boolean;
  /** Текст кривыми этими шрифтами (для растеризации в PNG). */
  textAsPaths?: FontSet;
  /** Фон, если в сцене его нет (для PNG). */
  background?: Color;
  /** Семейство, под которым шрифт подключён на странице (только для показа на экране, не для файла). */
  screenFamily?: string;
}

export function renderSvg(scene: Scene, opts: SvgOptions = {}): string {
  const W = n(scene.width);
  const H = n(scene.height);
  const screen = opts.screenFamily ? `, '${opts.screenFamily}'` : '';
  const family = escapeXml(`${scene.fontFamily}${screen}, Roboto, Arial, Helvetica, sans-serif`);
  const bgColor = scene.background ?? opts.background;
  const bg = bgColor ? `  <rect x="0" y="0" width="${W}" height="${H}" fill="${rgbHex(bgColor)}"/>\n` : '';
  return (
    (opts.xmlDeclaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="${family}">\n` +
    `  <title>${escapeXml(scene.title)}</title>\n` +
    bg +
    scene.children.map((c) => prim(c, '  ', true, opts.textAsPaths)).join('') +
    '</svg>\n'
  );
}
