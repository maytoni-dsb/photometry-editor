/**
 * Данные для графиков КСС: выбор плоскостей, единицы, шкала.
 */

import { intensityC } from '../core/angles';
import type { Lang } from '../core/issues';
import type { Photometry } from '../core/model';
import type { PhotometrySummary } from '../core/summary';
import { chartLabels, planeLabel } from './labels';

export type IntensityUnit = 'cdklm' | 'cd';
/** auto — нижняя полусфера, если вверх идёт меньше 0,5 % от максимума; full — вся сфера; lower — только нижняя. */
export type AngleRange = 'auto' | 'full' | 'lower';

export interface ChartOptions {
  /** Плоскости C; каждая рисуется парой C / C + 180°. */
  planes: number[];
  unit: IntensityUnit;
  /** Максимум шкалы в выбранных единицах; null — автоматически. */
  scaleMax: number | null;
  range: AngleRange;
  /** Язык подписей. */
  lang: Lang;
  /** С какой стороны рисовать плоскость C (вторая половина пары — напротив). */
  cSide: 'right' | 'left';
  /** Ширина графика, мм. */
  width: number;
  /** Высота области построения линейной КСС, мм. */
  height: number;
  show: { title: boolean; info: boolean; legend: boolean };
  /** Заголовок; пусто — артикул / название / имя файла. */
  title?: string;
}

export function defaultChartOptions(): ChartOptions {
  return {
    planes: [0, 90],
    unit: 'cdklm',
    scaleMax: null,
    range: 'auto',
    lang: 'ru',
    cSide: 'right',
    width: 100,
    height: 60,
    show: { title: true, info: true, legend: true },
  };
}

/** Плоскости по умолчанию: одна для осевой симметрии, C0–C180 и C90–C270 — для остальных. */
export function defaultPlanes(p: Photometry): number[] {
  return p.photometryType === 'C' && (p.symmetry === 'axial' || p.hAngles.length === 1) ? [0] : [0, 90];
}

export interface CurveSeries {
  c: number;
  label: string;
  /** Точки [γ, значение] плоскости C (по возрастанию γ). */
  main: Array<[number, number]>;
  /** Точки [γ, значение] плоскости C + 180°. */
  opposite: Array<[number, number]>;
}

export interface ChartData {
  series: CurveSeries[];
  /** Множитель кд → выбранные единицы. */
  factor: number;
  unitLabel: string;
  /** Наибольшее значение среди кривых, в выбранных единицах. */
  maxValue: number;
  /** Предел γ для рисования: 90 или 180. */
  gLimit: number;
  /** Заголовок графика. */
  title: string;
}

export function chartTitle(p: Photometry): string {
  return p.meta.article.trim() || p.meta.luminaireName.trim() || p.source.fileName.replace(/^.*[\\/]/, '').replace(/\.(ies|ldt)$/i, '');
}

export function chartData(p: Photometry, s: PhotometrySummary, opts: ChartOptions): ChartData {
  const c = s.asC;
  const factor = opts.unit === 'cdklm' ? 1000 / s.referenceFlux : 1;
  const labels = chartLabels[opts.lang];
  const axial = c.symmetry === 'axial' || c.hAngles.length === 1;
  const planes = (opts.planes.length ? opts.planes : defaultPlanes(p)).slice(0, 6);

  // Есть ли заметный свет выше горизонта
  let up = 0;
  c.candela.forEach((row) => row.forEach((x, j) => { if (c.vAngles[j] > 90 + 1e-6) up = Math.max(up, x); }));
  const hasUp = s.peak.value > 0 && up > 0.005 * s.peak.value;
  const gLimit = opts.range === 'full' ? 180 : opts.range === 'lower' ? 90 : hasUp ? 180 : 90;

  const gs = c.vAngles.filter((g) => g <= gLimit + 1e-9);
  // если данные кончаются раньше предела — кривая обрывается на последнем угле
  const curve = (cc: number) => gs.map((g) => [g, intensityC(c, cc, g) * factor] as [number, number]);
  const series: CurveSeries[] = (axial ? [planes[0] ?? 0] : planes).map((pc) => ({
    c: pc,
    label: planeLabel(axial ? 0 : pc),
    main: curve(pc),
    opposite: curve(pc + 180),
  }));
  let maxValue = 0;
  for (const sr of series) for (const [, v] of [...sr.main, ...sr.opposite]) maxValue = Math.max(maxValue, v);
  return {
    series,
    factor,
    unitLabel: opts.unit === 'cdklm' ? labels.cdklm : labels.cd,
    maxValue,
    gLimit,
    title: opts.title?.trim() || chartTitle(p),
  };
}

export interface NiceScale {
  max: number;
  step: number;
  ticks: number[];
  decimals: number;
}

/** «Красивая» шкала от 0: шаг 1, 2, 2,5 или 5 × 10ⁿ, 3–6 делений. */
export function niceScale(maxValue: number, fixedMax: number | null = null, target = 5): NiceScale {
  const top = fixedMax && fixedMax > 0 ? fixedMax : maxValue > 0 ? maxValue : 1;
  const raw = top / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => top / s <= target + 0.001) ?? 10 * mag;
  const max = fixedMax && fixedMax > 0 ? fixedMax : Math.ceil(top / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = step; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  if (fixedMax && ticks[ticks.length - 1] < max - step * 1e-6) ticks.push(max);
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (String(step / mag).includes('.') ? 1 : 0));
  return { max, step, ticks, decimals };
}
