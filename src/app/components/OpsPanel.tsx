import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select';
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
  type GammaRange,
  type Issue,
  type Lang,
  type MirrorPlane,
  type NormalizeMode,
  type OpSpec,
  type Photometry,
  type PhotometrySummary,
  type RotationAxis,
  type Symmetry,
} from '../../core/index';
import type { ChartSettings } from '../App';
import { baseName, workOf, type OpenFile } from '../doc';
import { screenFamily, type LoadedFonts } from '../fonts';
import { createCameraLink, housingBox, type View3D } from '../../charts/body3d';
import { Body3D, Fallback, HousingToggle, useHousingPref, ViewPill } from './Body3DTab';
import { HistoryPanel } from './HistoryPanel';
import { NumField } from './NumField';

export type OpKind = 'normalize' | 'mirror' | 'rotate' | 'symmetrize' | 'smooth' | 'regrid' | 'sum';
export const OP_KINDS: OpKind[] = ['normalize', 'mirror', 'rotate', 'symmetrize', 'smooth', 'regrid', 'sum'];

type SymTarget = Exclude<Symmetry, 'bilateral'>;

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

const neutralRow = (f: OpenFile): SumRow => ({ wmode: 'k', weight: '1', flux: String(Math.round(f.summary.flux.total * 10) / 10), rx: '0', ry: '0', rz: '0', ox: '0', oy: '0', oz: '0' });

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
  onApply: (p: Photometry, issues: Issue[], label: string, spec: OpSpec, work: Work) => void;
  onCreate: (name: string, p: Photometry, issues: Issue[], label: string, work: Work) => void;
  onJump: (index: number) => void;
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

