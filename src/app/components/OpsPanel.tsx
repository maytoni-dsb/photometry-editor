import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fontMeasure } from '../../charts/fonts';
import { buildPolar } from '../../charts/polar';
import { renderSvg } from '../../charts/render-svg';
import { approxTextWidth } from '../../charts/scene';
import { defaultPlanes } from '../../charts/series';
import type { ChartStyle } from '../../charts/style';
import {
  applyWork,
  naturalSteps,
  OpError,
  rotatedDirection,
  sumWorks,
  summarize,
  type Work,
  type Issue,
  type Lang,
  type MirrorPlane,
  type OpSpec,
  type Photometry,
  type PhotometrySummary,
  type RotationAxis,
  type Symmetry,
} from '../../core/index';
import type { ChartSettings } from '../App';
import { liveCount, stateOf, workOf, type DocState, type LiveResult, type OpenFile } from '../doc';
import { screenFamily, type LoadedFonts } from '../fonts';
import { createCameraLink, housingBox, type View3D } from '../../charts/body3d';
import { Body3D, Fallback, HousingToggle, useHousingPref, ViewPill } from './Body3DTab';
import { NumField } from './NumField';

/** Группы панели — в порядке применения. */
export type OpKind = 'mirror' | 'rotate' | 'symmetrize' | 'smooth' | 'sum' | 'regrid';
export const OP_KINDS: OpKind[] = ['mirror', 'rotate', 'symmetrize', 'smooth', 'sum', 'regrid'];

/** Пиктограммы групп (24 × 24, линией). */
const OP_ICONS: Record<OpKind, string> = {
  mirror: 'M12 3v18M9 6 4 12l5 6zM15 6l5 6-5 6',
  rotate: 'M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4',
  symmetrize: 'M12 3v18M12 5c-4 0-7 3-7 7s3 7 7 7M12 5c4 0 7 3 7 7s-3 7-7 7',
  smooth: 'M3 15c3 0 3-6 6-6s3 6 6 6 3-6 6-6',
  regrid: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  sum: 'M12 5v14M5 12h14',
};

/** Плоскости отражения: XZ = C0–C180, YZ = C90–C270, XY = γ90 (верх / низ); ось Z — к надиру. */
const MIRRORS: MirrorPlane[] = ['c0c180', 'c90c270', 'updown'];
type SymKey = 'axial' | 'c0c180' | 'c90c270';
/** Нажатые кнопки симметрии → симметрия (XZ + YZ — четвертная; Z — осевая, только одна). */
const symOf = (on: SymKey[]): Exclude<Symmetry, 'bilateral'> | null =>
  on.includes('axial') ? 'axial' : on.length === 2 ? 'quadrant' : on.length === 1 ? on[0] : null;

/** Параметры слагаемого. */
interface SumRow {
  /** Как задан вес: коэффициентом или потоком слагаемого (лм). */
  wmode: 'k' | 'flux';
  weight: string;
  flux: string;
  rx: string;
  ry: string;
  rz: string;
}

const neutralRow = (f: { summary: PhotometrySummary }): SumRow => ({ wmode: 'flux', weight: '1', flux: String(Math.round(f.summary.flux.total * 10) / 10), rx: '0', ry: '0', rz: '0' });

/** Источник второго слагаемого, перетащенный из списка файлов. */
export const DRAG_FILE = 'application/x-pe-file';
export const DRAG_ENTRY = 'application/x-pe-entry';

interface Props {
  file: OpenFile;
  files: OpenFile[];
  settings: ChartSettings;
  style: ChartStyle;
  fonts: LoadedFonts | null;
  /** Шаги панели (сеанс sid) от состояния base (его summary) — записать в историю вместо прежних шагов сеанса. */
  onLive: (fileId: string, sid: string, base: object, steps: LiveResult[]) => void;
  /** Открыть файл с диска (байты) — он появится в списке файлов, но не станет текущим. */
  onAddFile: (name: string, bytes: Uint8Array) => OpenFile | null;
  /** Открыть файл подключённой папки по пути, не делая его текущим. */
  onOpenEntry: (path: string) => Promise<OpenFile | null>;
}

