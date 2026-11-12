import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  buildLinear,
  buildPolar,
  chartData,
  defaultChartOptions,
  defaultStyle,
  fmtNum,
  fontMeasure,
  MM_TO_PT,
  niceScale,
  planeLabel,
  renderEps,
  renderPdf,
  renderSvg,
  sanitizeStyle,
  walk,
  type ChartOptions,
  type FontSet,
  type Prim,
  type Scene,
} from '../src/charts/index';
import { summarize } from '../src/core/index';
import { asym, lambert, makeC } from './helpers';

const fonts: FontSet = {
  regular: new Uint8Array(readFileSync('public/fonts/Roboto-Regular.woff')),
  bold: new Uint8Array(readFileSync('public/fonts/Roboto-Medium.woff')),
};
const style = defaultStyle();
const opts = (o: Partial<ChartOptions> = {}): ChartOptions => ({ ...defaultChartOptions(), ...o });

function prims(scene: Scene, group: string): Prim[] {
  const g = scene.children.find((p) => p.t === 'group' && p.id === group);
  return g && g.t === 'group' ? g.children : [];
}

function allNumbers(scene: Scene): number[] {
  const out: number[] = [scene.width, scene.height];
  walk(scene.children, (p) => {
    for (const v of Object.values(p)) {
      if (typeof v === 'number') out.push(v);
      if (Array.isArray(v)) out.push(...v.flat().filter((x): x is number => typeof x === 'number'));
    }
  });
  return out;
}

describe('шкала и подписи', () => {
  it('красивая шкала', () => {
    expect(niceScale(4654)).toMatchObject({ max: 5000, step: 1000, ticks: [1000, 2000, 3000, 4000, 5000] });
    expect(niceScale(754).max).toBe(800);
    expect(niceScale(412)).toMatchObject({ max: 500, step: 100 });
    expect(niceScale(0.83)).toMatchObject({ max: 1, step: 0.2, decimals: 1 });
    expect(niceScale(22).step).toBe(5);
    expect(niceScale(12, 30).max).toBe(30);
    expect(niceScale(0).max).toBeGreaterThan(0);
  });

  it('числа и плоскости', () => {
    expect(fmtNum('ru', 12345.6, 1)).toBe('12 345,6');
    expect(fmtNum('en', 12345.6, 1)).toBe('12,345.6');
    expect(fmtNum('de', -2.5, 1)).toBe('−2,5');
    expect(planeLabel(90)).toBe('C90–C270');
    expect(planeLabel(270)).toBe('C270–C90');
  });
});

describe('данные графиков', () => {
  it('кд/клм относительно потока ламп', () => {
    const p = makeC(lambert, { symmetry: 'axial', flux: 2000 });
    const s = summarize(p);
    const d = chartData(p, s, opts());
    expect(d.factor).toBeCloseTo(0.5, 9);
    expect(d.series).toHaveLength(1);
    expect(d.maxValue).toBeCloseTo(500, 6);
    expect(d.gLimit).toBe(90);
    expect(chartData(p, s, opts({ unit: 'cd' })).maxValue).toBeCloseTo(1000, 6);
  });

  it('кд/клм для абсолютной фотометрии без потока — от расчётного', () => {
    const p = makeC(lambert, { symmetry: 'axial' });
    p.lamps[0].flux = null;
    const s = summarize(p);
    expect(s.referenceKind).toBe('computed');
    expect(s.flux.total).toBeCloseTo(1000 * Math.PI, -1);
    expect(chartData(p, s, opts()).maxValue).toBeCloseTo((1000 * 1000) / s.flux.total, 6);
  });

  it('свет вверх — полная сфера', () => {
    const p = makeC((c, g) => (g <= 90 ? 100 : 30), { symmetry: 'axial', flux: 1000 });
    expect(chartData(p, summarize(p), opts()).gLimit).toBe(180);
    expect(chartData(p, summarize(p), opts({ range: 'lower' })).gLimit).toBe(90);
  });
});

