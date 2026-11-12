/**
 * Линейная (декартова) КСС: по оси X — угол γ, по оси Y — сила света.
 * Плоскость C откладывается в положительную сторону (по умолчанию), C + 180° — в отрицательную.
 */

import type { Photometry } from '../core/model';
import type { PhotometrySummary } from '../core/summary';
import { capHeight, header, legend, makeContext, seriesStroke, type BuildContext } from './common';
import { chartLabels, fmtAngle, fmtNum } from './labels';
import { buildLinearCatalog } from './linear-catalog';
import type { MeasureText, Prim, Scene, Stroke } from './scene';
import { chartData, niceScale, type ChartOptions } from './series';
import type { ChartStyle } from './style';

export function buildLinear(
  p: Photometry,
  s: PhotometrySummary,
  opts: ChartOptions,
  style: ChartStyle,
  measure?: MeasureText,
): Scene {
  if (opts.layout === 'catalog') return buildLinearCatalog(p, s, opts, style, measure);
  const ctx: BuildContext = makeContext(style, opts, measure);
  const data = chartData(p, s, opts);
  const scale = niceScale(data.maxValue, opts.scaleMax);
  const L = chartLabels[opts.lang];
  const gLim = data.gLimit;

  const W = opts.width;
  const pad = 2;
  const tick = style.font.tick;
  const capT = capHeight(tick);
  const yLabelW = Math.max(...scale.ticks.map((v) => ctx.measure(fmtNum(opts.lang, v, scale.decimals), tick)), ctx.measure('0', tick));

  const head = header(ctx, p, s, data, pad, pad);
  const top = pad + head.height + (head.height > 0 ? 2 : 0);
  // строка с единицами над осью Y
  const plotTop = top + capT + 2;
  const x0 = pad + yLabelW + 1.5;
  const x1 = W - pad - ctx.measure('180°', tick) / 2;
  const y0 = plotTop;
  const y1 = plotTop + Math.max(15, opts.height);
  const pw = x1 - x0;
  const ph = y1 - y0;

  const X = (g: number) => x0 + ((g + gLim) / (2 * gLim)) * pw;
  const Y = (v: number) => y1 - (Math.min(v, scale.max) / scale.max) * ph;

  const dash = style.gridDash.length ? style.gridDash : undefined;
  const gridStroke: Stroke = { color: style.colors.grid, width: style.widths.grid, dash };
  const majorStroke: Stroke = { color: style.colors.gridMajor, width: style.widths.gridMajor, dash };

  const grid: Prim[] = [];
  const labels: Prim[] = [];
  // горизонтальные линии и подписи значений
  for (const v of scale.ticks) {
    const y = Y(v);
    if (Math.abs(v - scale.max) > 1e-9) grid.push({ t: 'line', x1: x0, y1: y, x2: x1, y2: y, stroke: gridStroke });
    labels.push({ t: 'text', x: x0 - 1.2, y: y + capT / 2, text: fmtNum(opts.lang, v, scale.decimals), size: tick, color: style.colors.text, anchor: 'end' });
  }
  labels.push({ t: 'text', x: x0 - 1.2, y: y1 + capT / 2, text: '0', size: tick, color: style.colors.text, anchor: 'end' });
  // вертикальные линии и подписи углов
  const step = style.grid.angleStep;
  const every = step * style.grid.angleLabelEvery;
  for (let g = -gLim; g <= gLim + 1e-9; g += step) {
    const x = X(g);
    const edge = Math.abs(Math.abs(g) - gLim) < 1e-9;
    if (!edge) grid.push({ t: 'line', x1: x, y1: y0, x2: x, y2: y1, stroke: g === 0 ? majorStroke : gridStroke });
    if (Math.abs(Math.round(g / every) * every - g) < 1e-9) {
      labels.push({ t: 'text', x, y: y1 + 1.2 + capT, text: fmtAngle(g), size: tick, color: style.colors.text, anchor: 'middle' });
    }
  }
  // рамка
  grid.push({ t: 'rect', x: x0, y: y0, w: pw, h: ph, stroke: majorStroke });
  // единицы и подпись оси
  labels.push({ t: 'text', x: x0, y: y0 - 1.5, text: data.unitLabel, size: tick, color: style.colors.text, anchor: 'start' });
  const axisY = y1 + 1.2 + capT + 1.2 + capT;
  labels.push({ t: 'text', x: x1, y: axisY, text: L.gammaAxis, size: tick, color: style.colors.text, anchor: 'end' });

  // кривые
  const sideMain = opts.cSide === 'right' ? 1 : -1;
  const curves: Prim[] = data.series.map((sr, i) => {
    const neg = (sideMain > 0 ? sr.opposite : sr.main).slice().reverse().map(([g, v]) => [X(-g), Y(v)] as [number, number]);
    const pos = (sideMain > 0 ? sr.main : sr.opposite).map(([g, v]) => [X(g), Y(v)] as [number, number]);
    return { t: 'polyline', pts: [...neg, ...pos], stroke: seriesStroke(style, i) };
  });

  const bottom = axisY + 1;
  const leg = legend(ctx, data, pad, bottom + 1.5, W - 2 * pad);
  const H = bottom + (leg.height > 0 ? leg.height + 2.5 : 0) + pad;

  return {
    width: W,
    height: Math.round(H * 100) / 100,
    title: data.title,
    fontFamily: style.font.family,
    background: style.colors.background ?? undefined,
    children: [
      { t: 'group', id: 'grid', children: grid },
      { t: 'group', id: 'curves', children: curves },
      { t: 'group', id: 'labels', children: labels },
      ...(head.prims.length ? [{ t: 'group', id: 'title', children: head.prims } as Prim] : []),
      ...(leg.prims.length ? [{ t: 'group', id: 'legend', children: leg.prims } as Prim] : []),
    ],
  };
}
