/**
 * Общая часть PDF- и EPS-рендеров: обход сцены в координатах печати
 * (пункты, ось Y вверх), окружности и дуги — кривыми Безье, текст — отдельным вызовом.
 */

import { MM_TO_PT, type Color, type Prim, type Scene, type Stroke, type TextAnchor, type TextRun } from './scene';

export type Seg = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export interface VectorText {
  /** Точка привязки на базовой линии, пт (Y вверх). */
  x: number;
  y: number;
  text: string;
  /** Кегль, пт. */
  size: number;
  color: Color;
  anchor: TextAnchor;
  bold: boolean;
  /** Поворот против часовой стрелки, °. */
  rotate: number;
  /** Куски текста (dy — в пунктах, вниз). */
  runs: TextRun[];
}

/** Кусок текста, готовый к выводу: точка начала на базовой линии (пт, Y вверх) и кегль. */
export interface PlacedRun {
  text: string;
  x: number;
  y: number;
  size: number;
}

/**
 * Раскладывает текст по кускам с учётом выравнивания и поворота.
 * width(text, size) — ширина в пунктах по шрифту рендера.
 */
export function placeRuns(t: VectorText, width: (text: string, size: number) => number): PlacedRun[] {
  const sized = t.runs.map((r) => ({ ...r, size: t.size * r.scale, w: width(r.text, t.size * r.scale) }));
  const total = sized.reduce((s, r) => s + r.w, 0);
  const k = t.anchor === 'start' ? 0 : t.anchor === 'middle' ? 0.5 : 1;
  const a = (t.rotate * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  let u = -k * total;
  return sized.map((r) => {
    const v = -r.dy; // вниз по странице = минус по Y
    const out = { text: r.text, size: r.size, x: t.x + u * ca - v * sa, y: t.y + u * sa + v * ca };
    u += r.w;
    return out;
  });
}

export interface VectorSink {
  /** Начало и конец группы (слоя). */
  begin(id: string): void;
  end(): void;
  /** Путь в пунктах; stroke — обводка (толщина и штрих в пт), fill — заливка. */
  path(segs: Seg[], stroke: { color: Color; width: number; dash: number[] } | null, fill: Color | null): void;
  text(t: VectorText): void;
}

const K = 4 / 3;

/** Дуга (в координатах сцены) кривыми Безье по ≤ 90°. */
export function arcSegments(cx: number, cy: number, r: number, a0: number, a1: number, move: boolean): Seg[] {
  const segs: Seg[] = [];
  const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2) - 1e-9));
  const d = (a1 - a0) / n;
  const k = K * Math.tan(d / 4) * r;
  if (move) segs.push(['M', cx + r * Math.cos(a0), cy + r * Math.sin(a0)]);
  for (let i = 0; i < n; i++) {
    const a = a0 + i * d;
    const b = a + d;
    const p0x = cx + r * Math.cos(a);
    const p0y = cy + r * Math.sin(a);
    const p3x = cx + r * Math.cos(b);
    const p3y = cy + r * Math.sin(b);
    segs.push(['C', p0x - k * Math.sin(a), p0y + k * Math.cos(a), p3x + k * Math.sin(b), p3y - k * Math.cos(b), p3x, p3y]);
  }
  return segs;
}

/** Переводит сегменты из мм сцены (Y вниз) в пункты (Y вверх). */
function toPt(segs: Seg[], H: number): Seg[] {
  const X = (x: number) => x * MM_TO_PT;
  const Y = (y: number) => (H - y) * MM_TO_PT;
  return segs.map((s): Seg => {
    switch (s[0]) {
      case 'M':
      case 'L':
        return [s[0], X(s[1]), Y(s[2])];
      case 'C':
        return ['C', X(s[1]), Y(s[2]), X(s[3]), Y(s[4]), X(s[5]), Y(s[6])];
      default:
        return s;
    }
  });
}

const strokePt = (s: Stroke | undefined) =>
  s ? { color: s.color, width: s.width * MM_TO_PT, dash: (s.dash ?? []).map((d) => d * MM_TO_PT) } : null;

function walkPrim(p: Prim, H: number, sink: VectorSink): void {
  switch (p.t) {
    case 'group':
      sink.begin(p.id);
      for (const c of p.children) walkPrim(c, H, sink);
      sink.end();
      return;
    case 'line':
      sink.path(toPt([['M', p.x1, p.y1], ['L', p.x2, p.y2]], H), strokePt(p.stroke), null);
      return;
    case 'polyline': {
      if (p.pts.length < 2) return;
      const segs: Seg[] = p.pts.map(([x, y], i) => [i === 0 ? 'M' : 'L', x, y] as Seg);
      if (p.closed) segs.push(['Z']);
      sink.path(toPt(segs, H), strokePt(p.stroke), p.fill ?? null);
      return;
    }
    case 'circle': {
      const segs = arcSegments(p.cx, p.cy, p.r, 0, 2 * Math.PI, true);
      segs.push(['Z']);
      sink.path(toPt(segs, H), strokePt(p.stroke), p.fill ?? null);
      return;
    }
    case 'arc':
      sink.path(toPt(arcSegments(p.cx, p.cy, p.r, p.a0, p.a1, true), H), strokePt(p.stroke), null);
      return;
    case 'rect': {
      const segs: Seg[] = [['M', p.x, p.y], ['L', p.x + p.w, p.y], ['L', p.x + p.w, p.y + p.h], ['L', p.x, p.y + p.h], ['Z']];
      sink.path(toPt(segs, H), strokePt(p.stroke), p.fill ?? null);
      return;
    }
    case 'text':
      if (!p.text) return;
      sink.text({
        x: p.x * MM_TO_PT,
        y: (H - p.y) * MM_TO_PT,
        text: p.text,
        size: p.size,
        color: p.color,
        anchor: p.anchor,
        bold: !!p.bold,
        rotate: p.rotate ?? 0,
        runs: p.runs?.length ? p.runs.map((r) => ({ ...r, dy: r.dy * MM_TO_PT })) : [{ text: p.text, scale: 1, dy: 0 }],
      });
      return;
  }
}

export function walkVector(scene: Scene, sink: VectorSink): void {
  const H = scene.height;
  if (scene.background) {
    sink.path(toPt([['M', 0, 0], ['L', scene.width, 0], ['L', scene.width, H], ['L', 0, H], ['Z']], H), null, scene.background);
  }
  for (const c of scene.children) walkPrim(c, H, sink);
}

/** Размер страницы в пунктах. */
export function pageSizePt(scene: Scene): [number, number] {
  return [scene.width * MM_TO_PT, scene.height * MM_TO_PT];
}

export type ColorMode = 'rgb' | 'cmyk';

/** Компоненты цвета 0…1 для выбранного режима. */
export function colorComponents(c: Color, mode: ColorMode): number[] {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return mode === 'rgb' ? c.rgb.map((v) => clamp(v / 255)) : c.cmyk.map((v) => clamp(v / 100));
}
