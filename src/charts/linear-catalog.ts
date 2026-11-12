/**
 * Линейная КСС в оформлении каталога MAYTONI — по правилам полярной «иконки» (polar-catalog.ts):
 * тот же размер (39,1 мм) и высота, заголовок Iₘₐₓ, пунктирная сетка, шкала catalogScale без подписей
 * значений, подписи углов 90°…0°…90° (как на полярной), залитые кривые, перекрытие плотнее,
 * C90–C270 — пунктиром. Образца линейной КСС у заказчика нет — оформление выведено из полярной.
 */

import { intensityC } from '../core/angles';
import type { Photometry } from '../core/model';
import type { PhotometrySummary } from '../core/summary';
import { capHeight, makeContext, seriesStroke } from './common';
import { catalogTitle } from './polar-catalog';
import type { MeasureText, Prim, Scene, Stroke } from './scene';
import { catalogScale, chartData, type ChartOptions } from './series';
import type { ChartStyle } from './style';

/**
 * Профиль перекрытия: на каждом x — вторая по высоте кривая (для двух — меньшая),
 * в местах пересечения двух кривых добавляются точки. Кривые заданы на одних и тех же x.
 */
export function overlapProfile(curves: Array<Array<[number, number]>>, baseY: number): Array<[number, number]> {
  const n = Math.min(...curves.map((c) => c.length));
  if (curves.length < 2 || n < 2) return [];
  const h = (p: [number, number]) => baseY - p[1];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    out.push(curves.map((c) => c[i]).sort((a, b) => h(b) - h(a))[1]);
    if (curves.length === 2 && i < n - 1) {
      const [a, b] = curves;
      const d0 = h(a[i]) - h(b[i]);
      const d1 = h(a[i + 1]) - h(b[i + 1]);
      if (d0 * d1 < 0) {
        const t = d0 / (d0 - d1);
        out.push([a[i][0] + (a[i + 1][0] - a[i][0]) * t, a[i][1] + (a[i + 1][1] - a[i][1]) * t]);
      }
    }
  }
  return out;
}

