import { useTranslation } from 'react-i18next';
import type { Dimensions, Photometry } from '../../core/index';

/**
 * Чертёж светильника по размерам из фотометрического файла: вид снизу, вид со стороны C270
 * (вдоль C0–C180) и вид со стороны C0 (вдоль C90–C270), с размерами в мм.
 *
 * LDT: корпус (строки 13–15) и светящая часть (строки 16–17, высоты по сторонам C0 / C90 / C180 / C270,
 * строки 18–21) — место выхода света залито. IES хранит только размеры светящей части —
 * чертится она, без выделения.
 */

const LUM_FILL = '#fff1a8';
const LUM_STROKE = '#c98a00';

interface Box {
  circle: boolean;
  L: number;
  W: number;
  H: number;
}

const boxOf = (d: Dimensions): Box => ({ circle: d.shape === 'circle', L: d.length, W: d.shape === 'circle' ? d.length : d.width, H: d.height });

export function drawingData(p: Photometry): { body: Box; lum: Box | null; heights: [number, number, number, number] | null } | null {
  const hasLuminaire = p.luminaire.shape !== 'point' && p.luminaire.length > 0;
  const hasLuminous = p.luminous.shape !== 'point' && p.luminous.length > 0;
  if (!hasLuminaire && !hasLuminous) return null;
  if (hasLuminaire) {
    return {
      body: boxOf(p.luminaire),
      lum: hasLuminous ? boxOf(p.luminous) : null,
      heights: p.ldt?.luminousHeights ?? (hasLuminous ? [p.luminous.height, p.luminous.height, p.luminous.height, p.luminous.height] : null),
    };
  }
  return { body: boxOf(p.luminous), lum: null, heights: null };
}

/**
 * Две проекции: вид сверху (L × W; светящая часть на нижней грани — штриховой линией, как невидимый
 * контур) и вид сбоку со стороны C270 (L × H; светящая часть — заливкой снизу). Только размеры,
 * без подписей видов.
 */
