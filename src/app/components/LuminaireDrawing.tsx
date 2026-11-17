import { useTranslation } from 'react-i18next';
import type { Dimensions, Photometry } from '../../core/index';

/**
 * Чертёж светильника по размерам из фотометрического файла — изометрия с размерами в мм.
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

/** L — размер вдоль X (C0–C180) = ширина модели, W — вдоль Y (C90–C270) = длина модели. */
const boxOf = (d: Dimensions): Box => ({ circle: d.shape === 'circle', L: d.shape === 'circle' ? d.length : d.width, W: d.length, H: d.height });

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

type V3 = [number, number, number];

/** Направление на наблюдателя: справа-спереди-снизу — видна нижняя грань с выходом света. */
const CAM: V3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), -1 / Math.sqrt(3)];
const RIGHT: V3 = [-1 / Math.SQRT2, 1 / Math.SQRT2, 0];
const UP: V3 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Изометрия светильника (x — C0, y — C90, z — вверх; низ корпуса z = 0) с размерами в мм.
 * Смотрим снизу: видны нижняя грань с выходом света (залит) и две боковые. Подписи постоянного размера.
 */
export function LuminaireDrawing({ photometry }: { photometry: Photometry }) {
  const { t, i18n } = useTranslation();
  const d = drawingData(photometry);
  if (!d) return <p className="muted small">{t('drawing.none')}</p>;
  const { body, lum, heights } = d;
  const fmt = (x: number) => x.toLocaleString(i18n.language, { maximumFractionDigits: 1 });

  // масштаб: проекция корпуса — около 120 единиц по большей стороне
  const raw = (q: V3): [number, number] => [dot(q, RIGHT), -dot(q, UP)];
  const ext0 = (() => {
    const R = body.L / 2;
    const pts: V3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, body.H]) pts.push([sx * R, sy * (body.W / 2), z]);
    const xs = pts.map((q) => raw(q)[0]);
    const ys = pts.map((q) => raw(q)[1]);
    return Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.3, 1e-6);
  })();
  const k = 120 / ext0;
  const minMm = 1.2 / k;
  const L = Math.max(body.L, minMm);
  const W = Math.max(body.W, minMm);
  const H = Math.max(body.H, minMm);
  const P = (q: V3): [number, number] => {
    const [x, y] = raw(q);
    return [x * k, y * k];
  };
  const pts = (qs: V3[]) => qs.map((q) => P(q).join(',')).join(' ');
  const fs = 4.6;
  const sw = 0.35;
  const parts: React.ReactNode[] = [];
  let key = 0;
  const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number) => {
    bb.x0 = Math.min(bb.x0, x);
    bb.x1 = Math.max(bb.x1, x);
    bb.y0 = Math.min(bb.y0, y);
    bb.y1 = Math.max(bb.y1, y);
  };
  const poly = (qs: V3[], cls: string, extra: Record<string, unknown> = {}) => {
    qs.forEach((q) => grow(...P(q)));
    parts.push(<polygon key={key++} points={pts(qs)} className={cls} strokeWidth={sw} strokeLinejoin="round" {...extra} />);
  };
  const lumProps = { fill: LUM_FILL, stroke: LUM_STROKE, strokeWidth: sw };

  /** Окружность (или её дуга) в горизонтальной плоскости z. */
  const ring = (R: number, z: number, n = 72, from = 0, to = 2 * Math.PI): V3[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / n;
      return [R * Math.cos(a), R * Math.sin(a), z] as V3;
    });

  if (!body.circle) {
    const x = L / 2;
    const y = W / 2;
    // видимые грани: +x (сторона C0), +y (C90), низ
    poly([[x, -y, 0], [x, y, 0], [x, y, H], [x, -y, H]], 'dw-f2');
    poly([[-x, y, 0], [x, y, 0], [x, y, H], [-x, y, H]], 'dw-f3');
    poly([[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]], 'dw-f1');
  } else {
    const R = L / 2;
    // видимая половина боковой поверхности — от −45° до 135° (нормаль смотрит на наблюдателя)
    const a0 = -Math.PI / 4;
    const a1 = (3 * Math.PI) / 4;
    const bottomArc = ring(R, 0, 48, a0, a1);
    const topArc = ring(R, H, 48, a0, a1).reverse();
    poly([...bottomArc, ...topArc], 'dw-f2');
    poly(ring(R, 0), 'dw-f1');
  }

  // выход света на нижней грани; полосы на видимых боковых гранях — по высотам LDT
  if (lum) {
    const lx = Math.min(lum.L, L) / 2;
    const ly = Math.min(lum.W, W) / 2;
    const z = -0.0001;
    if (lum.circle) poly(ring(lx, z), '', lumProps);
    else poly([[-lx, -ly, z], [lx, -ly, z], [lx, ly, z], [-lx, ly, z]], '', lumProps);
    if (!body.circle && !lum.circle && heights) {
      const h0 = Math.min(heights[0], H);
      const h90 = Math.min(heights[1], H);
      if (h0 > 0 && Math.abs(lx - L / 2) < L * 0.01) poly([[L / 2, -ly, 0], [L / 2, ly, 0], [L / 2, ly, h0], [L / 2, -ly, h0]], '', lumProps);
      if (h90 > 0 && Math.abs(ly - W / 2) < W * 0.01) poly([[-lx, W / 2, 0], [lx, W / 2, 0], [lx, W / 2, h90], [-lx, W / 2, h90]], '', lumProps);
    }
  }

  // ——— размеры: выносные линии вдоль off (3D, в мм), размерная линия, стрелки, подпись снаружи
  const OFF = 9 / k;
  const dim = (a: V3, b: V3, off: V3, value: number, base = 0) => {
    const sh = (q: V3, m: number): V3 => [q[0] + off[0] * m, q[1] + off[1] * m, q[2] + off[2] * m];
    const [ax, ay] = P(sh(a, base > 0 ? base * 0.9 : 0));
    const [bx, by] = P(sh(b, base > 0 ? base * 0.9 : 0));
    const [a1x, a1y] = P(sh(a, base + OFF));
    const [b1x, b1y] = P(sh(b, base + OFF));
    const [a2x, a2y] = P(sh(a, base + OFF * 1.2));
    const [b2x, b2y] = P(sh(b, base + OFF * 1.2));
    const [ux, uy] = [b1x - a1x, b1y - a1y];
    const len = Math.hypot(ux, uy) || 1;
    const [ex, ey] = [ux / len, uy / len];
    const ar = Math.min(1.8, len / 3);
    const head = (x: number, y: number, s: number) =>
      `M${x} ${y} L${x + s * ex * ar - ey * ar * 0.38} ${y + s * ey * ar + ex * ar * 0.38} L${x + s * ex * ar + ey * ar * 0.38} ${y + s * ey * ar - ex * ar * 0.38} Z`;
    parts.push(
      <g key={key++} className="dw-dimline" strokeWidth={0.25}>
        <line x1={ax} y1={ay} x2={a2x} y2={a2y} />
        <line x1={bx} y1={by} x2={b2x} y2={b2y} />
        <line x1={a1x} y1={a1y} x2={b1x} y2={b1y} />
        <path d={head(a1x, a1y, 1) + head(b1x, b1y, -1)} className="dw-arrow" />
      </g>,
    );
    // подпись — за размерной линией, по направлению выноса
    const [ox, oy] = [(a1x + b1x) / 2 - (ax + bx) / 2, (a1y + b1y) / 2 - (ay + by) / 2];
    const ol = Math.hypot(ox, oy) || 1;
    const s = fmt(value);
    const tw = s.length * fs * 0.56;
    const cx = (a1x + b1x) / 2 + (ox / ol) * (tw / 2 + 1.5);
    const cy = (a1y + b1y) / 2 + (oy / ol) * (fs * 0.7 + 1);
    parts.push(
      <text key={key++} x={cx} y={cy + fs * 0.35} fontSize={fs} textAnchor="middle" className="dw-dim">
        {s}
      </text>,
    );
    [P(sh(a, base + OFF * 1.2)), P(sh(b, base + OFF * 1.2))].forEach(([x, y]) => grow(x, y));
    grow(cx - tw / 2, cy - fs * 0.7);
    grow(cx + tw / 2, cy + fs * 0.7);
  };

  if (!body.circle) {
    const x = L / 2;
    const y = W / 2;
    dim([-x, -y, 0], [x, -y, 0], [0, -1, 0], body.L); // вдоль C0 — ширина модели
    dim([-x, -y, 0], [-x, y, 0], [-1, 0, 0], body.W); // вдоль C90 — длина модели
    if (body.H > 0) dim([x, -y, 0], [x, -y, H], [0, -1, 0], body.H); // высота
  } else {
    const R = L / 2;
    dim([-R, 0, 0], [R, 0, 0], [0, -1, 0], body.L, R);
    const c = Math.SQRT1_2;
    if (body.H > 0) dim([R * c, -R * c, 0], [R * c, -R * c, H], [c, -c, 0], body.H);
  }
  const pad = 2;
  const vb = `${bb.x0 - pad} ${bb.y0 - pad} ${bb.x1 - bb.x0 + 2 * pad} ${bb.y1 - bb.y0 + 2 * pad}`;
  return (
    <figure className="drawing">
      <svg viewBox={vb} role="img" aria-label={t('drawing.title')}>
        {parts}
      </svg>
    </figure>
  );
}
