/**
 * PDF-рендер сцены (pdf-lib). Линии — векторные пути, текст — текстом со встроенным
 * подмножеством шрифта (редактируется в Illustrator / CorelDRAW) или кривыми.
 * Цвета — DeviceRGB или DeviceCMYK.
 */

import fontkit from '@pdf-lib/fontkit';
import {
  appendBezierCurve,
  closePath,
  cmyk,
  degrees,
  fill,
  fillAndStroke,
  lineTo,
  LineJoinStyle,
  moveTo,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setDashPattern,
  setFillingCmykColor,
  setFillingRgbColor,
  setLineJoin,
  setLineWidth,
  setStrokingCmykColor,
  setStrokingRgbColor,
  stroke,
  type PDFFont,
  type PDFOperator,
} from 'pdf-lib';
import { openFont, textOutline, type FontSet } from './fonts';
import type { Color, Scene } from './scene';
import { colorComponents, pageSizePt, walkVector, type ColorMode, type Seg } from './vector';

export interface VectorExportOptions {
  color: ColorMode;
  fonts: FontSet;
  /** Текст кривыми (не редактируется, но не зависит от шрифтов у получателя). */
  textAsPaths?: boolean;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

function segOps(segs: Seg[]): PDFOperator[] {
  return segs.map((s) => {
    switch (s[0]) {
      case 'M':
        return moveTo(r4(s[1]), r4(s[2]));
      case 'L':
        return lineTo(r4(s[1]), r4(s[2]));
      case 'C':
        return appendBezierCurve(r4(s[1]), r4(s[2]), r4(s[3]), r4(s[4]), r4(s[5]), r4(s[6]));
      default:
        return closePath();
    }
  });
}

function strokeColorOp(c: Color, mode: ColorMode): PDFOperator {
  const v = colorComponents(c, mode);
  return mode === 'rgb' ? setStrokingRgbColor(v[0], v[1], v[2]) : setStrokingCmykColor(v[0], v[1], v[2], v[3]);
}

function fillColorOp(c: Color, mode: ColorMode): PDFOperator {
  const v = colorComponents(c, mode);
  return mode === 'rgb' ? setFillingRgbColor(v[0], v[1], v[2]) : setFillingCmykColor(v[0], v[1], v[2], v[3]);
}

function pdfColor(c: Color, mode: ColorMode) {
  const v = colorComponents(c, mode);
  return mode === 'rgb' ? rgb(v[0], v[1], v[2]) : cmyk(v[0], v[1], v[2], v[3]);
}

export async function renderPdf(scene: Scene, opts: VectorExportOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(scene.title);
  doc.setCreator('Photometry Editor');
  doc.setProducer('Photometry Editor (pdf-lib)');
  const [W, H] = pageSizePt(scene);
  const page = doc.addPage([W, H]);
  const mode = opts.color;

  let regular: PDFFont | null = null;
  let bold: PDFFont | null = null;
  if (!opts.textAsPaths) {
    regular = await doc.embedFont(opts.fonts.regular, { subset: true });
    bold = opts.fonts.bold ? await doc.embedFont(opts.fonts.bold, { subset: true }) : regular;
  }
  const fkRegular = openFont(opts.fonts.regular);
  const fkBold = opts.fonts.bold ? openFont(opts.fonts.bold) : fkRegular;

  page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
  walkVector(scene, {
    begin() {
      /* слои PDF (OCG) не используются: группы сохраняются только в SVG */
    },
    end() {},
    path(segs, st, fl) {
      const ops: PDFOperator[] = [];
      if (st) {
        ops.push(strokeColorOp(st.color, mode), setLineWidth(r4(st.width)), setDashPattern(st.dash.map(r4), 0));
      }
      if (fl) ops.push(fillColorOp(fl, mode));
      ops.push(...segOps(segs));
      ops.push(st && fl ? fillAndStroke() : st ? stroke() : fill());
      page.pushOperators(...ops);
    },
    text(t) {
      const fk = t.bold ? fkBold : fkRegular;
      if (opts.textAsPaths || !regular) {
        const wEm = fk.glyphsForString(t.text).reduce((s, g) => s + g.advanceWidth, 0) / fk.unitsPerEm;
        const w = wEm * t.size;
        const k = t.anchor === 'start' ? 0 : t.anchor === 'middle' ? 0.5 : 1;
        const a = (t.rotate * Math.PI) / 180;
        const x = t.x - k * w * Math.cos(a);
        const y = t.y - k * w * Math.sin(a);
        const segs = textOutline(fk, t.text, x, y, t.size, t.rotate);
        if (segs.length) page.pushOperators(fillColorOp(t.color, mode), ...segOps(segs), fill());
        return;
      }
      const font = t.bold ? bold! : regular;
      const w = font.widthOfTextAtSize(t.text, t.size);
      const k = t.anchor === 'start' ? 0 : t.anchor === 'middle' ? 0.5 : 1;
      const a = (t.rotate * Math.PI) / 180;
      page.drawText(t.text, {
        x: t.x - k * w * Math.cos(a),
        y: t.y - k * w * Math.sin(a),
        size: t.size,
        font,
        color: pdfColor(t.color, mode),
        rotate: t.rotate ? degrees(t.rotate) : undefined,
      });
    },
  });
  page.pushOperators(popGraphicsState());
  return doc.save({ useObjectStreams: false });
}
