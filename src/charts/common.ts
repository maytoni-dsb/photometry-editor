/**
 * Общие части графиков: заголовок, строка параметров, легенда, обрезка кривых.
 */

import type { Photometry } from '../core/model';
import type { PhotometrySummary } from '../core/summary';
import { chartLabels, fmtNum } from './labels';
import { approxTextWidth, PT_TO_MM, type MeasureText, type Prim, type Stroke } from './scene';
import type { ChartData, ChartOptions } from './series';
import type { ChartStyle } from './style';

export interface BuildContext {
  style: ChartStyle;
  opts: ChartOptions;
  measure: MeasureText;
}

export function makeContext(style: ChartStyle, opts: ChartOptions, measure?: MeasureText): BuildContext {
  return { style, opts, measure: measure ?? approxTextWidth };
}

/** Высота прописной буквы, мм. */
export const capHeight = (sizePt: number) => 0.711 * sizePt * PT_TO_MM;

export function seriesStroke(style: ChartStyle, i: number): Stroke {
  const colors = style.colors.series;
  const dash = style.dashes[i % Math.max(1, style.dashes.length)] ?? [];
  return { color: colors[i % colors.length], width: style.widths.curve, dash: dash.length ? dash : undefined };
}

/** Строка параметров под заголовком: поток и максимальная сила света. */
export function infoLine(s: PhotometrySummary, data: ChartData, opts: ChartOptions): string {
  const L = chartLabels[opts.lang];
  const flux = `${L.flux} = ${fmtNum(opts.lang, s.flux.total, s.flux.total < 100 ? 1 : 0)} ${L.lm}`;
  const imaxVal = s.peak.value * data.factor;
  const imax = `${L.imax} = ${fmtNum(opts.lang, imaxVal, imaxVal < 100 ? 1 : 0)} ${data.unitLabel}`;
  // неразрывные пробелы: в SVG обычные пробелы подряд схлопываются
  return `${flux}\u00a0\u00a0\u00a0\u00a0${imax}`;
}

/**
 * Заголовок и строка параметров. Возвращает примитивы и высоту блока, мм.
 */
export function header(
  ctx: BuildContext,
  p: Photometry,
  s: PhotometrySummary,
  data: ChartData,
  x: number,
  y: number,
): { prims: Prim[]; height: number } {
  const { style, opts } = ctx;
  const prims: Prim[] = [];
  let h = 0;
  if (opts.show.title && data.title) {
    h += capHeight(style.font.title);
    prims.push({ t: 'text', x, y: y + h, text: data.title, size: style.font.title, color: style.colors.text, anchor: 'start', bold: true });
    h += style.font.title * PT_TO_MM * 0.55;
  }
  if (opts.show.info) {
    h += capHeight(style.font.label) + (h > 0 ? style.font.label * PT_TO_MM * 0.35 : 0);
    prims.push({ t: 'text', x, y: y + h, text: infoLine(s, data, opts), size: style.font.label, color: style.colors.text, anchor: 'start' });
    h += style.font.label * PT_TO_MM * 0.55;
  }
  void p;
  return { prims, height: h };
}

/**
 * Легенда: образец линии + подпись, элементы в строку с переносом.
 */
export function legend(ctx: BuildContext, data: ChartData, x: number, y: number, width: number): { prims: Prim[]; height: number } {
  const { style, opts } = ctx;
  if (!opts.show.legend || data.series.length === 0) return { prims: [], height: 0 };
  const size = style.font.label;
  const rowH = size * PT_TO_MM * 1.5;
  const sample = 7;
  const gap = 1.5;
  const itemGap = 5;
  const prims: Prim[] = [];
  let cx = x;
  let row = 0;
  data.series.forEach((sr, i) => {
    const w = sample + gap + ctx.measure(sr.label, size);
    if (cx > x && cx + w > x + width) {
      row++;
      cx = x;
    }
    const base = y + row * rowH + capHeight(size);
    const mid = base - capHeight(size) / 2;
    prims.push({ t: 'line', x1: cx, y1: mid, x2: cx + sample, y2: mid, stroke: seriesStroke(style, i) });
    prims.push({ t: 'text', x: cx + sample + gap, y: base, text: sr.label, size, color: style.colors.text, anchor: 'start' });
    cx += w + itemGap;
  });
  return { prims, height: (row + 1) * rowH - (rowH - capHeight(size)) };
}
