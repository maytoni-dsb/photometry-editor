import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fontMeasure } from '../../charts/fonts';
import { buildPolar } from '../../charts/polar';
import { renderSvg } from '../../charts/render-svg';
import { approxTextWidth } from '../../charts/scene';
import { defaultPlanes } from '../../charts/series';
import type { ChartStyle } from '../../charts/style';
import {
  applyWork,
  formatIssue,
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
import { baseName, stateOf, workOf, type DocState, type LiveResult, type OpenFile } from '../doc';
import { screenFamily, type LoadedFonts } from '../fonts';
import { createCameraLink, housingBox, type View3D } from '../../charts/body3d';
import { Body3D, Fallback, HousingToggle, useHousingPref, ViewPill } from './Body3DTab';
import { NumField } from './NumField';

export type OpKind = 'mirror' | 'rotate' | 'symmetrize' | 'smooth' | 'regrid' | 'sum';
export const OP_KINDS: OpKind[] = ['mirror', 'rotate', 'symmetrize', 'smooth', 'regrid', 'sum'];

/** Пиктограммы режимов (24 × 24, линией). */
const OP_ICONS: Record<OpKind, string> = {
  mirror: 'M12 3v18M9 6 4 12l5 6zM15 6l5 6-5 6',
  rotate: 'M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4',
  symmetrize: 'M12 3v18M12 5c-4 0-7 3-7 7s3 7 7 7M12 5c4 0 7 3 7 7s-3 7-7 7',
  smooth: 'M3 15c3 0 3-6 6-6s3 6 6 6 3-6 6-6',
  regrid: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  sum: 'M12 5v14M5 12h14',
};

type SymKey = 'axial' | 'c0c180' | 'c90c270';
/** Нажатые кнопки симметрии → симметрия (обе плоскости — четвертная). */
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
  ox: string;
  oy: string;
  oz: string;
}

const neutralRow = (f: OpenFile): SumRow => ({ wmode: 'flux', weight: '1', flux: String(Math.round(f.summary.flux.total * 10) / 10), rx: '0', ry: '0', rz: '0', ox: '0', oy: '0', oz: '0' });

/** Источник второго слагаемого, перетащенный из списка файлов. */
export const DRAG_FILE = 'application/x-pe-file';
export const DRAG_ENTRY = 'application/x-pe-entry';

