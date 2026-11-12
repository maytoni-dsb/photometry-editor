/**
 * Стиль графиков: шрифт, цвета (RGB + CMYK), толщины линий, штрихи, сетка.
 * Стиль общий для всех графиков и для пакетной выгрузки; сохраняется в JSON.
 */

import type { Color } from './scene';

export interface ChartStyle {
  /** Версия формата стиля. */
  version: 1;
  name: string;
  font: {
    /** Имя семейства (для SVG) — встроенный Roboto или загруженный пользователем шрифт. */
    family: string;
    /** Кегль, пт. */
    title: number;
    label: number;
    tick: number;
  };
  colors: {
    text: Color;
    /** Второстепенная сетка (промежуточные кольца, лучи). */
    grid: Color;
    /** Основная сетка (подписанные кольца, оси 0°/90°). */
    gridMajor: Color;
    /** Фон; null — прозрачный. */
    background: Color | null;
    /** Цвета кривых по порядку плоскостей. */
    series: Color[];
    /** Заливка под первой кривой полярной КСС; null — без заливки. */
    fill: Color | null;
  };
  /** Толщины, мм. */
  widths: {
    curve: number;
    grid: number;
    gridMajor: number;
  };
  /** Штрихи кривых по порядку, мм; пустой массив — сплошная. */
  dashes: number[][];
  /** Штрих линий сетки, мм; пустой — сплошные. */
  gridDash: number[];
  grid: {
    /** Шаг лучей полярной сетки и шаг оси γ линейной КСС, °. */
    angleStep: number;
    /** Подписывать каждый n-й луч / деление. */
    angleLabelEvery: number;
  };
}

