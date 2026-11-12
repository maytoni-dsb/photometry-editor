/**
 * EPS-рендер сцены (PostScript Level 2, EPSF-3.0).
 *
 * Текст — текстом: в файл встраивается подмножество TrueType-шрифта как Type 42
 * (глифы кодируются собственной таблицей Encoding, поэтому кириллица работает).
 * Если шрифт с контурами CFF (OTF) или глифов больше 255 — текст переводится в кривые.
 * Цвета — setrgbcolor или setcmykcolor.
 */

import { isCff, openFont, subsetFont, textOutline, type FkFont } from './fonts';
import type { VectorExportOptions } from './render-pdf';
import type { Color, Scene } from './scene';
import { colorComponents, pageSizePt, walkVector, type ColorMode, type Seg, type VectorText } from './vector';

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
  // по 6 операций в строке — компактно и читаемо
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 6) lines.push(out.slice(i, i + 6).join(' '));
  return lines.join('\n');
}

const toHex = (b: Uint8Array, from: number, to: number) => {
  let s = '';
  for (let i = from; i < to; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
};

/** Разбивает TTF на строки sfnts (≤ 65534 байт, по границам таблиц и глифов). */
function sfntsChunks(ttf: Uint8Array): Array<[number, number]> {
  const LIMIT = 65534;
  if (ttf.length <= LIMIT) return [[0, ttf.length]];
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const numTables = dv.getUint16(4);
  const tables: Array<{ tag: string; off: number; len: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(ttf[o], ttf[o + 1], ttf[o + 2], ttf[o + 3]);
    tables.push({ tag, off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) });
  }
  tables.sort((a, b) => a.off - b.off);
  // точки, где можно резать: начала таблиц и (внутри glyf) начала глифов
  const cuts = new Set<number>([0, ttf.length]);
  for (const t of tables) cuts.add(t.off);
  const glyf = tables.find((t) => t.tag === 'glyf');
  const loca = tables.find((t) => t.tag === 'loca');
  const head = tables.find((t) => t.tag === 'head');
  if (glyf && loca && head) {
    const longFmt = dv.getInt16(head.off + 50) === 1;
    const count = longFmt ? loca.len / 4 : loca.len / 2;
    for (let i = 0; i < count; i++) {
      const o = longFmt ? dv.getUint32(loca.off + i * 4) : dv.getUint16(loca.off + i * 2) * 2;
      cuts.add(glyf.off + o);
    }
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const chunks: Array<[number, number]> = [];
  let start = 0;
  let last = 0;
  for (const c of sorted) {
    if (c - start > LIMIT && last > start) {
      chunks.push([start, last]);
      start = last;
    }
    last = c;
  }
  if (start < ttf.length) chunks.push([start, ttf.length]);
  return chunks;
}

interface EmbeddedFont {
  name: string;
  /** Код глифа в Encoding по номеру глифа исходного шрифта. */
  codes: Map<number, number>;
  resource: string;
}

async function buildType42(f: FkFont, glyphIds: number[], name: string): Promise<EmbeddedFont | null> {
  const unique = [...new Set(glyphIds)].filter((g) => g !== 0);
  if (unique.length > 255) return null;
  const { bytes, map } = await subsetFont(f, unique);
  const codes = new Map<number, number>();
  const enc: string[] = [];
  const chars: string[] = ['/.notdef 0 def'];
  unique.forEach((g, i) => {
    const code = i + 1;
    const ng = map.get(g)!;
    codes.set(g, code);
    enc.push(`dup ${code} /g${ng} put`);
    chars.push(`/g${ng} ${ng} def`);
  });
  const u = f.unitsPerEm;
  const b = f.bbox;
  const sfnts = sfntsChunks(bytes)
    .map(([a, z]) => {
      const hex = toHex(bytes, a, z) + '00';
      return '<' + (hex.match(/.{1,128}/g) ?? []).join('\n') + '>';
    })
    .join('\n');
  const resource = [
    `%%BeginResource: font ${name}`,
    '11 dict begin',
    `/FontName /${name} def`,
    '/FontType 42 def',
    '/FontMatrix [1 0 0 1 0 0] def',
    `/FontBBox [${f2(b.minX / u)} ${f2(b.minY / u)} ${f2(b.maxX / u)} ${f2(b.maxY / u)}] def`,
    '/PaintType 0 def',
    '/Encoding 256 array 0 1 255 {1 index exch /.notdef put} for',
    ...enc,
    'readonly def',
    `/CharStrings ${unique.length + 1} dict dup begin`,
    ...chars,
    'end readonly def',
    '/sfnts [',
    sfnts,
    '] def',
    'FontName currentdict end definefont pop',
    '%%EndResource',
  ].join('\n');
  return { name, codes, resource };
}

function psName(f: FkFont, suffix: string): string {
  const base = (f.postscriptName || f.familyName || 'Font').replace(/[^A-Za-z0-9_-]/g, '');
  return `PE-${base}-${suffix}`;
}

function textWidth(f: FkFont, text: string, size: number): number {
  return (f.glyphsForString(text).reduce((s, g) => s + g.advanceWidth, 0) / f.unitsPerEm) * size;
}

export async function renderEps(scene: Scene, opts: VectorExportOptions): Promise<string> {
  const mode = opts.color;
  const [W, H] = pageSizePt(scene);
  const fkRegular = openFont(opts.fonts.regular);
  const fkBold = opts.fonts.bold ? openFont(opts.fonts.bold) : fkRegular;

  // сначала собираем тексты, чтобы знать набор глифов
  const texts: VectorText[] = [];
  walkVector(scene, { begin() {}, end() {}, path() {}, text: (t) => texts.push(t) });

  let asPaths = !!opts.textAsPaths || isCff(fkRegular) || isCff(fkBold);
  let fRegular: EmbeddedFont | null = null;
  let fBold: EmbeddedFont | null = null;
  if (!asPaths) {
    const ids = (bold: boolean) => texts.filter((t) => t.bold === bold).flatMap((t) => (bold ? fkBold : fkRegular).glyphsForString(t.text).map((g) => g.id));
    const sameFont = fkBold === fkRegular;
    fRegular = await buildType42(fkRegular, sameFont ? [...ids(false), ...ids(true)] : ids(false), psName(fkRegular, 'R'));
    fBold = sameFont ? fRegular : await buildType42(fkBold, ids(true), psName(fkBold, 'B'));
    if (!fRegular || !fBold) asPaths = true;
  }

  const body: string[] = [];
  body.push('1 setlinejoin 0 setlinecap');
  walkVector(scene, {
    begin(id) {
      body.push(`% --- ${id}`);
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
      const w = textWidth(fk, t.text, t.size);
      const k = t.anchor === 'start' ? 0 : t.anchor === 'middle' ? 0.5 : 1;
      if (asPaths) {
        const a = (t.rotate * Math.PI) / 180;
        const segs = textOutline(fk, t.text, t.x - k * w * Math.cos(a), t.y - k * w * Math.sin(a), t.size, t.rotate);
        if (segs.length) body.push(`${colorOp(t.color, mode)}\n${pathOps(segs)}\nfill`);
        return;
      }
      const ef = t.bold ? fBold! : fRegular!;
      const hex = fk.glyphsForString(t.text).map((g) => (ef.codes.get(g.id) ?? 0).toString(16).padStart(2, '0')).join('');
      // строка текста — комментарием (только ASCII: файл объявлен Clean7Bit)
      body.push(
        `% ${t.text.replace(/[^\x20-\x7e]/g, '?')}\n${colorOp(t.color, mode)}\n` +
          `gsave ${f2(t.x)} ${f2(t.y)} translate${t.rotate ? ` ${f2(t.rotate)} rotate` : ''} ` +
          `/${ef.name} findfont ${f2(t.size)} scalefont setfont ${f2(-k * w)} 0 moveto <${hex}> show grestore`,
      );
    },
  });

  const fonts = asPaths ? [] : fBold === fRegular ? [fRegular!] : [fRegular!, fBold!];
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');
  return [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${f2(W)} ${f2(H)}`,
    `%%Title: ${ascii(scene.title)}`,
    '%%Creator: Photometry Editor',
    `%%CreationDate: ${date}`,
    '%%LanguageLevel: 2',
    '%%DocumentData: Clean7Bit',
    fonts.length ? `%%DocumentSuppliedResources: ${fonts.map((f) => `font ${f.name}`).join(' ')}` : '%%DocumentSuppliedResources:',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    ...fonts.map((f) => f.resource),
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