interface Props {
  file: OpenFile;
  files: OpenFile[];
  op: OpKind;
  onOp: (op: OpKind) => void;
  settings: ChartSettings;
  style: ChartStyle;
  fonts: LoadedFonts | null;
  /** «Живое» применение: шаг от состояния base (его summary) — новый или заменяющий прежний результат; null — вернуть base. */
  onLive: (fileId: string, base: object, r: LiveResult | null) => void;
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
function sumWeight(f: OpenFile, r: SumRow): number {
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

/** Параметры операций; по умолчанию — значения, которые ничего не меняют (от состояния base). */
interface Params {
  plane: MirrorPlane | null;
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

function neutral(base: DocState, name: string): Params {
  const st = naturalSteps(base.summary.asC);
  const v = base.summary.asC.vAngles;
  const f = { name, summary: base.summary } as OpenFile;
  return {
    plane: null,
    rot: { x: '0', y: '0', z: '0' },
    sym: [],
    cStep: String(st.cStep),
    gStep: String(st.gStep),
    g0: String(v[0]),
    g1: String(v[v.length - 1]),
    sWidth: '0',
    keepFlux: true,
    rowA: neutralRow(f),
    second: null,
    rowB: null,
  };
}

/** Сеанс операции: состояние, от которого считается результат, и параметры. */
interface Session {
  fileId: string;
  op: OpKind;
  base: DocState;
  /** Результат сеанса сейчас записан в историю (текущее состояние файла — он). */
  applied: boolean;
}

export function OpsPanel({ file, files, op, onOp, settings, style, fonts, onLive, onAddFile, onOpenEntry }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;

  // ——— сеанс: пока поля меняются, шаг истории заменяется на месте; другой режим, файл, отмена — новый сеанс
  const sessionOk = (ss: Session | null) =>
    !!ss &&
    ss.fileId === file.id &&
    ss.op === op &&
    (ss.applied ? file.past.length > 0 && file.past[file.past.length - 1].summary === ss.base.summary && file.summary !== ss.base.summary : file.summary === ss.base.summary);
  const sessionRef = useRef<Session | null>(null);
  const [prm, setPrm] = useState<Params>(() => neutral(stateOf(file), file.name));
  if (!sessionOk(sessionRef.current)) {
    sessionRef.current = { fileId: file.id, op, base: stateOf(file), applied: false };
  }
  const session = sessionRef.current!;
  const base = session.base;
  // новый сеанс → поля к значениям по умолчанию (во время отрисовки, без лишнего кадра)
  const [prmFor, setPrmFor] = useState<Session>(session);
  if (prmFor !== session) {
    setPrmFor(session);
    setPrm(neutral(base, file.name));
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
  const rowA = prm.rowA;
  const rowB = prm.rowB;

  const rotSteps = useMemo(
    () => (['x', 'y', 'z'] as const).map((a) => ({ axis: a, angle: num(prm.rot[a]) })).filter((r) => !(Number.isFinite(r.angle) && Math.abs(r.angle % 360) < 1e-9)),
    [prm.rot],
  );

  /** Операция с текущими параметрами; null — параметры ничего не меняют (или не заданы). */
  const spec: OpSpec | OpSpec[] | null = useMemo(() => {
    const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    switch (op) {
      case 'mirror':
        return prm.plane ? { op: 'mirror', plane: prm.plane } : null;
      case 'rotate':
        return rotSteps.length ? rotSteps.map((r) => ({ op: 'rotate' as const, axis: r.axis, angle: r.angle })) : null;
      case 'symmetrize': {
        const sym = symOf(prm.sym);
        return sym ? { op: 'symmetrize', symmetry: sym } : null;
      }
      case 'smooth': {
        const w = num(prm.sWidth);
        return Number.isFinite(w) && w <= 0 ? null : { op: 'smooth', width: w, keepFlux: prm.keepFlux };
      }
      case 'regrid': {
        const c = num(prm.cStep);
        const g = num(prm.gStep);
        const a = num(prm.g0);
        const b = num(prm.g1);
        const v = s.asC.vAngles;
        const keep = eq(a, v[0]) && eq(b, v[v.length - 1]);
        if (eq(c, steps.cStep) && eq(g, steps.gStep) && keep) return null;
        return keep ? { op: 'regrid', cStep: c, gStep: g } : { op: 'regrid', cStep: c, gStep: g, gRange: [a, b] };
      }
      default:
        return null;
    }
  }, [op, prm, rotSteps, steps, s]);

  const comp = (f: OpenFile | DocState, name: string, r: SumRow) => ({
    name: baseName(name),
    work: workOf(f),
    weight: sumWeight(f as OpenFile, r),
    rotations: (['x', 'y', 'z'] as const).map((a) => ({ axis: a, angle: num(r[`r${a}`]) || 0 })).filter((x) => x.angle !== 0),
    offset: { x: 0, y: 0, z: 0 },
  });
  const sumComps = useMemo(() => {
    if (op !== 'sum') return [];
    const list = [comp(base, file.name, rowA)];
    if (secondFile && rowB) list.push(comp(secondFile, secondFile.name, rowB));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, base, rowA, secondFile, rowB]);

  // результат: операция над рабочим телом (интерполянтом) состояния base
  const preview = useMemo((): (LiveResult & { summary: PhotometrySummary }) | { error: string } | null => {
    try {
      if (op === 'sum') {
        if (sumComps.length < 2) return null;
        const r = sumWorks(sumComps);
        return { p: r.photometry, summary: summarize(r.photometry), issues: r.issues, work: r.work, label: t('ops.label.sumWith', { name: secondFile?.name ?? '' }) };
      }
      if (!spec) return null;
      const list = Array.isArray(spec) ? spec : [spec];
      let w = work;
      let ph = p;
      const issues: Issue[] = [];
      for (const sp of list) {
        const r = applyWork(w, sp);
        w = r.work;
        ph = r.photometry;
        issues.push(...r.issues);
      }
      const label = Array.isArray(spec) ? (spec.length === 1 ? opLabel(t, lang, spec[0]) : rotateLabel(t, lang, rotSteps)) : opLabel(t, lang, spec);
      return { p: ph, summary: summarize(ph), issues, work: w, label, spec: Array.isArray(spec) && spec.length === 1 ? spec[0] : spec };
    } catch (e) {
      return { error: errorText(t, e) };
    }
  }, [op, spec, sumComps, work, p, t, lang, rotSteps, secondFile]);
  const ok = preview && !('error' in preview) ? preview : null;
  // пока параметры ничего не меняют — «после» = «до»
  const shown = ok ?? (preview ? null : { p, summary: s, issues: [] as Issue[], work });

  // запись в историю: через паузу после последнего изменения поля
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(() => {
    if (!rev) return;
    const id = window.setTimeout(() => {
      const pr = previewRef.current;
      if (pr && 'error' in pr) return; // ошибка в полях — история не меняется
      const ss = sessionRef.current;
      if (!ss) return;
      ss.applied = !!pr;
      onLive(ss.fileId, ss.base.summary, pr ? { p: pr.p, issues: pr.issues, label: pr.label, spec: pr.spec, work: pr.work } : null);
    }, 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const measure = useMemo(() => (fonts ? fontMeasure(fonts.set) : approxTextWidth), [fonts]);
  const planes = useMemo(() => {
    const set = new Set<number>([...defaultPlanes(p), ...(shown ? defaultPlanes(shown.p) : [])]);
    return [...set].sort((a, b) => a - b).slice(0, 6);
  }, [p, shown]);
  const chart = (ph: Photometry, sm: PhotometrySummary) =>
    renderSvg(buildPolar(ph, sm, { ...settings, planes, width: settings.width, title: '' }, style, measure), { screenFamily: screenFamily(fonts) });
  const before = useMemo(() => chart(work.dense, s), [work, s, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = useMemo(() => (shown ? chart(shown.work.dense, shown.summary) : null), [shown, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const housingBefore = useMemo(() => housingBox(p), [p]);
  const housingAfter = useMemo(() => (shown ? housingBox(shown.p) : null), [shown]);
  const scale3d = Math.max(s.peak.value, shown?.summary.peak.value ?? 0) || 1;

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
    if (!rotSteps.length || rotSteps.some((r) => !Number.isFinite(r.angle))) return null;
    if (rotSteps.length === 1 && rotSteps[0].axis === 'z') return t('ops.hintZ', { c: fmtNum(lang, ((rotSteps[0].angle % 360) + 360) % 360) });
    const d = rotatedDirection(rotSteps);
    return t('ops.hintXY', { c: fmtNum(lang, d.c), g: fmtNum(lang, d.g) });
  };

  /** Кнопки-переключатели; повторное нажатие отжимает кнопку. */
  const seg = <T extends string>(list: readonly T[], isOn: (v: T) => boolean, toggle: (v: T) => void, label: (v: T) => string) => (
    <div className="seg">
      {list.map((v) => (
        <button key={v} className={isOn(v) ? 'on' : ''} aria-pressed={isOn(v)} onClick={() => toggle(v)}>{label(v)}</button>
      ))}
    </div>
  );

  /** Поля слагаемого в одну строку: поток (он и задаёт вес) и поворот X / Y / Z. */
  const sumFields = (f: OpenFile | DocState, r: SumRow, setRow: (r: SumRow) => void) => (
    <>
      <span className="oplabel">{t('ops.sumFlux')}</span>
      <NumField
        value={r.flux}
        onChange={(v) => setRow({ ...r, flux: v, wmode: 'flux' })}
        def={Math.round(f.summary.flux.total * 10) / 10}
        min={0}
        step={10}
        unit={t('unit.lm')}
        width={96}
        aria-label={t('ops.sumFlux')}
        title={t('ops.weightKHint', { own: fmtNum(lang, f.summary.flux.total, 0), k: fmtNum(lang, sumWeight(f as OpenFile, { ...r, wmode: 'flux' }) || 0, 3) })}
      />
      <span className="opicon" title={t('ops.rot')} aria-label={t('ops.rot')}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d={OP_ICONS.rotate} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {(['rx', 'ry', 'rz'] as const).map((k) => (
        <span key={k} className="axisfield">
          <span className="oplabel">{k[1].toUpperCase()}</span>
          <NumField value={r[k]} onChange={(v) => setRow({ ...r, [k]: v })} step={1} unit="°" width={58} aria-label={`${t('ops.rot')} ${k[1].toUpperCase()}`} />
        </span>
      ))}
    </>
  );

  const v = s.asC.vAngles;
  let fields: React.ReactNode = null;
  switch (op) {
    case 'mirror':
      fields = seg(['c0c180', 'c90c270', 'updown'] as const, (m) => prm.plane === m, (m) => set({ plane: prm.plane === m ? null : m }), (m) => t(`ops.mirrorBtn_${m}`));
      break;
    case 'rotate':
      fields = (
        <>
          <span className="opicon" title={t('ops.rot')}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d={OP_ICONS.rotate} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {(['x', 'y', 'z'] as const).map((a) => (
            <span key={a} className="axisfield" title={t(`ops.axisNote_${a}`)}>
              <span className="oplabel">{a.toUpperCase()}</span>
              <NumField value={prm.rot[a]} onChange={(x) => set({ rot: { ...prm.rot, [a]: x } })} step={1} unit="°" width={84} aria-label={`${t('ops.rot')} ${a.toUpperCase()}`} />
            </span>
          ))}
          <span className="muted small">{rotHint()}</span>
        </>
      );
      break;
    case 'symmetrize':
      fields = seg(
        ['axial', 'c0c180', 'c90c270'] as const,
        (m) => prm.sym.includes(m),
        (m) => set({ sym: prm.sym.includes(m) ? prm.sym.filter((x) => x !== m) : m === 'axial' ? ['axial'] : [...prm.sym.filter((x) => x !== 'axial'), m] }),
        (m) => t(`ops.symBtn_${m}`),
      );
      break;
    case 'smooth':
      fields = (
        <>
          <span className="oplabel">{t('ops.smoothWidth')}</span>
          <NumField value={prm.sWidth} onChange={(x) => set({ sWidth: x })} min={0} max={30} step={1} unit="°" width={88} aria-label={t('ops.smoothWidth')} />
          <label className="check"><input type="checkbox" checked={prm.keepFlux} onChange={(e) => set({ keepFlux: e.target.checked })} />{t('ops.keepFlux')}</label>
        </>
      );
      break;
    case 'regrid':
      fields = (
        <>
          <span className="oplabel">ΔC</span>
          <NumField value={prm.cStep} onChange={(x) => set({ cStep: x })} def={steps.cStep} min={0} step={2.5} unit="°" disabled={s.asC.symmetry === 'axial'} width={80} aria-label={t('ops.cStep')} />
          <span className="oplabel">Δγ</span>
          <NumField value={prm.gStep} onChange={(x) => set({ gStep: x })} def={steps.gStep} min={0} step={0.5} unit="°" width={80} aria-label={t('ops.gStep')} />
          <span className="oplabel">γ</span>
          <NumField value={prm.g0} onChange={(x) => set({ g0: x })} def={v[0]} min={0} max={180} step={5} unit="°" width={80} aria-label={t('ops.gFrom')} />
          <span className="oplabel">…</span>
          <NumField value={prm.g1} onChange={(x) => set({ g1: x })} def={v[v.length - 1]} min={0} max={180} step={5} unit="°" width={80} aria-label={t('ops.gTo')} />
        </>
      );
      break;
  }

  return (
    <div className="ops-layout">
      <div className="ops-main">
        <section className="ops-editor">
          <div className="opbar">
            <div className="opmodes" role="tablist" aria-label={t('ops.title')}>
              {OP_KINDS.map((k) => (
                <button key={k} role="tab" aria-selected={op === k} className={op === k ? 'opmode on' : 'opmode'} onClick={() => onOp(k)} title={t(`ops.kind_${k}`)} aria-label={t(`ops.kind_${k}`)}>
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path d={OP_ICONS[k]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ))}
            </div>
            <div className="opright">
              {op !== 'sum' && <div className="opline">{fields}</div>}
          {op === 'sum' && (
            <div className="sumslots">
              <div className="sumslot">
                <span className="slotname" title={file.name}><span className="slotno">1</span><span className="nm">{file.name}</span></span>
                {sumFields(base, rowA, (r) => set({ rowA: r }))}
                <span className="close-ph" />
              </div>
              <div
                className={`sumslot drop${dropOver ? ' over' : ''}${secondFile ? '' : ' empty'}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropOver(true); }}
                onDragLeave={() => setDropOver(false)}
                onDrop={(e) => void onDrop(e)}
              >
                {secondFile && rowB ? (
                  <>
                    <span className="slotname" title={secondFile.name}>
                      <span className="slotno">2</span><span className="nm">{secondFile.name}</span>
                    </span>
                    {sumFields(secondFile, rowB, (r) => set({ rowB: r }))}
                    <button className="close vis" aria-label={t('files.close')} onClick={() => set({ second: null, rowB: null })}>×</button>
                  </>
                ) : (
                  <>
                    <span className="slotno">2</span>
                    <span className="muted">{t('ops.sumDrop')}</span>
                    <button className="btn small" onClick={() => fileInput.current?.click()}>{t('ops.sumLoad')}</button>
                  </>
                )}
                <input ref={fileInput} type="file" accept=".ies,.ldt,.IES,.LDT" hidden onChange={(e) => { if (e.target.files) void addFromDisk(e.target.files); e.target.value = ''; }} />
              </div>
              {dropErr && <p className="error small">{dropErr}</p>}
            </div>
          )}
            </div>
          </div>
          {preview && 'error' in preview && <p className="error small opnote">{preview.error}</p>}
          {ok && op !== 'sum' && ok.issues.length > 0 && <p className="muted small opnote">{ok.issues.map((i) => formatIssue(i, lang)).join(' · ')}</p>}
        </section>

        <div className="ops-stage">
          <div className="ops-pair">
            {([['before', before, work.dense, housingBefore, s, p], ['after', after, shown?.work.dense ?? null, housingAfter, shown?.summary ?? null, shown?.p ?? null]] as const).map(([k, svg, dense, housing, sm, ph]) => (
              <figure key={k}>
                <figcaption>{t(`ops.${k}`)}</figcaption>
                {svg && dense ? (
                  <>
                    <div className="paper b3d-wrap ops-3d">
                      <ViewPill view={view} custom={custom} onView={(v) => { setView(v); setCustom(false); setNonce(nonce + 1); }} />
                      <HousingToggle on={showHousing} available={!!housing} onToggle={setShowHousing} />
                      <Suspense fallback={<Fallback height={400} />}>
                        <Body3D photometry={dense} scale={scale3d} planes={planes} housing={showHousing ? housing : null} view={view} viewNonce={nonce} link={link} height={400} onUserMove={() => setCustom(true)} />
                      </Suspense>
                    </div>
                    <div className="paper ops-polar" dangerouslySetInnerHTML={{ __html: svg }} />
                  </>
                ) : (
                  <div className="paper empty-preview">{preview && 'error' in preview ? preview.error : '—'}</div>
                )}
                {stats(sm, ph)}
              </figure>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