export function LuminaireDrawing({ photometry }: { photometry: Photometry }) {
  const { t, i18n } = useTranslation();
  const d = drawingData(photometry);
  if (!d) return <p className="muted small">{t('drawing.none')}</p>;
  const { body, lum, heights } = d;
  const fmt = (x: number) => x.toLocaleString(i18n.language, { maximumFractionDigits: 1 });

  const u = 1;
  // виды занимают около 150 × 100 единиц, подписи — постоянного размера
  const sc = Math.min(150 / Math.max(body.L, 1), 100 / Math.max(body.W + body.H, 1));
  const fs = 4.4 * u;
  const gap = 11 * u;
  const vis = (x: number) => Math.max(x * sc, 1.2 * u);
  const L = vis(body.L);
  const W = vis(body.W);
  const H = vis(body.H);
  const m = 12 * u;
  const x0 = m + 2 * u;
  const yPlan = 4 * u;
  const ySide = yPlan + W + gap;
  const lumDiff = lum && Math.abs(lum.L - body.L) > 1e-6;
  const width = x0 + L + m + 2 * u;
  const height = ySide + H + m + (lumDiff ? fs * 1.7 : 0) + 1 * u;

  const parts: React.ReactNode[] = [];
  let key = 0;
  const k = () => key++;
  const sw = 0.35 * u;
  const hidden = `${2 * u} ${1.2 * u}`;
  const shape = (circle: boolean, cx: number, cy: number, w: number, h: number, kind: 'body' | 'lum' | 'hidden') => {
    const props =
      kind === 'body'
        ? { className: 'dw-body', strokeWidth: sw }
        : kind === 'lum'
          ? { fill: LUM_FILL, stroke: LUM_STROKE, strokeWidth: sw }
          : { fill: LUM_FILL, fillOpacity: 0.55, stroke: LUM_STROKE, strokeWidth: sw, strokeDasharray: hidden };
    parts.push(circle ? <circle key={k()} cx={cx} cy={cy} r={w / 2} {...props} /> : <rect key={k()} x={cx - w / 2} y={cy - h / 2} width={w} height={h} {...props} />);
  };
  const text = (x: number, y: number, s: string, rot = 0) =>
    parts.push(
      <text key={k()} x={x} y={y} fontSize={fs} textAnchor="middle" className="dw-dim" transform={rot ? `rotate(${rot} ${x} ${y})` : undefined}>
        {s}
      </text>,
    );
  const a = 1.6 * u;
  const hdim = (xa: number, xb: number, y: number, value: number, ext: number) => {
    parts.push(
      <g key={k()} className="dw-dimline" strokeWidth={0.25 * u}>
        <line x1={xa} y1={y - ext} x2={xa} y2={y + a} />
        <line x1={xb} y1={y - ext} x2={xb} y2={y + a} />
        <line x1={xa} y1={y} x2={xb} y2={y} />
        <path d={`M${xa} ${y} l${a} ${-a / 2.5} v${(2 * a) / 2.5} z M${xb} ${y} l${-a} ${-a / 2.5} v${(2 * a) / 2.5} z`} className="dw-arrow" />
      </g>,
    );
    text((xa + xb) / 2, y - 1.2 * u, fmt(value));
  };
  /** Вертикальный размер; side = −1 — слева от объекта, +1 — справа. */
  const vdim = (ya: number, yb: number, x: number, value: number, ext: number, side: 1 | -1) => {
    parts.push(
      <g key={k()} className="dw-dimline" strokeWidth={0.25 * u}>
        <line x1={x - side * ext} y1={ya} x2={x + side * a} y2={ya} />
        <line x1={x - side * ext} y1={yb} x2={x + side * a} y2={yb} />
        <line x1={x} y1={ya} x2={x} y2={yb} />
        <path d={`M${x} ${ya} l${-a / 2.5} ${a} h${(2 * a) / 2.5} z M${x} ${yb} l${-a / 2.5} ${-a} h${(2 * a) / 2.5} z`} className="dw-arrow" />
      </g>,
    );
    // повёрнутый текст растёт от базовой линии влево: слева — сразу у линии, справа — с отступом на высоту букв
    text(side < 0 ? x - 1.2 * u : x + 1.2 * u + 0.72 * fs, (ya + yb) / 2, fmt(value), -90);
  };
  const axis = (x1: number, y1: number, x2: number, y2: number) =>
    parts.push(<line key={k()} x1={x1} y1={y1} x2={x2} y2={y2} className="dw-axis" strokeWidth={0.2 * u} strokeDasharray={`${3 * u} ${1 * u} ${0.6 * u} ${1 * u}`} />);

  const cx = x0 + L / 2;
  // ——— вид сверху: C0 вправо, C90 вверх
  const cyP = yPlan + W / 2;
  shape(body.circle, cx, cyP, L, W, 'body');
  if (lum) shape(lum.circle, cx, cyP, vis(lum.L), vis(lum.W), 'hidden');
  axis(x0 - 3 * u, cyP, x0 + L + 3 * u, cyP);
  axis(cx, yPlan - 3 * u, cx, yPlan + W + 3 * u);
  if (!body.circle) vdim(yPlan, yPlan + W, x0 - m * 0.55, body.W, m * 0.55 - 1 * u, -1);
  if (lum && !lum.circle && Math.abs(lum.W - body.W) > 1e-6) vdim(cyP - vis(lum.W) / 2, cyP + vis(lum.W) / 2, x0 + L + m * 0.55, lum.W, m * 0.55 + (L - vis(lum.L)) / 2 - 1 * u, 1);

  // ——— вид сбоку (со стороны C270): светящая часть — снизу, полоса высотой h(C270)
  const yb = ySide + H;
  parts.push(<rect key={k()} x={x0} y={ySide} width={L} height={H} className="dw-body" strokeWidth={sw} />);
  if (lum) {
    const lw = vis(lum.L);
    const hh = heights ? heights[3] : 0;
    if (hh > 0) parts.push(<rect key={k()} x={cx - lw / 2} y={yb - Math.min(H, hh * sc)} width={lw} height={Math.min(H, hh * sc)} fill={LUM_FILL} stroke={LUM_STROKE} strokeWidth={sw} />);
    parts.push(<line key={k()} x1={cx - lw / 2} y1={yb} x2={cx + lw / 2} y2={yb} stroke={LUM_STROKE} strokeWidth={1.4 * u} />);
  }
  axis(cx, ySide - 3 * u, cx, yb + 3 * u);
  hdim(x0, x0 + L, yb + m * 0.7, body.L, m * 0.7 - 1 * u);
  if (lum && lumDiff) hdim(cx - vis(lum.L) / 2, cx + vis(lum.L) / 2, yb + m * 0.7 + fs * 1.7, lum.L, m * 0.7 + fs * 1.7 - 1 * u);
  vdim(ySide, yb, x0 + L + m * 0.55, body.H, m * 0.55 - 1 * u, 1);

  return (
    <figure className="drawing">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('drawing.title')}>
        {parts}
      </svg>
    </figure>
  );
}
