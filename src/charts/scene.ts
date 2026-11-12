/**
 * Сцена графика — независимое от формата описание рисунка.
 * Один и тот же построитель (полярная, линейная КСС) выдаёт сцену, а рендеры
 * переводят её в SVG (экран и экспорт), PDF и EPS. Так экспорт совпадает с экраном.
 *
 * Единицы: миллиметры, ось Y вниз (как в SVG). Размер шрифта — в пунктах.
 */

/** Цвет задаётся парой: RGB для экрана и SVG, CMYK для печати (PDF/EPS). */
export interface Color {
  /** 0…255 */
  rgb: [number, number, number];
  /** 0…100 % */
  cmyk: [number, number, number, number];
}

export interface Stroke {
  color: Color;
  /** Толщина, мм. */
  width: number;
  /** Штрих, мм (пусто — сплошная). */
  dash?: number[];
}

export type TextAnchor = 'start' | 'middle' | 'end';

/** Кусок текста другого размера / смещённый по вертикали (нижний индекс «max» в Iₘₐₓ). */
export interface TextRun {
  text: string;
  /** Доля кегля (1 — основной). */
  scale: number;
  /** Смещение базовой линии вниз, мм. */
  dy: number;
}

export type Prim =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
  | { t: 'polyline'; pts: Array<[number, number]>; closed?: boolean; stroke?: Stroke; fill?: Color }
  | { t: 'circle'; cx: number; cy: number; r: number; stroke?: Stroke; fill?: Color }
  /** Дуга окружности от a0 до a1 (радианы, отсчёт как в SVG: от +X по часовой стрелке при Y вниз), a1 > a0. */
  | { t: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; stroke: Stroke }
  | { t: 'rect'; x: number; y: number; w: number; h: number; stroke?: Stroke; fill?: Color }
  /**
   * Текст: (x, y) — точка на базовой линии, size — кегль в пт.
   * rotate — поворот в градусах против часовой стрелки вокруг (x, y).
   * runs — текст из кусков (тогда text = их склейка, для поиска и метаданных).
   */
  | { t: 'text'; x: number; y: number; text: string; size: number; color: Color; anchor: TextAnchor; bold?: boolean; rotate?: number; runs?: TextRun[] }
  /** Группа (в SVG-редакторах становится слоем / группой с именем). */
  | { t: 'group'; id: string; children: Prim[] };

export interface Scene {
  /** Размер, мм. */
  width: number;
  height: number;
  /** Заголовок документа (метаданные SVG/PDF/EPS). */
  title: string;
  /** Имя семейства шрифта для текста. */
  fontFamily: string;
  background?: Color;
  children: Prim[];
}

export const PT_TO_MM = 25.4 / 72;
export const MM_TO_PT = 72 / 25.4;

/** Обходит все примитивы сцены (с вложенностью). */
export function walk(prims: Prim[], fn: (p: Prim) => void): void {
  for (const p of prims) {
    fn(p);
    if (p.t === 'group') walk(p.children, fn);
  }
}

/** Все тексты сцены — для подбора глифов шрифта. */
export function sceneText(scene: Scene): string {
  let s = '';
  walk(scene.children, (p) => {
    if (p.t === 'text') s += p.text;
  });
  return s;
}

/**
 * Приближённая ширина текста, мм (для раскладки до загрузки шрифта).
 * Средняя ширина знака Roboto ≈ 0,53 кегля, цифры — 0,56.
 */
export function approxTextWidth(text: string, sizePt: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) w += 0.562;
    else if (/[iljI.,:;'|!·]/.test(ch)) w += 0.25;
    else if (ch === ' ') w += 0.25;
    else if (/[mwMWЖШЩЮжшщю]/.test(ch)) w += 0.85;
    else if (/[A-ZА-ЯЁÄÖÜ]/.test(ch)) w += 0.66;
    else w += 0.53;
  }
  return w * sizePt * PT_TO_MM;
}

/** Функция измерения ширины текста, мм. */
export type MeasureText = (text: string, sizePt: number, bold?: boolean) => number;
