/**
 * Полярная КСС в оформлении каталога MAYTONI (образец «LIC eps stage2», 12.11.2026).
 *
 * Компактная «иконка»: заголовок Iₘₐₓ = … cd/klm, нижняя полусфера (или вся сфера, если свет
 * идёт вверх), лучи через шаг сетки стиля (в образце 30°), кольца без подписей, внешняя дуга —
 * максимум шкалы (правило — catalogScale), подписи углов снаружи, первая кривая залита.
 * Размеры образца при ширине 39,1 мм: R = 15,3 мм, высота 22,3 мм, кегль 6 пт.
 * Все отступы заданы в долях высоты прописной буквы, поэтому оформление масштабируется кеглем.
 */

import { intensityC } from '../core/angles';
import type { Photometry } from '../core/model';
import type { PhotometrySummary } from '../core/summary';
import { capHeight, overlapPolygon, makeContext, seriesStroke } from './common';
import { chartLabels } from './labels';
import { PT_TO_MM, type MeasureText, type Prim, type Scene, type Stroke } from './scene';
import { catalogScale, chartData, type ChartOptions } from './series';
import type { ChartStyle } from './style';

const RAD = Math.PI / 180;

/** Ширина графика каталога по умолчанию, мм (110,83 пт, как в образце). */
export const CATALOG_WIDTH = 39.1;

