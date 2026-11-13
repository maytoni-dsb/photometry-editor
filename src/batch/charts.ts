/**
 * Графики в пакетной выгрузке: те же построители и рендеры, что на вкладках «Полярная» / «Линейная»,
 * с общими настройками и стилем. «Общий масштаб» — одна шкала на все файлы: максимум по набору,
 * округлённый по правилу оформления (каталог — catalogScale, стандартное — niceScale).
 */

import { fontMeasure, type FontSet } from '../charts/fonts';
import { buildLinear } from '../charts/linear';
import { buildPolar } from '../charts/polar';
import { renderEps } from '../charts/render-eps';
import { renderPdf } from '../charts/render-pdf';
import { renderSvg } from '../charts/render-svg';
import { approxTextWidth, type MeasureText, type Scene } from '../charts/scene';
import { catalogScale, chartData, defaultPlanes, niceScale, type ChartOptions } from '../charts/series';
import type { ChartStyle } from '../charts/style';
import type { ColorMode } from '../charts/vector';
import type { Photometry } from '../core/model';
import type { PhotometrySummary } from '../core/summary';

export type ChartKind = 'polar' | 'linear';
export type ChartFormat = 'svg' | 'pdf' | 'eps';

/** Настройки графиков — те же, что в приложении (ChartSettings). */
export interface BatchChartSettings extends Omit<ChartOptions, 'planes'> {
  planes: number[] | null;
  linearWidth: number;
}

export interface BatchCharts {
  kinds: ChartKind[];
  formats: ChartFormat[];
  color: ColorMode;
  textAsPaths: boolean;
  /** Одна шкала для всех файлов набора. */
  commonScale: boolean;
  settings: BatchChartSettings;
  style: ChartStyle;
}

export function chartOptions(kind: ChartKind, p: Photometry, s: BatchChartSettings, scaleMax: number | null): ChartOptions {
  return {
    ...s,
    planes: s.planes ?? defaultPlanes(p),
    width: kind === 'polar' ? s.width : s.linearWidth,
    scaleMax: scaleMax ?? s.scaleMax,
    // заголовок — свой у каждого файла (артикул), общий текст из настроек не переносим
    title: '',
  };
}

/** Максимум общей шкалы для набора (в единицах графика) или null, если общий масштаб не нужен. */
export function commonScaleMax(items: Array<{ p: Photometry; s: PhotometrySummary }>, kind: ChartKind, cfg: BatchCharts): number | null {
  if (!cfg.commonScale || cfg.settings.scaleMax) return null;
  let max = 0;
  for (const { p, s } of items) {
    const o = chartOptions(kind, p, cfg.settings, null);
    const d = chartData(p, s, o);
    // оформление каталога считает шкалу от Iмакс тела, стандартное — от кривых на графике
    max = Math.max(max, cfg.settings.layout === 'catalog' ? s.peak.value * d.factor : d.maxValue);
  }
  if (!(max > 0)) return null;
  return cfg.settings.layout === 'catalog' ? catalogScale(max).max : niceScale(max).max;
}

export function measureFor(fonts: FontSet | null | undefined): MeasureText {
  return fonts ? fontMeasure(fonts) : approxTextWidth;
}

export function buildChart(kind: ChartKind, p: Photometry, s: PhotometrySummary, opts: ChartOptions, style: ChartStyle, measure: MeasureText): Scene {
  return kind === 'polar' ? buildPolar(p, s, opts, style, measure) : buildLinear(p, s, opts, style, measure);
}

export async function renderChart(scene: Scene, fmt: ChartFormat, cfg: BatchCharts, fonts: FontSet | null | undefined): Promise<string | Uint8Array> {
  if (fmt === 'svg') return renderSvg(scene, { xmlDeclaration: true });
  if (!fonts) throw new Error('fonts');
  const o = { color: cfg.color, fonts, textAsPaths: cfg.textAsPaths };
  return fmt === 'pdf' ? renderPdf(scene, o) : renderEps(scene, o);
}