export function rgbHex(c: Color): string {
  return '#' + c.rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Простой перевод RGB → CMYK (без цветового профиля) — подсказка, когда CMYK не задан. */
export function naiveCmyk(rgb: [number, number, number]): [number, number, number, number] {
  const [r, g, b] = rgb.map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const f = (x: number) => Math.round(((1 - x - k) / (1 - k)) * 100);
  return [f(r), f(g), f(b), Math.round(k * 100)];
}

const c = (rgb: [number, number, number], cmyk: [number, number, number, number]): Color => ({ rgb, cmyk });

/** Нейтральный стиль по умолчанию (до получения фирменного образца). */
export function defaultStyle(): ChartStyle {
  return {
    version: 1,
    name: 'По умолчанию',
    font: { family: 'Roboto', title: 9, label: 7, tick: 6 },
    colors: {
      text: c([35, 31, 32], [0, 0, 0, 100]),
      grid: c([200, 200, 200], [0, 0, 0, 25]),
      gridMajor: c([140, 140, 140], [0, 0, 0, 50]),
      background: null,
      series: [
        c([215, 38, 50], [0, 95, 80, 5]),
        c([0, 94, 170], [100, 55, 0, 5]),
        c([0, 140, 70], [90, 10, 100, 5]),
        c([240, 140, 0], [0, 50, 100, 0]),
        c([120, 60, 160], [60, 80, 0, 0]),
        c([90, 90, 90], [0, 0, 0, 75]),
      ],
      fill: null,
    },
    widths: { curve: 0.35, grid: 0.1, gridMajor: 0.2 },
    dashes: [[], [1.6, 0.8], [0.4, 0.6], [2.4, 0.8, 0.4, 0.8], [], []],
    gridDash: [],
    grid: { angleStep: 15, angleLabelEvery: 2 },
  };
}

const PT = 25.4 / 72;

/**
 * Стиль каталога MAYTONI — по образцу «LIC eps stage2» (12.11.2026):
 * кегль 6 пт, линии 0,3 пт, сетка пунктиром 0,43 / 1,29 пт, всё чёрное (K100),
 * заливка под кривой CMYK 0/0/20/0 (RGB 255/255/204), лучи через 30°.
 * Шрифт образца — Helvetica (MATLAB); у нас по умолчанию Roboto, свой шрифт можно загрузить.
 */
export function catalogStyle(): ChartStyle {
  const black = c([0, 0, 0], [0, 0, 0, 100]);
  const w = 0.3 * PT;
  return {
    version: 1,
    name: 'MAYTONI каталог',
    font: { family: 'Roboto', title: 6, label: 6, tick: 6 },
    colors: {
      text: black,
      grid: black,
      gridMajor: black,
      background: null,
      series: [black, c([0, 94, 170], [100, 55, 0, 5]), c([215, 38, 50], [0, 95, 80, 5]), c([0, 140, 70], [90, 10, 100, 5])],
      fill: c([255, 255, 204], [0, 0, 20, 0]),
    },
    widths: { curve: w, grid: w, gridMajor: w },
    dashes: [[], [1.2, 0.6], [0.3, 0.5], [1.6, 0.5, 0.3, 0.5]],
    gridDash: [(3 / 7) * PT, (9 / 7) * PT],
    grid: { angleStep: 30, angleLabelEvery: 1 },
  };
}

/** Готовые стили. */
export const STYLE_PRESETS: Array<{ id: string; make: () => ChartStyle }> = [
  { id: 'default', make: defaultStyle },
  { id: 'catalog', make: catalogStyle },
];

function isColor(x: unknown): x is Color {
  const o = x as Color;
  return !!o && Array.isArray(o.rgb) && o.rgb.length === 3 && Array.isArray(o.cmyk) && o.cmyk.length === 4 &&
    [...o.rgb, ...o.cmyk].every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Проверяет и дополняет загруженный стиль значениями по умолчанию. */
export function sanitizeStyle(input: unknown): ChartStyle {
  const d = defaultStyle();
  const s = (input ?? {}) as Partial<ChartStyle>;
  const num = (v: unknown, def: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  const col = (v: unknown, def: Color) => (isColor(v) ? { rgb: [...v.rgb], cmyk: [...v.cmyk] } as Color : def);
  const series = Array.isArray(s.colors?.series) ? s.colors!.series.filter(isColor) : [];
  return {
    version: 1,
    name: typeof s.name === 'string' ? s.name : d.name,
    font: {
      family: typeof s.font?.family === 'string' && s.font.family ? s.font.family : d.font.family,
      title: num(s.font?.title, d.font.title, 3, 30),
      label: num(s.font?.label, d.font.label, 3, 30),
      tick: num(s.font?.tick, d.font.tick, 3, 30),
    },
    colors: {
      text: col(s.colors?.text, d.colors.text),
      grid: col(s.colors?.grid, d.colors.grid),
      gridMajor: col(s.colors?.gridMajor, d.colors.gridMajor),
      background: s.colors?.background === null ? null : isColor(s.colors?.background) ? col(s.colors!.background, d.colors.text) : d.colors.background,
      series: series.length ? series.map((x) => col(x, x)) : d.colors.series,
      fill: s.colors?.fill === null || s.colors?.fill === undefined ? null : isColor(s.colors.fill) ? col(s.colors.fill, s.colors.fill) : null,
    },
    widths: {
      curve: num(s.widths?.curve, d.widths.curve, 0.01, 3),
      grid: num(s.widths?.grid, d.widths.grid, 0.01, 3),
      gridMajor: num(s.widths?.gridMajor, d.widths.gridMajor, 0.01, 3),
    },
    dashes: Array.isArray(s.dashes)
      ? s.dashes.map((x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'number' && v >= 0) : []))
      : d.dashes,
    gridDash: Array.isArray(s.gridDash) ? s.gridDash.filter((v) => typeof v === 'number' && v > 0) : d.gridDash,
    grid: {
      angleStep: [5, 10, 15, 30].includes(s.grid?.angleStep as number) ? (s.grid!.angleStep as number) : d.grid.angleStep,
      angleLabelEvery: num(s.grid?.angleLabelEvery, d.grid.angleLabelEvery, 1, 6),
    },
  };
}