export function buildPolarCatalog(
  p: Photometry,
  s: PhotometrySummary,
  opts: ChartOptions,
  style: ChartStyle,
  measure?: MeasureText,
): Scene {
  const ctx = makeContext(style, opts, measure);
  const data = chartData(p, s, opts);
  const L = chartLabels[opts.lang];
  const full = data.gLimit > 90;
  const imax = s.peak.value * data.factor;
  const scale = catalogScale(imax, opts.scaleMax);

  const tick = style.font.tick;
  const capT = capHeight(tick);
  const capTitle = capHeight(style.font.title);
  const gap = 0.35 * capT; // от конца луча до точки подписи
  const below = 0.3 * capT; // от точки подписи до верха букв (подписи снизу)
  const side = 0.31 * capT; // поле слева и справа
  const W = opts.width;
  const w90 = ctx.measure('90°', tick);
  const R = Math.max(5, W / 2 - side - gap - w90);
  const cx = W / 2;

  // верх: заголовок, затем (для всей сферы) подписи сверху
  const showTitle = opts.show.title;
  const titleBlock = showTitle ? 0.33 * capTitle + capTitle + 1.25 * capTitle : 0.6 * capT;
  const cy = full ? titleBlock + gap + below + capT + R - (showTitle ? 0.4 * capTitle : 0) : titleBlock + (showTitle ? 0 : capT / 2);
  const H = cy + R + gap + below + capT + 0.33 * capT;

  const dash = style.gridDash.length ? style.gridDash : undefined;
  const gridStroke: Stroke = { color: style.colors.grid, width: style.widths.grid, dash };
  const outerStroke: Stroke = { color: style.colors.gridMajor, width: style.widths.gridMajor, dash };
  const pt = (g: number, r: number, sideSign: number): [number, number] => [cx + sideSign * r * Math.sin(g * RAD), cy + r * Math.cos(g * RAD)];

  // --- кривые: γ через 1° (или чаще, если в данных шаг мельче), значения — интерполяцией
  const c = s.asC;
  const dataStep = c.vAngles.length > 1 ? Math.min(...c.vAngles.slice(1).map((g, i) => g - c.vAngles[i])) : 1;
  const step = Math.max(0.1, Math.min(1, dataStep));
  const gEnd = Math.min(data.gLimit, c.vAngles[c.vAngles.length - 1] ?? 0);
  const gs: number[] = [];
  for (let g = 0; g <= gEnd + 1e-9; g += step) gs.push(Math.round(g * 1e6) / 1e6);
  if (gs[gs.length - 1] < gEnd - 1e-9) gs.push(gEnd);
  const sideMain = opts.cSide === 'right' ? 1 : -1;
  const rad = (v: number) => (Math.min(v, scale.max) / scale.max) * R;
  const curves: Prim[] = [];
  const fills: Prim[] = [];
  const shapes: Array<Array<[number, number]>> = [];
  let closedAll = true;
  data.series.forEach((sr, i) => {
    const val = (cc: number, g: number) => intensityC(c, cc, g) * data.factor;
    const left = gs.slice().reverse().map((g) => pt(g, rad(val(sr.c + 180, g)), -sideMain));
    const right = gs.map((g) => pt(g, rad(val(sr.c, g)), sideMain));
    const pts = [...left, ...right];
    const closed = gEnd >= 180 - 1e-9;
    // заливка под каждой кривой (решение заказчика 12.11.2026); все заливки — под всеми контурами
    if (style.colors.fill) fills.push({ t: 'polyline', pts: closed ? pts : [...pts, [cx, cy]], closed: true, fill: style.colors.fill });
    shapes.push(pts);
    closedAll = closedAll && closed;
    curves.push({ t: 'polyline', pts, closed, stroke: seriesStroke(style, i) });
  });
  // перекрытие кривых — плотнее (CMYK 0/0/36/0 в каталоге), как в образце TR106
  if (style.colors.fill && style.colors.fillOverlap && shapes.length > 1) {
    const ov = overlapPolygon(cx, cy, shapes);
    if (ov.length > 2) fills.push({ t: 'polyline', pts: closedAll ? ov : [...ov, [cx, cy]], closed: true, fill: style.colors.fillOverlap });
  }

  // --- сетка: лучи, кольца, внешняя дуга (поверх заливки, как в образце)
  const grid: Prim[] = [];
  const aStep = style.grid.angleStep;
  const gMaxGrid = full ? 180 : 90;
  for (let g = 0; g <= gMaxGrid + 1e-9; g += aStep) {
    for (const sg of g === 0 || g === 180 ? [1] : [1, -1]) {
      const [x2, y2] = pt(g, R, sg);
      grid.push({ t: 'line', x1: cx, y1: cy, x2, y2, stroke: gridStroke });
    }
  }
  for (const v of scale.ticks) {
    const r = (v / scale.max) * R;
    grid.push(full ? { t: 'circle', cx, cy, r, stroke: gridStroke } : { t: 'arc', cx, cy, r, a0: 0, a1: Math.PI, stroke: gridStroke });
  }
  grid.push(full ? { t: 'circle', cx, cy, r: R, stroke: outerStroke } : { t: 'arc', cx, cy, r: R, a0: 0, a1: Math.PI, stroke: outerStroke });

  // --- подписи углов
  const labels: Prim[] = [];
  const every = aStep * style.grid.angleLabelEvery;
  for (let g = 0; g <= gMaxGrid + 1e-9; g += every) {
    for (const sg of g === 0 || g === 180 ? [1] : [1, -1]) {
      const [x, y] = pt(g, R + gap, sg);
      const sn = Math.sin(g * RAD) * sg;
      const anchor = Math.abs(sn) < 0.2 ? 'middle' : sn > 0 ? 'start' : 'end';
      let by: number;
      if (Math.abs(g - 90) < 1e-9) by = y + capT / 2; // по центру линии горизонта
      else if (g < 90) by = y + below + capT; // снизу — висят под точкой
      else by = y - below; // сверху — стоят над точкой
      labels.push({ t: 'text', x, y: by, text: `${g}°`, size: tick, color: style.colors.text, anchor });
    }
  }

  // --- заголовок «Iₘₐₓ = 442 cd/klm»
  const title: Prim[] = [];
  if (showTitle) {
    const size = style.font.title;
    // как в образце: целое число без разделителя разрядов («38980»)
    const value = (imax >= 10 ? Math.round(imax).toString() : imax.toFixed(imax >= 1 ? 1 : 2)).replace('.', opts.lang === 'en' ? '.' : ',');
    const custom = opts.title?.trim();
    const runs = custom
      ? [{ text: custom, scale: 1, dy: 0 }]
      : [
          { text: L.imax.slice(0, 1), scale: 1, dy: 0 },
          { text: L.maxSub, scale: 0.714, dy: 0.18 * size * PT_TO_MM },
          { text: ` = ${value} ${data.unitLabel}`, scale: 1, dy: 0 },
        ];
    const top = full ? cy - R - gap - below - capT - 0.6 * capTitle : cy - 1.25 * capTitle;
    title.push({ t: 'text', x: cx, y: top, text: runs.map((r) => r.text).join(''), runs, size, color: style.colors.text, anchor: 'middle' });
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
