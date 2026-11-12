/**
 * Полярная КСС.
 *
 * γ = 0° (надир) — внизу, γ = 180° (зенит) — вверху. Плоскость C рисуется с одной
 * стороны (по умолчанию справа), противоположная C + 180° — с другой.
 * Режим «нижняя полусфера» показывает только γ ≤ 90°.
 */

import type { Photometry } from '../core/model';
import type { PhotometrySummary } from '../core/summary';
import { capHeight, header, legend, makeContext, seriesStroke, type BuildContext } from './common';
import { fmtNum } from './labels';
import type { MeasureText, Prim, Scene, Stroke } from './scene';
import { buildPolarCatalog } from './polar-catalog';
import { chartData, niceScale, type ChartOptions } from './series';
import type { ChartStyle } from './style';

const RAD = Math.PI / 180;

export function buildPolar(
  p: Photometry,
  s: PhotometrySummary,
  opts: ChartOptions,
  style: ChartStyle,
  measure?: MeasureText,
): Scene {
  if (opts.layout === 'catalog') return buildPolarCatalog(p, s, opts, style, measure);
  const ctx: BuildContext = makeContext(style, opts, measure);
  const data = chartData(p, s, opts);
  const scale = niceScale(data.maxValue, opts.scaleMax);
  const full = data.gLimit > 90;

  const W = opts.width;
  const pad = 2;
  const tick = style.font.tick;
  const capT = capHeight(tick);
  // поле под подписи углов: «180°» шириной ~4 знака
  const labelGap = 1.2;
  const mx = labelGap + ctx.measure('150°', tick) + pad;
  const R = Math.max(10, (W - 2 * mx) / 2);
  const cx = W / 2;

  const head = header(ctx, p, s, data, pad, pad);
  const top = pad + head.height + (head.height > 0 ? 2 : 0);
  const cy = full ? top + capT + labelGap + 1 + R : top + capT + 1;
  const bottom = cy + R + labelGap + capT + 1.5;

  const dash = style.gridDash.length ? style.gridDash : undefined;
  const gridStroke: Stroke = { color: style.colors.grid, width: style.widths.grid, dash };
  const majorStroke: Stroke = { color: style.colors.gridMajor, width: style.widths.gridMajor, dash };

  // направление на угол γ: side = +1 справа, −1 слева
  const pt = (g: number, r: number, side: number): [number, number] => [cx + side * r * Math.sin(g * RAD), cy + r * Math.cos(g * RAD)];

  // --- сетка
  const grid: Prim[] = [];
  // кольца
  for (const v of scale.ticks) {
    const r = (v / scale.max) * R;
    const st = Math.abs(v - scale.max) < 1e-9 ? majorStroke : gridStroke;
    if (full) grid.push({ t: 'circle', cx, cy, r, stroke: st });
    else grid.push({ t: 'arc', cx, cy, r, a0: 0, a1: Math.PI, stroke: st });
  }
  // лучи
  const step = style.grid.angleStep;
  const gEnd = full ? 180 : 90;
  for (let g = 0; g <= gEnd + 1e-9; g += step) {
    const major = g % 90 === 0;
    for (const side of g === 0 || g === 180 ? [1] : [1, -1]) {
      const [x2, y2] = pt(g, R, side);
      grid.push({ t: 'line', x1: cx, y1: cy, x2, y2, stroke: major ? majorStroke : gridStroke });
    }
  }

  // --- подписи
  const labels: Prim[] = [];
  const every = step * style.grid.angleLabelEvery;
  for (let g = 0; g <= gEnd + 1e-9; g += every) {
    for (const side of g === 0 || g === 180 ? [1] : [1, -1]) {
      const [x, y] = pt(g, R + labelGap, side);
      const sn = Math.sin(g * RAD) * side;
      const cs = Math.cos(g * RAD);
      const anchor = sn > 0.2 ? 'start' : sn < -0.2 ? 'end' : 'middle';
      // базовая линия: внизу — под точкой, вверху — над, по бокам — по центру
      const by = y + capT * (0.5 + 0.5 * cs);
      labels.push({ t: 'text', x, y: by, text: `${g}°`, size: tick, color: style.colors.text, anchor });
    }
  }
  // значения колец: вдоль оси 180° (вся сфера) или вправо под осью 90° (нижняя полусфера)
  for (const v of scale.ticks) {
    const r = (v / scale.max) * R;
    const text = fmtNum(opts.lang, v, scale.decimals);
    // под линией кольца, справа от оси — не задевает подпись «180°» над окружностью
    if (full) labels.push({ t: 'text', x: cx + 0.8, y: cy - r + capT + 0.6, text, size: tick, color: style.colors.text, anchor: 'start' });
    else labels.push({ t: 'text', x: cx + r - 0.5, y: cy + capT + 0.8, text, size: tick, color: style.colors.text, anchor: 'end' });
  }
  // единицы — в свободном углу
  if (full) labels.push({ t: 'text', x: cx - R, y: cy - R + capT, text: data.unitLabel, size: tick, color: style.colors.text, anchor: 'start' });
  else labels.push({ t: 'text', x: cx - R, y: cy + R, text: data.unitLabel, size: tick, color: style.colors.text, anchor: 'start' });

  // --- кривые
  const curves: Prim[] = [];
  const sideMain = opts.cSide === 'right' ? 1 : -1;
  data.series.forEach((sr, i) => {
    const rad = (v: number) => (Math.min(v, scale.max) / scale.max) * R;
    const left = sr.opposite.slice().reverse().map(([g, v]) => pt(g, rad(v), -sideMain));
    const right = sr.main.map(([g, v]) => pt(g, rad(v), sideMain));
    const pts = [...left, ...right];
    const lastG = sr.main[sr.main.length - 1]?.[0] ?? 0;
    const closed = lastG >= 180 - 1e-9;
    // заливка под первой кривой (если задана в стиле): контур замыкается через центр
    if (i === 0 && style.colors.fill) curves.push({ t: 'polyline', pts: closed ? pts : [...pts, [cx, cy]], closed: true, fill: style.colors.fill });
    curves.push({ t: 'polyline', pts, closed, stroke: seriesStroke(style, i) });
  });

  const leg = legend(ctx, data, pad, bottom + 1, W - 2 * pad);
  const H = bottom + (leg.height > 0 ? leg.height + 2 : 0) + pad;

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