describe('полярная КСС', () => {
  it('γ = 0 внизу по центру, радиус пропорционален силе света', () => {
    const p = makeC(lambert, { symmetry: 'axial', flux: 1000 });
    const scene = buildPolar(p, summarize(p), opts({ show: { title: false, info: false, legend: false } }), style);
    const arcs = prims(scene, 'grid').filter((x) => x.t === 'arc');
    expect(arcs.length).toBeGreaterThan(2); // нижняя полусфера — дуги
    const outer = arcs.reduce((a, b) => ((a as { r: number }).r > (b as { r: number }).r ? a : b)) as { cx: number; cy: number; r: number };
    const curve = prims(scene, 'curves')[0];
    expect(curve.t).toBe('polyline');
    if (curve.t !== 'polyline') return;
    // точка γ = 0: max 1000 кд/клм, шкала 1000 → на внешней дуге внизу
    const bottom = curve.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(bottom[0]).toBeCloseTo(outer.cx, 6);
    expect(bottom[1]).toBeCloseTo(outer.cy + outer.r, 6);
    // ламберт: на 60° радиус вдвое меньше
    const at60 = curve.pts.find(([x, y]) => Math.abs(Math.atan2(x - outer.cx, y - outer.cy) - Math.PI / 3) < 1e-6)!;
    expect(Math.hypot(at60[0] - outer.cx, at60[1] - outer.cy)).toBeCloseTo(outer.r / 2, 6);
    expect(allNumbers(scene).every(Number.isFinite)).toBe(true);
  });

  it('плоскость C справа, C + 180° слева; переключение стороны', () => {
    const p = makeC(asym, { flux: 1000 });
    const s = summarize(p);
    const extent = (scene: Scene) => {
      const c = prims(scene, 'grid').find((x) => x.t === 'arc') as { cx: number };
      const curve = prims(scene, 'curves')[0] as { pts: Array<[number, number]> };
      return { right: Math.max(...curve.pts.map((q) => q[0] - c.cx)), left: Math.max(...curve.pts.map((q) => c.cx - q[0])) };
    };
    // asym: в C0 сильнее, чем в C180
    const r = extent(buildPolar(p, s, opts({ planes: [0] }), style));
    expect(r.right).toBeGreaterThan(r.left * 1.5);
    const l = extent(buildPolar(p, s, opts({ planes: [0], cSide: 'left' }), style));
    expect(l.left).toBeCloseTo(r.right, 6);
  });

  it('полная сфера — замкнутая кривая и окружности', () => {
    const p = makeC((c, g) => 100 + 50 * Math.cos((g * Math.PI) / 180), { symmetry: 'axial', flux: 1000 });
    const scene = buildPolar(p, summarize(p), opts(), style);
    expect(prims(scene, 'grid').some((x) => x.t === 'circle')).toBe(true);
    const curve = prims(scene, 'curves')[0];
    expect(curve.t === 'polyline' && curve.closed).toBe(true);
  });
});

describe('линейная КСС', () => {
  it('ось γ симметрична, максимум над нулём', () => {
    const p = makeC(lambert, { symmetry: 'axial', flux: 1000 });
    const scene = buildLinear(p, summarize(p), opts({ show: { title: false, info: false, legend: false } }), style);
    const frame = prims(scene, 'grid').find((x) => x.t === 'rect') as { x: number; y: number; w: number; h: number };
    const curve = prims(scene, 'curves')[0] as { pts: Array<[number, number]> };
    const top = curve.pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(top[0]).toBeCloseTo(frame.x + frame.w / 2, 6);
    expect(top[1]).toBeCloseTo(frame.y, 6);
    expect(curve.pts[0][0]).toBeCloseTo(frame.x, 6);
    expect(curve.pts[curve.pts.length - 1][0]).toBeCloseTo(frame.x + frame.w, 6);
    const texts = prims(scene, 'labels').filter((x) => x.t === 'text').map((x) => (x as { text: string }).text);
    expect(texts).toContain('−90°');
    expect(texts).toContain('кд/клм');
  });
});