export function buildLinearCatalog(
  p: Photometry,
  s: PhotometrySummary,
  opts: ChartOptions,
  style: ChartStyle,
  measure?: MeasureText,
): Scene {
  const ctx = makeContext(style, opts, measure);
  const data = chartData(p, s, opts);
  const imax = s.peak.value * data.factor;
  const scale = catalogScale(imax, opts.scaleMax);
  const gLim = data.gLimit;

  const tick = style.font.tick;
  const capT = capHeight(tick);
  const capTitle = capHeight(style.font.title);
  const gap = 0.35 * capT;
  const below = 0.3 * capT;
  const side = 0.31 * capT;
  const W = opts.width;
  const w90 = ctx.measure('90°', tick);
  // высота поля — как радиус полярной «иконки» той же ширины, чтобы графики стояли в ряд
  const ph = Math.max(5, W / 2 - side - gap - w90);
  const x0 = side + w90 / 2;
  const x1 = W - side - w90 / 2;
  const pw = x1 - x0;
  const showTitle = opts.show.title;
  const y0 = showTitle ? 0.33 * capTitle + capTitle + 1.25 * capTitle : 0.6 * capT;
  const y1 = y0 + ph;
  const H = y1 + gap + below + capT + 0.33 * capT;

  const X = (g: number) => x0 + ((g + gLim) / (2 * gLim)) * pw;
  const Y = (v: number) => y1 - (Math.min(v, scale.max) / scale.max) * ph;

  const dash = style.gridDash.length ? style.gridDash : undefined;
  const gridStroke: Stroke = { color: style.colors.grid, width: style.widths.grid, dash };
  const outerStroke: Stroke = { color: style.colors.gridMajor, width: style.widths.gridMajor, dash };

  // кривые на общей сетке x: γ через 1° (чаще, если в данных шаг мельче)
  const c = s.asC;
  const dataStep = c.vAngles.length > 1 ? Math.min(...c.vAngles.slice(1).map((g, i) => g - c.vAngles[i])) : 1;
  const step = Math.max(0.1, Math.min(1, dataStep));
  const gEnd = Math.min(gLim, c.vAngles[c.vAngles.length - 1] ?? 0);
  const gs: number[] = [];
  for (let g = 0; g <= gEnd + 1e-9; g += step) gs.push(Math.round(g * 1e6) / 1e6);
  if (gs[gs.length - 1] < gEnd - 1e-9) gs.push(gEnd);
  const sideMain = opts.cSide === 'right' ? 1 : -1;

  const fills: Prim[] = [];
  const curves: Prim[] = [];
  const shapes: Array<Array<[number, number]>> = [];
  data.series.forEach((sr, i) => {
    const val = (cc: number, g: number) => intensityC(c, cc, g) * data.factor;
    const neg = gs.slice().reverse().map((g) => [X(-g), Y(val(sideMain > 0 ? sr.c + 180 : sr.c, g))] as [number, number]);
    const pos = gs.map((g) => [X(g), Y(val(sideMain > 0 ? sr.c : sr.c + 180, g))] as [number, number]);
    const pts = [...neg, ...pos.slice(1)];
    shapes.push(pts);
    if (style.colors.fill) fills.push({ t: 'polyline', pts: [...pts, [pts[pts.length - 1][0], y1], [pts[0][0], y1]], closed: true, fill: style.colors.fill });
    curves.push({ t: 'polyline', pts, stroke: seriesStroke(style, i) });
  });
  if (style.colors.fill && style.colors.fillOverlap && shapes.length > 1) {
    const ov = overlapProfile(shapes, y1);
    if (ov.length > 1) fills.push({ t: 'polyline', pts: [...ov, [ov[ov.length - 1][0], y1], [ov[0][0], y1]], closed: true, fill: style.colors.fillOverlap });
  }

  // сетка поверх заливки, как на полярной
  const grid: Prim[] = [];
  const aStep = style.grid.angleStep;
  for (let g = -gLim + aStep; g < gLim - 1e-9; g += aStep) grid.push({ t: 'line', x1: X(g), y1: y0, x2: X(g), y2: y1, stroke: gridStroke });
  for (const v of scale.ticks) grid.push({ t: 'line', x1: x0, y1: Y(v), x2: x1, y2: Y(v), stroke: gridStroke });
  grid.push({ t: 'rect', x: x0, y: y0, w: pw, h: ph, stroke: outerStroke });

  const labels: Prim[] = [];
  // шаг подписей: как в стиле, но не теснее ширины «180°» с запасом (при диапазоне ±180° — реже)
  let every = aStep * style.grid.angleLabelEvery;
  const minGap = ctx.measure('180°', tick) * 1.4;
  while ((every / (2 * gLim)) * pw < minGap && every < gLim) every += aStep;
  for (let g = -gLim; g <= gLim + 1e-9; g += every) {
    labels.push({ t: 'text', x: X(g), y: y1 + gap + below + capT, text: `${Math.abs(Math.round(g))}°`, size: tick, color: style.colors.text, anchor: 'middle' });
  }

  const title: Prim[] = [];
  if (showTitle) {
    const t = catalogTitle(opts, imax, data.unitLabel, style.font.title);
    title.push({ ...t, x: (x0 + x1) / 2, y: y0 - 1.25 * capTitle, color: style.colors.text });
  }

  return {
    width: W,
    height: Math.round(H * 100) / 100,
    title: data.title,
    fontFamily: style.font.family,
    background: style.colors.background ?? undefined,
    children: [
      { t: 'group', id: 'curves', children: [...fills, ...curves] },
      { t: 'group', id: 'grid', children: grid },
      { t: 'group', id: 'labels', children: labels },
      ...(title.length ? [{ t: 'group', id: 'title', children: title } as Prim] : []),
    ],
  };
}
