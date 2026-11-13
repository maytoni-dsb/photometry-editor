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

export function LuminaireDrawing({ photometry }: { photometry: Photometry }) {
  const { t, i18n } = useTranslation();
  const d = drawingData(photometry);
  if (!d) return <p className="muted small">{t('drawing.none')}</p>;
  const { body, lum, heights } = d;
  const fmt = (x: number) => x.toLocaleString(i18n.language, { maximumFractionDigits: 1 });

  // масштаб: виды занимают около 150 × 110 единиц, подписи — постоянного размера (u = 1),
  // поэтому и длинный линейный светильник, и маленький спот читаются одинаково
  const u = 1;
  const sc = Math.min(150 / Math.max(body.L + body.W, 1), 105 / Math.max(body.W + body.H, 1));
  const fs = 4.2 * u;
  const gap = 16 * u;
  // нулевая высота / ширина рисуется тонкой пластиной, но размер подписывается как есть
  const vis = (x: number) => Math.max(x * sc, 1.2 * u);
  const L = vis(body.L);
  const W = vis(body.W);
  const H = vis(body.H);

  // раскладка: слева сверху — вид снизу (L × W), под ним — со стороны C270 (L × H), справа — со стороны C0 (W × H)
  const m = 12 * u; // поле под размеры
  const x0 = m + 4 * u;
  const yPlan = 7 * u + fs;
  const yFront = yPlan + W + gap + fs;
  const xSide = x0 + L + gap + 4 * u;
  // подпись вида справа может быть шире самого вида
  const width = Math.max(xSide + W + m + 2 * u, xSide + 0.56 * fs * t('drawing.fromC0').length + 2 * u);
  const height = yFront + H + m + fs;

  const parts: React.ReactNode[] = [];
  let key = 0;
  const k = () => key++;
  const sw = 0.35 * u;

  const rect = (x: number, y: number, w: number, h: number, kind: 'body' | 'lum') =>
    parts.push(<rect key={k()} x={x} y={y} width={w} height={h} className={kind === 'body' ? 'dw-body' : undefined} fill={kind === 'lum' ? LUM_FILL : undefined} stroke={kind === 'lum' ? LUM_STROKE : undefined} strokeWidth={sw} />);
  const circle = (cx: number, cy: number, r: number, kind: 'body' | 'lum') =>
    parts.push(<circle key={k()} cx={cx} cy={cy} r={r} className={kind === 'body' ? 'dw-body' : undefined} fill={kind === 'lum' ? LUM_FILL : undefined} stroke={kind === 'lum' ? LUM_STROKE : undefined} strokeWidth={sw} />);
  const text = (x: number, y: number, s: string, anchor: 'start' | 'middle' | 'end' = 'middle', rot = 0, cls = 'dw-dim') =>
    parts.push(
      <text key={k()} x={x} y={y} fontSize={fs} textAnchor={anchor} className={cls} transform={rot ? `rotate(${rot} ${x} ${y})` : undefined}>
        {s}
      </text>,
    );
  /** Горизонтальный размер под / над объектом. */
  const hdim = (xa: number, xb: number, y: number, value: number, ext: number) => {
    const a = 1.6 * u;
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
  /** Вертикальный размер справа от объекта. */
  const vdim = (ya: number, yb: number, x: number, value: number, ext: number) => {
    const a = 1.6 * u;
    parts.push(
      <g key={k()} className="dw-dimline" strokeWidth={0.25 * u}>
        <line x1={x - ext} y1={ya} x2={x + a} y2={ya} />
        <line x1={x - ext} y1={yb} x2={x + a} y2={yb} />
        <line x1={x} y1={ya} x2={x} y2={yb} />
        <path d={`M${x} ${ya} l${-a / 2.5} ${a} h${(2 * a) / 2.5} z M${x} ${yb} l${-a / 2.5} ${-a} h${(2 * a) / 2.5} z`} className="dw-arrow" />
      </g>,
    );
    text(x + 1.4 * u, (ya + yb) / 2, fmt(value), 'middle', -90);
  };
  /** Вертикальный размер слева от объекта. */
  const vdimLeft = (ya: number, yb: number, x: number, value: number, ext: number) => {
    const a = 1.6 * u;
    parts.push(
      <g key={k()} className="dw-dimline" strokeWidth={0.25 * u}>
        <line x1={x - a} y1={ya} x2={x + ext} y2={ya} />
        <line x1={x - a} y1={yb} x2={x + ext} y2={yb} />
        <line x1={x} y1={ya} x2={x} y2={yb} />
        <path d={`M${x} ${ya} l${-a / 2.5} ${a} h${(2 * a) / 2.5} z M${x} ${yb} l${-a / 2.5} ${-a} h${(2 * a) / 2.5} z`} className="dw-arrow" />
      </g>,
    );
    text(x - 1.4 * u, (ya + yb) / 2, fmt(value), 'middle', -90);
  };
  const title = (x: number, y: number, s: string) => text(x, y, s, 'start', 0, 'dw-title');
  const axis = (x1: number, y1: number, x2: number, y2: number) =>
    parts.push(<line key={k()} x1={x1} y1={y1} x2={x2} y2={y2} className="dw-axis" strokeWidth={0.2 * u} strokeDasharray={`${3 * u} ${1 * u} ${0.6 * u} ${1 * u}`} />);

  // ——— вид снизу: C0 вправо, C90 вниз (смотрим снизу вверх)
  const cxP = x0 + L / 2;
  const cyP = yPlan + W / 2;
  title(x0, yPlan - 2.2 * u - fs * 0.2, t('drawing.below'));
  if (body.circle) circle(cxP, cyP, L / 2, 'body');
  else rect(x0, yPlan, L, W, 'body');
  if (lum) {
    if (lum.circle) circle(cxP, cyP, vis(lum.L) / 2, 'lum');
    else rect(cxP - vis(lum.L) / 2, cyP - vis(lum.W) / 2, vis(lum.L), vis(lum.W), 'lum');
  }
  axis(x0 - 3 * u, cyP, x0 + L + 3 * u, cyP);
  axis(cxP, yPlan - 3 * u, cxP, yPlan + W + 3 * u);
  text(x0 + L + 4 * u, cyP + fs * 0.35, 'C0', 'start', 0, 'dw-c');
  text(cxP, yPlan + W + 4 * u + fs * 0.7, 'C90', 'middle', 0, 'dw-c');
  vdimLeft(yPlan, yPlan + W, x0 - m * 0.55, body.W, m * 0.55 - 1 * u);

  // ——— со стороны C270: длина × высота, светящая часть — снизу, полоса высотой h(C270)
  const yb = yFront + H; // нижняя грань
  title(x0, yFront - 2.2 * u - fs * 0.2, t('drawing.fromC270'));
  rect(x0, yFront, L, H, 'body');
  if (lum) {
    const lw = vis(lum.L);
    const hh = heights ? heights[3] : 0;
    if (hh > 0) rect(cxP - lw / 2, yb - Math.min(H, hh * sc), lw, Math.min(H, hh * sc), 'lum');
    parts.push(<line key={k()} x1={cxP - lw / 2} y1={yb} x2={cxP + lw / 2} y2={yb} stroke={LUM_STROKE} strokeWidth={1.4 * u} />);
  }
  axis(cxP, yFront - 3 * u, cxP, yb + 3 * u);
  hdim(x0, x0 + L, yb + m * 0.7, body.L, m * 0.7 - 1 * u);
  if (lum && Math.abs(lum.L - body.L) > 1e-6) hdim(cxP - vis(lum.L) / 2, cxP + vis(lum.L) / 2, yb + m * 0.7 + fs * 1.6, lum.L, m * 0.7 + fs * 1.6 - 1 * u);

  // ——— со стороны C0: ширина × высота (C90 вправо), полоса высотой h(C0)
  const cxS = xSide + W / 2;
  title(xSide, yFront - 2.2 * u - fs * 0.2, t('drawing.fromC0'));
  rect(xSide, yFront, W, H, 'body');
  if (lum) {
    const lw = vis(lum.W);
    const hh = heights ? heights[0] : 0;
    if (hh > 0) rect(cxS - lw / 2, yb - Math.min(H, hh * sc), lw, Math.min(H, hh * sc), 'lum');
    parts.push(<line key={k()} x1={cxS - lw / 2} y1={yb} x2={cxS + lw / 2} y2={yb} stroke={LUM_STROKE} strokeWidth={1.4 * u} />);
  }
  axis(cxS, yFront - 3 * u, cxS, yb + 3 * u);
  vdim(yFront, yb, xSide + W + m * 0.6, body.H, m * 0.6 - 1 * u);
  hdim(xSide, xSide + W, yb + m * 0.7, body.W, m * 0.7 - 1 * u);

  return (
    <figure className="drawing">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('drawing.title')}>
        {parts}
      </svg>
      <figcaption className="muted small">
        {lum ? (
          <>
            <span className="dw-swatch" style={{ background: LUM_FILL, borderColor: LUM_STROKE }} /> {t('drawing.luminous', { l: fmt(lum.L), w: fmt(lum.W) })}
            {heights && ` · ${t('drawing.heights', { h: heights.map(fmt).join(' / ') })}`}
          </>
        ) : (
          t(photometry.source.format === 'IES' ? 'drawing.iesNote' : 'drawing.noLuminous')
        )}
      </figcaption>
    </figure>
  );
}