describe('экспорт', () => {
  const p = makeC(asym, { flux: 1000 });
  p.meta.article = 'ТЕСТ-001';
  const s = summarize(p);
  const scene = buildPolar(p, s, opts(), style, fontMeasure(fonts));

  it('SVG: размеры в мм, текст текстом, слои', () => {
    const svg = renderSvg(scene, { xmlDeclaration: true });
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain(`width="${Math.round(scene.width * 1000) / 1000}mm"`);
    expect(svg).toContain('<text');
    expect(svg).toContain('ТЕСТ-001');
    expect(svg).toContain('inkscape:groupmode="layer" inkscape:label="curves"');
    expect(svg).not.toMatch(/NaN|undefined/);
    let n = 0;
    walk(scene.children, (x) => { if (x.t === 'text') n++; });
    expect(svg.match(/<text /g)?.length).toBe(n);
  });

  it('PDF RGB и CMYK: размер страницы, встроенный шрифт', async () => {
    for (const color of ['rgb', 'cmyk'] as const) {
      const bytes = await renderPdf(scene, { color, fonts });
      const doc = await PDFDocument.load(bytes);
      const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
      expect(w).toBeCloseTo(scene.width * MM_TO_PT, 3);
      expect(h).toBeCloseTo(scene.height * MM_TO_PT, 3);
      const raw = new TextDecoder('latin1').decode(bytes);
      expect(raw).toContain('/FontFile2');
      expect(raw).toContain('/ToUnicode');
    }
    const curves = await renderPdf(scene, { color: 'cmyk', fonts, textAsPaths: true });
    expect(new TextDecoder('latin1').decode(curves)).not.toContain('/FontFile2');
  });

  it('EPS: Type 42 со своей кодировкой, CMYK без RGB', async () => {
    const eps = await renderEps(scene, { color: 'cmyk', fonts });
    expect(eps.startsWith('%!PS-Adobe-3.0 EPSF-3.0\n')).toBe(true);
    expect(eps).toContain(`%%BoundingBox: 0 0 ${Math.ceil(scene.width * MM_TO_PT)} ${Math.ceil(scene.height * MM_TO_PT)}`);
    expect(eps).toContain('/FontType 42 def');
    expect(eps).toMatch(/\/sfnts \[\n</);
    expect(eps).toContain('setcmykcolor');
    expect(eps).not.toContain('setrgbcolor');
    expect(eps).toContain('% ????-001'); // строка текста в комментарии, только ASCII
    expect(/[^\x00-\x7f]/.test(eps)).toBe(false);
    expect(eps).not.toMatch(/NaN|undefined/);
    // каждая строка sfnts — чётной длины, не длиннее 65535 байт
    const sfnts = eps.slice(eps.indexOf('/sfnts ['), eps.indexOf('] def', eps.indexOf('/sfnts [')));
    for (const m of sfnts.matchAll(/<([0-9a-f\s]+)>/g)) {
      const hex = m[1].replace(/\s/g, '');
      expect(hex.length % 2).toBe(0);
      expect(hex.length / 2).toBeLessThanOrEqual(65535);
    }
    const rgb = await renderEps(scene, { color: 'rgb', fonts, textAsPaths: true });
    expect(rgb).not.toContain('/FontType 42');
    expect(rgb).toContain('setrgbcolor');
  });
});

describe('стиль', () => {
  it('битый стиль дополняется значениями по умолчанию', () => {
    const s = sanitizeStyle({ name: 'X', font: { title: 100 }, colors: { text: { rgb: [1, 2], cmyk: [] }, series: [] }, grid: { angleStep: 7 } });
    expect(s.name).toBe('X');
    expect(s.font.title).toBe(30);
    expect(s.colors.text).toEqual(defaultStyle().colors.text);
    expect(s.colors.series.length).toBe(6);
    expect(s.grid.angleStep).toBe(15);
    expect(sanitizeStyle(JSON.parse(JSON.stringify(defaultStyle())))).toEqual(defaultStyle());
  });
});