export function OpsPanel({ file, files, op, onOp, settings, style, fonts, onApply, onCreate, onJump, onAddFile, onOpenEntry }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const p = file.parse.photometry;
  const s = file.summary;
  const work = useMemo(() => workOf(file), [file]);
  const steps = useMemo(() => naturalSteps(s.asC), [s.asC]);
  const r1 = (x: number) => String(Math.round(x * 10) / 10);

  // ——— параметры операций; по умолчанию — значения, которые ничего не меняют
  const neutralValue = (m: NormalizeMode) => (m === 'flux' ? r1(s.flux.total) : m === 'peak' ? r1(s.peak.value) : '1');
  const [nMode, setNMode] = useState<NormalizeMode>('factor');
  const [nValue, setNValue] = useState('1');
  const [plane, setPlane] = useState<MirrorPlane | null>(null);
  const [axis, setAxis] = useState<RotationAxis>('z');
  const [angle, setAngle] = useState('0');
  const [symT, setSymT] = useState<SymTarget>('none');
  const [cStep, setCStep] = useState(String(steps.cStep));
  const [gStep, setGStep] = useState(String(steps.gStep));
  const [gRange, setGRange] = useState<GammaRange>('keep');
  const [sWidth, setSWidth] = useState('0');
  const [keepFlux, setKeepFlux] = useState(true);
  const [rowA, setRowA] = useState<SumRow>(() => neutralRow(file));
  const [second, setSecond] = useState<string | null>(null);
  const [rowB, setRowB] = useState<SumRow | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setNValue(neutralValue(nMode));
    setPlane(null);
    setAngle('0');
    setSymT('none');
    setCStep(String(steps.cStep));
    setGStep(String(steps.gStep));
    setGRange('keep');
    setSWidth('0');
    setKeepFlux(true);
    setRowA(neutralRow(file));
    setSecond(null);
    setRowB(null);
    setDropErr(null);
  };
  // смена режима или файла — всё к значениям по умолчанию
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => resetRef.current(), [op, file.id]);
  // после применения меняется сам файл (поток, сетка) — «нейтральные» значения пересчитываются
  useEffect(() => {
    setNValue((v) => (nMode === 'factor' ? v : neutralValue(nMode)));
    setCStep(String(steps.cStep));
    setGStep(String(steps.gStep));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const [view, setView] = useState<View3D>('iso');
  const [custom, setCustom] = useState(false);
  const [nonce, setNonce] = useState(0);
  const link = useMemo(createCameraLink, []);
  const [showHousing, setShowHousing] = useHousingPref();

  const secondFile = second ? files.find((f) => f.id === second) ?? null : null;

  /** Операция с текущими параметрами; null — параметры ничего не меняют (или не заданы). */
  const spec: OpSpec | null = useMemo(() => {
    const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    switch (op) {
      case 'normalize': {
        if (nMode === 'cdklm') return Math.abs(s.referenceFlux - 1000) < 1e-6 ? null : { op: 'normalize', mode: 'cdklm' };
        const v = num(nValue);
        if (!Number.isFinite(v)) return { op: 'normalize', mode: nMode, value: v };
        if (nMode === 'factor' ? eq(v, 1) : nMode === 'flux' ? Math.abs(v - s.flux.total) < 0.05 : Math.abs(v - s.peak.value) < 0.05) return null;
        return { op: 'normalize', mode: nMode, value: v };
      }
      case 'mirror':
        return plane ? { op: 'mirror', plane } : null;
      case 'rotate': {
        const a = num(angle);
        return Number.isFinite(a) && Math.abs(a % 360) < 1e-9 ? null : { op: 'rotate', axis, angle: a };
      }
      case 'symmetrize':
        return symT === 'none' ? null : { op: 'symmetrize', symmetry: symT };
      case 'smooth': {
        const w = num(sWidth);
        return Number.isFinite(w) && w <= 0 ? null : { op: 'smooth', width: w, keepFlux };
      }
      case 'regrid': {
        const c = num(cStep);
        const g = num(gStep);
        if (eq(c, steps.cStep) && eq(g, steps.gStep) && gRange === 'keep') return null;
        return { op: 'regrid', cStep: c, gStep: g, gRange };
      }
      default:
        return null;
    }
  }, [op, nMode, nValue, plane, axis, angle, symT, cStep, gStep, gRange, steps, sWidth, keepFlux, s]);

  const comp = (f: OpenFile, r: SumRow) => ({
    name: baseName(f.name),
    work: workOf(f),
    weight: sumWeight(f, r),
    rotations: (['x', 'y', 'z'] as const).map((a) => ({ axis: a, angle: num(r[`r${a}`]) || 0 })).filter((x) => x.angle !== 0),
    offset: { x: num(r.ox) || 0, y: num(r.oy) || 0, z: num(r.oz) || 0 },
  });
  const sumComps = useMemo(() => {
    if (op !== 'sum') return [];
    const list = [comp(file, rowA)];
    if (secondFile && rowB) list.push(comp(secondFile, rowB));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, file, rowA, secondFile, rowB]);

  // предпросмотр: операция над рабочим телом (интерполянтом)
  const preview = useMemo((): { p: Photometry; summary: PhotometrySummary; issues: Issue[]; work: Work } | { error: string } | null => {
    try {
      if (op === 'sum') {
        if (sumComps.length < 2) return null;
        const r = sumWorks(sumComps);
        return { p: r.photometry, summary: summarize(r.photometry), issues: r.issues, work: r.work };
      }
      if (!spec) return null;
      const r = applyWork(work, spec);
      return { p: r.photometry, summary: summarize(r.photometry), issues: r.issues, work: r.work };
    } catch (e) {
      return { error: errorText(t, e) };
    }
  }, [op, spec, sumComps, work, t]);
  const ok = preview && !('error' in preview) ? preview : null;
  // пока параметры ничего не меняют — «после» = «до»
  const shown = ok ?? (preview ? null : { p, summary: s, issues: [] as Issue[], work });

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

  const apply = () => {
    if (!ok) return;
    if (op === 'sum') {
      const name = sumComps.map((c) => c.name).join(' + ');
      onCreate(name, ok.p, ok.issues, t('ops.label.sum', { n: sumComps.length }), ok.work);
    } else if (spec) onApply(ok.p, ok.issues, opLabel(t, lang, spec), spec, ok.work);
    reset();
  };

  // ——— второе слагаемое: перетаскивание из списка файлов или с диска, либо «Загрузить…»
  const takeSecond = (f: OpenFile | null) => {
    if (!f) return;
    if (f.id === file.id) {
      setDropErr(t('ops.sumSame'));
      return;
    }
    setDropErr(null);
    setSecond(f.id);
    setRowB(neutralRow(f));
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
    const a = num(angle);
    if (!Number.isFinite(a) || Math.abs(a) < 1e-9) return null;
    if (axis === 'z') return t('ops.hintZ', { c: fmtNum(lang, ((a % 360) + 360) % 360) });
    const d = rotatedDirection([{ axis, angle: a }]);
    return t('ops.hintXY', { c: fmtNum(lang, d.c), g: fmtNum(lang, d.g) });
  };

  const seg = <T extends string>(list: readonly T[], value: T | null, set: (v: T) => void, label: (v: T) => string) => (
    <div className="seg">
      {list.map((v) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{label(v)}</button>
      ))}
    </div>
  );

  /** Поля слагаемого в одну строку: вес / поток, поворот, смещение. */
  const sumFields = (f: OpenFile, r: SumRow, set: (r: SumRow) => void) => (
    <>
      <div className="seg small">
        {(['k', 'flux'] as const).map((m) => (
          <button key={m} className={r.wmode === m ? 'on' : ''} onClick={() => set({ ...r, wmode: m })}>{t(`ops.wmode_${m}`)}</button>
        ))}
      </div>
      {r.wmode === 'k' ? (
        <NumField value={r.weight} onChange={(v) => set({ ...r, weight: v })} min={0} step={0.1} unit="×" width={72} aria-label={t('ops.weight')} title={t('ops.weightFluxHint', { v: fmtNum(lang, (num(r.weight) || 0) * f.summary.flux.total, 0) })} />
      ) : (
        <NumField value={r.flux} onChange={(v) => set({ ...r, flux: v })} min={0} step={10} unit={t('unit.lm')} width={104} aria-label={t('ops.wmode_flux')} title={t('ops.weightKHint', { own: fmtNum(lang, f.summary.flux.total, 0), k: fmtNum(lang, sumWeight(f, r) || 0, 3) })} />
      )}
      <span className="oplabel">{t('ops.rot')}</span>
      {(['rx', 'ry', 'rz'] as const).map((k) => (
        <NumField key={k} value={r[k]} onChange={(v) => set({ ...r, [k]: v })} step={1} unit={`° ${k[1].toUpperCase()}`} width={76} aria-label={`${t('ops.rot')} ${k[1].toUpperCase()}`} />
      ))}
      <span className="oplabel">{t('ops.offset')}</span>
      {(['ox', 'oy', 'oz'] as const).map((k) => (
        <NumField key={k} value={r[k]} onChange={(v) => set({ ...r, [k]: v })} step={1} unit={`${t('unit.mm')} ${k[1]}`} width={86} aria-label={k[1]} />
      ))}
    </>
  );

  let fields: React.ReactNode = null;
  switch (op) {
    case 'normalize':
      fields = (
        <>
          <Select value={nMode} onChange={(e) => { const m = e.target.value as NormalizeMode; setNMode(m); setNValue(neutralValue(m)); }} aria-label={t('batch.stepMode')}>
            {(['factor', 'flux', 'peak', 'cdklm'] as const).map((m) => <option key={m} value={m}>{t(`ops.norm_${m}`)}</option>)}
          </Select>
          {nMode !== 'cdklm' && (
            <NumField value={nValue} onChange={setNValue} min={0} step={nMode === 'factor' ? 0.1 : nMode === 'flux' ? 10 : 1} unit={nMode === 'flux' ? t('unit.lm') : nMode === 'peak' ? t('unit.cd') : '×'} width={130} aria-label={t(`ops.norm_${nMode}`)} />
          )}
          {nMode === 'cdklm' && <span className="muted small">{t('ops.normNowRef', { v: fmtNum(lang, s.referenceFlux, 0), kind: t(`ref.${s.referenceKind}`) })}</span>}
        </>
      );
      break;
    case 'mirror':
      fields = seg(['c0c180', 'c90c270', 'updown'] as const, plane, setPlane, (m) => t(`ops.mirrorBtn_${m}`));
      break;
    case 'rotate':
      fields = (
        <>
          <span className="oplabel">{t('ops.axis')}</span>
          <span title={t(`ops.axisNote_${axis}`)}>{seg(['x', 'y', 'z'] as const, axis, setAxis, (a) => a.toUpperCase())}</span>
          <span className="oplabel">{t('ops.angle')}</span>
          <NumField value={angle} onChange={setAngle} step={1} unit="°" width={96} aria-label={t('ops.angle')} />
          <span className="muted small">{rotHint()}</span>
        </>
      );
      break;
    case 'symmetrize':
      fields = seg(['none', 'axial', 'c0c180', 'c90c270'] as const, symT, setSymT, (m) => t(`ops.symBtn_${m}`));
      break;
    case 'smooth':
      fields = (
        <>
          <span className="oplabel">{t('ops.smoothWidth')}</span>
          <NumField value={sWidth} onChange={setSWidth} min={0} max={30} step={1} unit="°" width={88} aria-label={t('ops.smoothWidth')} />
          <label className="check"><input type="checkbox" checked={keepFlux} onChange={(e) => setKeepFlux(e.target.checked)} />{t('ops.keepFlux')}</label>
        </>
      );
      break;
    case 'regrid':
      fields = (
        <>
          <span className="oplabel">ΔC</span>
          <NumField value={cStep} onChange={setCStep} min={0} step={2.5} unit="°" disabled={s.asC.symmetry === 'axial'} width={88} aria-label={t('ops.cStep')} />
          <span className="oplabel">Δγ</span>
          <NumField value={gStep} onChange={setGStep} min={0} step={0.5} unit="°" width={88} aria-label={t('ops.gStep')} />
          <span className="oplabel">γ</span>
          <Select value={gRange} onChange={(e) => setGRange(e.target.value as GammaRange)} aria-label={t('ops.gRange')}>
            <option value="keep">{t('ops.gRange_keep')}</option>
            <option value="lower">0…90°</option>
            <option value="full">0…180°</option>
          </Select>
        </>
      );
      break;
  }

  const canApply = !!ok && (op === 'sum' ? sumComps.length === 2 : !!spec);

  return (
    <div className="ops-layout">
      <div className="ops-main">
        <section className="ops-editor">
          <div className="opline">
            <Select value={op} onChange={(e) => onOp(e.target.value as OpKind)} aria-label={t('ops.title')} className="opkind-sel">
              {OP_KINDS.map((k) => <option key={k} value={k}>{t(`ops.kind_${k}`)}</option>)}
            </Select>
            {fields}
            <span className="grow" />
            <button className="btn primary opgo" disabled={!canApply} onClick={apply}>
              {op === 'sum' ? t('ops.applySum') : t('ops.apply')}
            </button>
          </div>
          {op === 'sum' && (
            <div className="sumslots">
              <div className="sumslot">
                <span className="slotname" title={file.name}><span className="slotno">1</span>{file.name}</span>
                {sumFields(file, rowA, setRowA)}
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
                      <span className="slotno">2</span>{secondFile.name}
                      <button className="close vis" aria-label={t('files.close')} onClick={() => { setSecond(null); setRowB(null); }}>×</button>
                    </span>
                    {sumFields(secondFile, rowB, (r) => setRowB(r))}
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
          {preview && 'error' in preview && <p className="error small opnote">{preview.error}</p>}
          {ok && ok.issues.length > 0 && <p className="muted small opnote">{ok.issues.map((i) => formatIssue(i, lang)).join(' · ')}</p>}
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
                      <Suspense fallback={<Fallback height={340} />}>
                        <Body3D photometry={dense} scale={scale3d} planes={planes} housing={showHousing ? housing : null} view={view} viewNonce={nonce} link={link} height={340} onUserMove={() => setCustom(true)} />
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
      <HistoryPanel file={file} onJump={onJump} />
    </div>
  );
}