/** Число из поля ввода: запятая или точка. Пусто / мусор → NaN. */
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
const fmtNum = (lang: string, x: number, d = 1) => x.toLocaleString(lang, { maximumFractionDigits: d });
const signed = (lang: string, x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtNum(lang, Math.abs(x), 2)}°`;

/** Вес слагаемого: коэффициент или «поток слагаемого / его расчётный поток» (поворот поток не меняет). */
function sumWeight(f: { summary: PhotometrySummary }, r: SumRow): number {
  if (r.wmode === 'k') return num(r.weight);
  const own = f.summary.flux.total;
  return own > 0 ? num(r.flux) / own : NaN;
}

/** Название шага для истории (на языке интерфейса). */
export function opLabel(t: (k: string, o?: Record<string, unknown>) => string, lang: string, spec: OpSpec): string {
  switch (spec.op) {
    case 'normalize':
      return t(`ops.label.normalize_${spec.mode}`, { v: spec.value != null ? fmtNum(lang, spec.value, 3) : '' });
    case 'mirror':
      return t('ops.label.mirror', { plane: t(`ops.mirror_${spec.plane}`) });
    case 'rotate':
      return t('ops.label.rotate', { axis: spec.axis.toUpperCase(), angle: signed(lang, spec.angle) });
    case 'symmetrize':
      return t('ops.label.symmetrize', { sym: t(`ops.sym_${spec.symmetry}`) });
    case 'regrid':
      return t('ops.label.regrid', { c: fmtNum(lang, spec.cStep, 3), g: fmtNum(lang, spec.gStep, 3) });
    case 'smooth':
      return t(spec.keepFlux === false ? 'ops.label.smoothFree' : 'ops.label.smooth', { w: fmtNum(lang, spec.width, 2) });
  }
}

function errorText(t: (k: string, o?: Record<string, unknown>) => string, e: unknown): string {
  if (e instanceof OpError) return t(`ops.err.${e.code}`, e.params);
  return String((e as Error)?.message ?? e);
}

/** Название шага поворота по осям X → Y → Z. */
function rotateLabel(t: (k: string, o?: Record<string, unknown>) => string, lang: string, steps: { axis: RotationAxis; angle: number }[]): string {
  return t('ops.label.rotateMulti', { list: steps.map((r) => `${r.axis.toUpperCase()} ${signed(lang, r.angle)}`).join(', ') });
}

/** Параметры панели; по умолчанию — значения, которые ничего не меняют (от состояния base). */
interface Params {
  mirror: MirrorPlane[];
  rot: { x: string; y: string; z: string };
  sym: SymKey[];
  cStep: string;
  gStep: string;
  g0: string;
  g1: string;
  sWidth: string;
  keepFlux: boolean;
  rowA: SumRow;
  second: string | null;
  rowB: SumRow | null;
}

function neutral(base: DocState): Params {
  const st = naturalSteps(base.summary.asC);
  const v = base.summary.asC.vAngles;
  return {
    mirror: [],
    rot: { x: '0', y: '0', z: '0' },
    sym: [],
    cStep: String(st.cStep),
    gStep: String(st.gStep),
    g0: String(v[0]),
    g1: String(v[v.length - 1]),
    sWidth: '0',
    keepFlux: true,
    rowA: neutralRow(base),
    second: null,
    rowB: null,
  };
}

/** Сеанс панели: состояние, от которого считаются операции, и сколько шагов сейчас записано в историю. */
interface Session {
  sid: string;
  fileId: string;
  base: DocState;
  steps: number;
}
let sessionSeq = 0;

/**
 * Панель «Операции» в духе панели управления InDesign: все операции сразу, компактно.
 * Изменение поля — через паузу результат пишется в историю: по шагу на каждую операцию с ненейтральными
 * параметрами, в порядке панели (отражение → поворот → симметрия → сглаживание → сложение → сетка).
 * Пока поля меняются, эти шаги пересобираются от одного исходного состояния; отмена, другая правка
 * или другой файл начинают новый сеанс с полями по умолчанию.
 */
export function OpsPanel({ file, files, settings, style, fonts, onLive, onAddFile, onOpenEntry }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;

  const sessionOk = (ss: Session | null) =>
    !!ss && ss.fileId === file.id && (ss.steps ? liveCount(file, ss.sid) === ss.steps : file.summary === ss.base.summary);
  const sessionRef = useRef<Session | null>(null);
  if (!sessionOk(sessionRef.current)) sessionRef.current = { sid: `s${++sessionSeq}`, fileId: file.id, base: stateOf(file), steps: 0 };
  const session = sessionRef.current!;
  const base = session.base;
  const [prm, setPrm] = useState<Params>(() => neutral(base));
  // новый сеанс → поля к значениям по умолчанию (во время отрисовки, без лишнего кадра)
  const [prmFor, setPrmFor] = useState<Session>(session);
  if (prmFor !== session) {
    setPrmFor(session);
    setPrm(neutral(base));
  }

  const p = base.parse.photometry;
  const s = base.summary;
  const work = useMemo(() => workOf(base), [base]);
  const steps = useMemo(() => naturalSteps(s.asC), [s.asC]);
  const [rev, setRev] = useState(0);
  /** Изменение поля пользователем — после паузы результат пишется в историю. */
  const set = (patch: Partial<Params>) => {
    setPrm((x) => ({ ...x, ...patch }));
    setRev((r) => r + 1);
  };
  const [dropOver, setDropOver] = useState(false);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View3D>('iso');
  const [custom, setCustom] = useState(false);
  const [nonce, setNonce] = useState(0);
  const link = useMemo(createCameraLink, []);
  const [showHousing, setShowHousing] = useHousingPref();

  const secondFile = prm.second ? files.find((f) => f.id === prm.second) ?? null : null;

  const rotSteps = useMemo(
    () => (['x', 'y', 'z'] as const).map((a) => ({ axis: a, angle: num(prm.rot[a]) })).filter((r) => !(Number.isFinite(r.angle) && Math.abs(r.angle % 360) < 1e-9)),
    [prm.rot],
  );

  // ——— цепочка операций от base; результат — шаги истории
  const chain = useMemo((): { steps: LiveResult[]; error?: string } => {
    const out: LiveResult[] = [];
    let w = work;
    let ph = p;
    const run = (list: OpSpec[], label: string) => {
      const issues: Issue[] = [];
      for (const sp of list) {
        const r = applyWork(w, sp);
        w = r.work;
        ph = r.photometry;
        issues.push(...r.issues);
      }
      out.push({ p: ph, issues, label, spec: list.length === 1 ? list[0] : list, work: w });
    };
    const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    try {
      for (const m of MIRRORS) if (prm.mirror.includes(m)) run([{ op: 'mirror', plane: m }], opLabel(t, lang, { op: 'mirror', plane: m }));
      if (rotSteps.length) {
        const list = rotSteps.map((r) => ({ op: 'rotate' as const, axis: r.axis, angle: r.angle }));
        run(list, list.length === 1 ? opLabel(t, lang, list[0]) : rotateLabel(t, lang, rotSteps));
      }
      const sym = symOf(prm.sym);
      if (sym) run([{ op: 'symmetrize', symmetry: sym }], opLabel(t, lang, { op: 'symmetrize', symmetry: sym }));
      const sw = num(prm.sWidth);
      if (!(Number.isFinite(sw) && sw <= 0)) {
        const sp: OpSpec = { op: 'smooth', width: sw, keepFlux: prm.keepFlux };
        run([sp], opLabel(t, lang, sp));
      }
      if (secondFile && prm.rowB) {
        const r = sumWorks([
          { work: w, weight: sumWeight(base, prm.rowA), rotations: [], offset: { x: 0, y: 0, z: 0 } },
          {
            work: workOf(secondFile),
            weight: sumWeight(secondFile, prm.rowB),
            rotations: (['x', 'y', 'z'] as const).map((a) => ({ axis: a, angle: num(prm.rowB![`r${a}`]) || 0 })).filter((x) => x.angle !== 0),
            offset: { x: 0, y: 0, z: 0 },
          },
        ]);
        w = r.work;
        ph = r.photometry;
        out.push({ p: ph, issues: r.issues, label: t('ops.label.sumWith', { name: secondFile.name }), work: w });
      }
      const c = num(prm.cStep);
      const g = num(prm.gStep);
      const a = num(prm.g0);
      const b = num(prm.g1);
      const v = s.asC.vAngles;
      const keep = eq(a, v[0]) && eq(b, v[v.length - 1]);
      if (!(eq(c, steps.cStep) && eq(g, steps.gStep) && keep)) {
        const sp: OpSpec = keep ? { op: 'regrid', cStep: c, gStep: g } : { op: 'regrid', cStep: c, gStep: g, gRange: [a, b] };
        run([sp], opLabel(t, lang, sp) + (keep ? '' : `, γ ${fmtNum(lang, a)}…${fmtNum(lang, b)}°`));
      }
      return { steps: out };
    } catch (e) {
      return { steps: out, error: errorText(t, e) };
    }
  }, [prm, rotSteps, secondFile, work, p, s, steps, file.name, t, lang]);
  const last = chain.steps[chain.steps.length - 1];
  const shown = useMemo(() => (last ? { p: last.p, summary: summarize(last.p), work: last.work } : { p, summary: s, work }), [last, p, s, work]);

  // запись в историю: через паузу после последнего изменения поля
  const chainRef = useRef(chain);
  chainRef.current = chain;
  useEffect(() => {
    if (!rev) return;
    const id = window.setTimeout(() => {
      const ch = chainRef.current;
      if (ch.error) return; // ошибка в полях — история не меняется
      const ss = sessionRef.current;
      if (!ss) return;
      ss.steps = ch.steps.length;
      onLive(ss.fileId, ss.sid, ss.base.summary, ch.steps);
    }, 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const measure = useMemo(() => (fonts ? fontMeasure(fonts.set) : approxTextWidth), [fonts]);
  const planes = useMemo(() => {
    const set = new Set<number>([...defaultPlanes(p), ...defaultPlanes(shown.p)]);
    return [...set].sort((a, b) => a - b).slice(0, 6);
  }, [p, shown]);
  const chart = (ph: Photometry, sm: PhotometrySummary) =>
    renderSvg(buildPolar(ph, sm, { ...settings, planes, width: settings.width, title: '' }, style, measure), { screenFamily: screenFamily(fonts) });
  const before = useMemo(() => chart(work.dense, s), [work, s, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = useMemo(() => chart(shown.work.dense, shown.summary), [shown, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const housingBefore = useMemo(() => housingBox(p), [p]);
  const housingAfter = useMemo(() => housingBox(shown.p), [shown]);
  const scale3d = Math.max(s.peak.value, shown.summary.peak.value) || 1;

  // ——— второе слагаемое: перетаскивание из списка файлов или с диска, либо «Загрузить…»
  const takeSecond = (f: OpenFile | null) => {
    if (!f) return;
    if (f.id === file.id) {
      setDropErr(t('ops.sumSame'));
      return;
    }
    setDropErr(null);
    set({ second: f.id, rowB: neutralRow(f) });
  };
  const addFromDisk = async (list: FileList | File[]) => {
    const f = [...list].find((x) => /\.(ies|ldt)$/i.test(x.name));
    if (!f) {
      setDropErr(t('ops.sumNotPhotometry'));
      return;
    }
    takeSecond(onAddFile(f.name, new Uint8Array(await f.arrayBuffer())));
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOver(false);
    const id = e.dataTransfer.getData(DRAG_FILE);
    const path = e.dataTransfer.getData(DRAG_ENTRY);
    if (id) takeSecond(files.find((f) => f.id === id) ?? null);
    else if (path) takeSecond(await onOpenEntry(path));
    else if (e.dataTransfer.files.length) await addFromDisk(e.dataTransfer.files);
  };

  const stats = (sm: PhotometrySummary | null, ph: Photometry | null) => (
    <table className="grid small opstable">
      <thead>
        <tr>
          <th>Φ</th>
          <th>Iₘₐₓ</th>
          <th>{t('ops.down')}</th>
          <th>{t('passport.symmetry')}</th>
          <th>{t('passport.grid')}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          {sm && ph ? (
            <>
              <td>{fmtNum(lang, sm.flux.total, 0)} {t('unit.lm')}</td>
              <td>{fmtNum(lang, sm.peak.value, 0)} {t('unit.cd')} <span className="muted">C{fmtNum(lang, sm.peak.c)} γ{fmtNum(lang, sm.peak.g)}°</span></td>
              <td>{fmtNum(lang, sm.dlor, 1)} %</td>
              <td>{t(`sym.${sm.asC.symmetry}`)}</td>
              <td>{sm.asC.hAngles.length} × {sm.asC.vAngles.length}{ph.photometryType === 'B' ? ' (B→C)' : ''}</td>
            </>
          ) : (
            <td colSpan={5} className="muted">—</td>
          )}
        </tr>
      </tbody>
    </table>
  );

  const rotHint = () => {
    if (!rotSteps.length || rotSteps.some((r) => !Number.isFinite(r.angle))) return undefined;
    if (rotSteps.length === 1 && rotSteps[0].axis === 'z') return t('ops.hintZ', { c: fmtNum(lang, ((rotSteps[0].angle % 360) + 360) % 360) });
    const d = rotatedDirection(rotSteps);
    return t('ops.hintXY', { c: fmtNum(lang, d.c), g: fmtNum(lang, d.g) });
  };

  // ——— панель — одна сетка 2 × 14: колонки общие для обеих строк, поэтому пиктограммы, поля и кнопки стоят друг под другом
  //  1 [пикт.] 2–3 [поток / отражение] │ 4 [пикт.] 5–7 [X Y Z] │ 8 [пикт.] 9–11 [три колонки] │ 12 [пикт.] 13 [поле] 14 [кнопка]
  const at = (row: number, col: number, span = 1) => ({ gridRow: row, gridColumn: span > 1 ? `${col} / span ${span}` : col });
  /** Кнопки-переключатели (повторное нажатие отжимает); каждая — над своей колонкой полей. */
  const seg = <T extends string>(row: number, col: number, list: readonly T[], isOn: (v: T) => boolean, toggle: (v: T) => void, label: (v: T) => string, title?: (v: T) => string, span = list.length) => (
    <div className="seg small cseg" style={{ ...at(row, col, span), gridTemplateColumns: `repeat(${list.length}, 1fr)` }}>
      {list.map((v) => (
        <button key={v} className={isOn(v) ? 'on' : ''} aria-pressed={isOn(v)} onClick={() => toggle(v)} title={title?.(v)}>{label(v)}</button>
      ))}
    </div>
  );
  /** Пиктограмма операции (название — во всплывающей подсказке); sep — разделитель слева. */
  const icon = (row: number, col: number, k: OpKind, opts: { title?: string; sep?: boolean; small?: boolean } = {}) => (
    <span
      className={`cicon${opts.sep ? ' sep' : ''}${opts.small ? ' small' : ''}`}
      style={at(row, col)}
      title={opts.small ? t('ops.rot') : opts.title ? `${t(`ops.kind_${k}`)} — ${opts.title}` : t(`ops.kind_${k}`)}
      aria-label={opts.small ? t('ops.rot') : t(`ops.kind_${k}`)}
      role="img"
    >
      <svg viewBox="0 0 24 24" width={opts.small ? 15 : 22} height={opts.small ? 15 : 22} aria-hidden="true">
        <path d={OP_ICONS[k]} fill="none" stroke="currentColor" strokeWidth={opts.small ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
  /** Ячейка: короткая подпись слева и поле на всю оставшуюся ширину. */
  const cell = (row: number, col: number, label: React.ReactNode, field: React.ReactNode, title?: string, cls = '') => (
    <span className={`ccell ${cls}`} style={at(row, col)} title={title}>
      {label != null && <span className="oplabel">{label}</span>}
      {field}
    </span>
  );
  const axisField = (row: number, col: number, a: 'x' | 'y' | 'z', value: string, onChange: (v: string) => void, disabled = false) =>
    cell(row, col, a.toUpperCase(), <NumField value={value} onChange={onChange} step={1} unit="°" inlineUnit width="100%" disabled={disabled} aria-label={`${t('ops.rot')} ${a.toUpperCase()}`} />);
  const v = s.asC.vAngles;
  const rowB = prm.rowB;
  const fluxTitle = (f: { summary: PhotometrySummary }, r: SumRow) => t('ops.weightKHint', { own: fmtNum(lang, f.summary.flux.total, 0), k: fmtNum(lang, sumWeight(f, r) || 0, 3) });
  const AX = ['x', 'y', 'z'] as const;

  return (
    <div className="ops-layout">
      <div className="ops-main">
        <section className={`ops-editor ctrlpanel${chain.error || dropErr ? ' bad' : ''}`} title={chain.error ?? dropErr ?? undefined}>
          <div className="cgrid">
            {/* строка 1: отражение · поворот · симметрия · сглаживание */}
            {icon(1, 1, 'mirror')}
            {seg(1, 2, MIRRORS, (m) => prm.mirror.includes(m), (m) => set({ mirror: prm.mirror.includes(m) ? prm.mirror.filter((x) => x !== m) : [...prm.mirror, m] }), (m) => t(`ops.mirrorBtn_${m}`), (m) => t(`ops.mirror_${m}`), 2)}
            {icon(1, 4, 'rotate', { sep: true, title: rotHint() })}
            {AX.map((a, i) => <Fragment key={a}>{axisField(1, 5 + i, a, prm.rot[a], (x) => set({ rot: { ...prm.rot, [a]: x } }))}</Fragment>)}
            {icon(1, 8, 'symmetrize', { sep: true })}
            {seg(
              1,
              9,
              ['axial', 'c0c180', 'c90c270'] as const,
              (m) => prm.sym.includes(m),
              (m) => set({ sym: prm.sym.includes(m) ? prm.sym.filter((x) => x !== m) : m === 'axial' ? ['axial'] : [...prm.sym.filter((x) => x !== 'axial'), m] }),
              (m) => t(`ops.symBtn_${m}`),
              (m) => t(`ops.sym_${m}`),
            )}
            {icon(1, 12, 'smooth', { sep: true })}
            {cell(1, 13, null, <NumField value={prm.sWidth} onChange={(x) => set({ sWidth: x })} min={0} max={30} step={1} unit="°" inlineUnit width="100%" aria-label={t('ops.smoothWidth')} />, t('ops.smoothWidth'))}
            <button
              className={`ctoggle${prm.keepFlux ? ' on' : ''}`}
              style={at(1, 14)}
              aria-pressed={prm.keepFlux}
              onClick={() => set({ keepFlux: !prm.keepFlux })}
              title={t('ops.keepFlux')}
              aria-label={t('ops.keepFlux')}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d={prm.keepFlux ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-2'} />
              </svg>
            </button>

            {/* строка 2: сложение (пиктограмма — место для второго файла; его поток и поворот — под полями поворота) · смена сетки */}
            <span
              className={`cicon csum${dropOver ? ' over' : ''}${secondFile ? ' full' : ''}`}
              style={at(2, 1)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropOver(true); }}
              onDragLeave={() => setDropOver(false)}
              onDrop={(e) => void onDrop(e)}
            >
              <button
                className="csumbtn"
                onClick={() => fileInput.current?.click()}
                title={secondFile ? t('ops.sumWithTitle', { name: secondFile.name }) : t('ops.sumIconTitle')}
                aria-label={secondFile ? t('ops.sumWithTitle', { name: secondFile.name }) : t('ops.sumIconTitle')}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d={OP_ICONS.sum} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {secondFile && (
                <button className="csumx" onClick={() => set({ second: null, rowB: null })} title={t('ops.sumRemove')} aria-label={t('ops.sumRemove')}>×</button>
              )}
              <input ref={fileInput} type="file" accept=".ies,.ldt,.IES,.LDT" hidden onChange={(e) => { if (e.target.files) void addFromDisk(e.target.files); e.target.value = ''; }} />
            </span>
            {cell(2, 2, null, <NumField value={prm.rowA.flux} onChange={(x) => set({ rowA: { ...prm.rowA, flux: x } })} def={Math.round(s.flux.total * 10) / 10} min={0} step={10} unit={t('unit.lm')} inlineUnit width="100%" disabled={!secondFile} aria-label={t('ops.sumFluxA')} />, secondFile ? `${t('ops.sumFluxA')} · ${fluxTitle(base, prm.rowA)}` : t('ops.sumFluxA'))}
            {cell(2, 3, null, <NumField value={rowB?.flux ?? ''} onChange={(x) => rowB && set({ rowB: { ...rowB, flux: x } })} def={secondFile ? Math.round(secondFile.summary.flux.total * 10) / 10 : 0} min={0} step={10} unit={t('unit.lm')} inlineUnit width="100%" disabled={!rowB} aria-label={t('ops.sumFluxB')} />, secondFile && rowB ? `${t('ops.sumFluxB')} · ${fluxTitle(secondFile, rowB)}` : t('ops.sumFluxB'))}
            {secondFile && rowB && (
              <>
                {icon(2, 4, 'rotate', { small: true })}
                {AX.map((a, i) => <Fragment key={a}>{axisField(2, 5 + i, a, rowB[`r${a}`], (x) => set({ rowB: { ...rowB, [`r${a}`]: x } }))}</Fragment>)}
              </>
            )}
            {icon(2, 8, 'regrid', { sep: true })}
            {cell(2, 9, 'ΔC', <NumField value={prm.cStep} onChange={(x) => set({ cStep: x })} def={steps.cStep} min={0} step={2.5} unit="°" inlineUnit disabled={s.asC.symmetry === 'axial'} width="100%" aria-label={t('ops.cStep')} />)}
            {cell(2, 10, 'Δγ', <NumField value={prm.gStep} onChange={(x) => set({ gStep: x })} def={steps.gStep} min={0} step={0.5} unit="°" inlineUnit width="100%" aria-label={t('ops.gStep')} />)}
            {cell(2, 11, 'γ', <NumField value={prm.g0} onChange={(x) => set({ g0: x })} def={v[0]} min={0} max={180} step={5} unit="°" inlineUnit width="100%" aria-label={t('ops.gFrom')} />, t('ops.gFrom'))}
            <span className="cdash" style={at(2, 12)}>–</span>
            {cell(2, 13, null, <NumField value={prm.g1} onChange={(x) => set({ g1: x })} def={v[v.length - 1]} min={0} max={180} step={5} unit="°" inlineUnit width="100%" aria-label={t('ops.gTo')} />, t('ops.gTo'))}
          </div>
        </section>

        <div className="ops-stage">
          <div className="ops-pair">
            {([['before', before, work.dense, housingBefore, s, p], ['after', after, shown.work.dense, housingAfter, shown.summary, shown.p]] as const).map(([k, svg, dense, housing, sm, ph]) => (
              <figure key={k}>
                <figcaption>{t(`ops.${k}`)}</figcaption>
                <div className="paper b3d-wrap ops-3d">
                  <ViewPill view={view} custom={custom} onView={(v) => { setView(v); setCustom(false); setNonce(nonce + 1); }} />
                  <HousingToggle on={showHousing} available={!!housing} onToggle={setShowHousing} />
                  <Suspense fallback={<Fallback height={400} />}>
                    <Body3D photometry={dense} scale={scale3d} planes={planes} housing={showHousing ? housing : null} view={view} viewNonce={nonce} link={link} height={400} onUserMove={() => setCustom(true)} />
                  </Suspense>
                </div>
                <div className="paper ops-polar" dangerouslySetInnerHTML={{ __html: svg }} />
                {stats(sm, ph)}
              </figure>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
