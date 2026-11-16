import { Suspense, useMemo, useState } from 'react';
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
import { Body3D, Fallback, ViewPill } from './Body3DTab';
import { HistoryPanel } from './HistoryPanel';
import { NumField } from './NumField';

export type OpKind = 'normalize' | 'mirror' | 'rotate' | 'symmetrize' | 'smooth' | 'regrid' | 'sum';
export const OP_KINDS: OpKind[] = ['normalize', 'mirror', 'rotate', 'symmetrize', 'smooth', 'regrid', 'sum'];

type SymTarget = Exclude<Symmetry, 'bilateral'>;

interface SumRow {
  on: boolean;
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

export function OpsPanel({ file, files, op, onOp, settings, style, fonts, onApply, onCreate, onJump }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const p = file.parse.photometry;
  const s = file.summary;
  const work = useMemo(() => workOf(file), [file]);

  // параметры операций (живут, пока открыта вкладка)
  const [nMode, setNMode] = useState<NormalizeMode>('flux');
  const [nValue, setNValue] = useState('1000');
  const [plane, setPlane] = useState<MirrorPlane>('c0c180');
  const [axis, setAxis] = useState<RotationAxis>('z');
  const [angle, setAngle] = useState('90');
  const [symT, setSymT] = useState<SymTarget>('axial');
  const steps = useMemo(() => naturalSteps(s.asC), [s.asC]);
  const [cStep, setCStep] = useState('');
  const [gStep, setGStep] = useState('');
  const [gRange, setGRange] = useState<GammaRange>('keep');
  const [sWidth, setSWidth] = useState('5');
  const [keepFlux, setKeepFlux] = useState(true);
  const [sumRows, setSumRows] = useState<Record<string, SumRow>>({});
  const [view, setView] = useState<View3D>('iso');
  const [nonce, setNonce] = useState(0);
  const link = useMemo(createCameraLink, []);

  const row = (f: OpenFile): SumRow =>
    sumRows[f.id] ?? { on: f.id === file.id, wmode: 'k', weight: '1', flux: String(Math.round(f.summary.flux.total)), rx: '0', ry: '0', rz: '0', ox: '0', oy: '0', oz: '0' };
  const setRow = (id: string, patch: Partial<SumRow>) => {
    const f = files.find((x) => x.id === id)!;
    setSumRows({ ...sumRows, [id]: { ...row(f), ...patch } });
  };

  const spec: OpSpec | null = useMemo(() => {
    switch (op) {
      case 'normalize':
        return { op: 'normalize', mode: nMode, value: nMode === 'cdklm' ? undefined : num(nValue) };
      case 'mirror':
        return { op: 'mirror', plane };
      case 'rotate':
        return { op: 'rotate', axis, angle: num(angle) };
      case 'symmetrize':
        return { op: 'symmetrize', symmetry: symT };
      case 'smooth':
        return { op: 'smooth', width: num(sWidth), keepFlux };
      case 'regrid':
        return { op: 'regrid', cStep: cStep === '' ? steps.cStep : num(cStep), gStep: gStep === '' ? steps.gStep : num(gStep), gRange };
      default:
        return null;
    }
  }, [op, nMode, nValue, plane, axis, angle, symT, cStep, gStep, gRange, steps, sWidth, keepFlux]);

  const sumComps = useMemo(() => {
    if (op !== 'sum') return [];
    return files
      .filter((f) => row(f).on)
      .map((f) => {
        const r = row(f);
        const rotations = (['x', 'y', 'z'] as const).map((a) => ({ axis: a, angle: num(r[`r${a}`]) || 0 })).filter((x) => x.angle !== 0);
        return {
          name: baseName(f.name),
          work: workOf(f),
          weight: sumWeight(f, r),
          rotations,
          offset: { x: num(r.ox) || 0, y: num(r.oy) || 0, z: num(r.oz) || 0 },
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, files, sumRows, file.id]);

  // предпросмотр: операция над рабочим телом (интерполянтом)
  const preview = useMemo((): { p: Photometry; summary: PhotometrySummary; issues: Issue[]; work: Work } | { error: string } | null => {
    try {
      if (op === 'sum') {
        if (!sumComps.length) return { error: t('ops.err.no-components') };
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

  // графики «до» и «после»: кривые — по рабочему телу (гладко, без «дыхания»), числа — по файлу
  const measure = useMemo(() => (fonts ? fontMeasure(fonts.set) : approxTextWidth), [fonts]);
  const planes = useMemo(() => {
    const set = new Set<number>([...defaultPlanes(p), ...(ok ? defaultPlanes(ok.p) : [])]);
    return [...set].sort((a, b) => a - b).slice(0, 6);
  }, [p, ok]);
  const chart = (ph: Photometry, sm: PhotometrySummary) =>
    renderSvg(buildPolar(ph, sm, { ...settings, planes, width: settings.width, title: '' }, style, measure), { screenFamily: screenFamily(fonts) });
  const before = useMemo(() => chart(work.dense, s), [work, s, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = useMemo(() => (ok ? chart(ok.work.dense, ok.summary) : null), [ok, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps

  const housingBefore = useMemo(() => housingBox(p), [p]);
  const housingAfter = useMemo(() => (ok ? housingBox(ok.p) : null), [ok]);
  const scale3d = Math.max(s.peak.value, ok?.summary.peak.value ?? 0) || 1;

  const apply = () => {
    if (!ok) return;
    if (op === 'sum') {
      const names = sumComps.map((c) => c.name);
      const name = names.length > 3 ? `${names.slice(0, 3).join(' + ')} + …` : names.join(' + ');
      onCreate(name, ok.p, ok.issues, t('ops.label.sum', { n: sumComps.length }), ok.work);
    } else if (spec) onApply(ok.p, ok.issues, opLabel(t, lang, spec), spec, ok.work);
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

  // подсказка, куда уходит надир / C0 после поворота
  const rotHint = () => {
    const a = num(angle);
    if (!Number.isFinite(a)) return null;
    if (axis === 'z') return t('ops.hintZ', { c: fmtNum(lang, ((a % 360) + 360) % 360) });
    const d = rotatedDirection([{ axis, angle: a }]);
    return t('ops.hintXY', { c: fmtNum(lang, d.c), g: fmtNum(lang, d.g) });
  };

  const applyBtn = (
    <button className="btn primary opgo" disabled={!ok} onClick={apply}>
      {op === 'sum' ? t('ops.applySum') : t('ops.apply')}
    </button>
  );
  const seg = <T extends string>(list: readonly T[], value: T, set: (v: T) => void, label: (v: T) => string) => (
    <div className="seg">
      {list.map((v) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{label(v)}</button>
      ))}
    </div>
  );

  let note: React.ReactNode = null;
  let line: React.ReactNode = null;
  switch (op) {
    case 'normalize':
      line = (
        <>
          <Select value={nMode} onChange={(e) => setNMode(e.target.value as NormalizeMode)} aria-label={t('batch.stepMode')}>
            {(['flux', 'cdklm', 'peak', 'factor'] as const).map((m) => <option key={m} value={m}>{t(`ops.norm_${m}`)}</option>)}
          </Select>
          {nMode !== 'cdklm' && (
            <NumField value={nValue} onChange={setNValue} min={0} step={nMode === 'factor' ? 0.1 : nMode === 'flux' ? 100 : 10} unit={nMode === 'flux' ? t('unit.lm') : nMode === 'peak' ? t('unit.cd') : '×'} width={130} aria-label={t(`ops.norm_${nMode}`)} />
          )}
          <span className="muted small">
            {nMode === 'flux' && t('ops.normNowFlux', { v: fmtNum(lang, s.flux.total, 0) })}
            {nMode === 'peak' && t('ops.normNowPeak', { v: fmtNum(lang, s.peak.value, 0) })}
            {nMode === 'cdklm' && t('ops.normNowRef', { v: fmtNum(lang, s.referenceFlux, 0), kind: t(`ref.${s.referenceKind}`) })}
          </span>
        </>
      );
      note = t('ops.normNote');
      break;
    case 'mirror':
      line = seg(['c0c180', 'c90c270', 'updown'] as const, plane, setPlane, (m) => t(`ops.mirror_${m}`));
      break;
    case 'rotate':
      line = (
        <>
          <span className="oplabel">{t('ops.axis')}</span>
          {seg(['x', 'y', 'z'] as const, axis, setAxis, (a) => a.toUpperCase())}
          <span className="oplabel">{t('ops.angle')}</span>
          <NumField value={angle} onChange={setAngle} step={1} unit="°" width={96} aria-label={t('ops.angle')} />
          <span className="muted small">{rotHint()}</span>
        </>
      );
      note = t(`ops.axisNote_${axis}`);
      break;
    case 'symmetrize':
      line = seg(['axial', 'c0c180', 'c90c270', 'quadrant', 'none'] as const, symT, setSymT, (m) => t(`ops.sym_${m}`));
      note = t('ops.symNote');
      break;
    case 'smooth':
      line = (
        <>
          <span className="oplabel">{t('ops.smoothWidth')}</span>
          <NumField value={sWidth} onChange={setSWidth} min={0.5} max={30} step={1} unit="°" width={88} aria-label={t('ops.smoothWidth')} />
          <label className="check"><input type="checkbox" checked={keepFlux} onChange={(e) => setKeepFlux(e.target.checked)} />{t('ops.keepFlux')}</label>
        </>
      );
      note = t('ops.smoothNote');
      break;
    case 'regrid':
      line = (
        <>
          <span className="oplabel">ΔC</span>
          <NumField value={cStep} onChange={setCStep} min={0} step={2.5} unit="°" placeholder={String(steps.cStep)} disabled={s.asC.symmetry === 'axial'} width={88} aria-label={t('ops.cStep')} />
          <span className="oplabel">Δγ</span>
          <NumField value={gStep} onChange={setGStep} min={0} step={0.5} unit="°" placeholder={String(steps.gStep)} width={88} aria-label={t('ops.gStep')} />
          <span className="oplabel">γ</span>
          <Select value={gRange} onChange={(e) => setGRange(e.target.value as GammaRange)} aria-label={t('ops.gRange')}>
            <option value="keep">{t('ops.gRange_keep')}</option>
            <option value="lower">0…90°</option>
            <option value="full">0…180°</option>
          </Select>
        </>
      );
      break;
    case 'sum':
      note = t('ops.sumNote');
      break;
  }

  return (
    <div className="ops-layout">
      <div className="ops-main">
        <div className="ops-stage">
          <div className="ops-pair">
            {([['before', before, work.dense, housingBefore, s, p], ['after', after, ok?.work.dense ?? null, housingAfter, ok?.summary ?? null, ok?.p ?? null]] as const).map(([k, svg, dense, housing, sm, ph]) => (
              <figure key={k}>
                <figcaption>{t(`ops.${k}`)}</figcaption>
                {svg && dense ? (
                  <>
                    <div className="paper b3d-wrap ops-3d">
                      <ViewPill view={view} onView={(v) => { setView(v); setNonce(nonce + 1); }} />
                      <Suspense fallback={<Fallback height={230} />}>
                        <Body3D photometry={dense} scale={scale3d} planes={planes} housing={housing} view={view} viewNonce={nonce} link={link} height={230} />
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

        <section className="ops-editor">
          <div className="opkinds" role="tablist">
            {OP_KINDS.map((k) => (
              <button key={k} role="tab" aria-selected={op === k} className={op === k ? 'opkind on' : 'opkind'} onClick={() => onOp(k)}>
                {t(`ops.kind_${k}`)}
              </button>
            ))}
          </div>

          {op !== 'sum' ? (
            <div className="opline">
              {line}
              <span className="grow" />
              {applyBtn}
            </div>
          ) : (
            <>
              <table className="sumtable">
                <thead>
                  <tr>
                    <th />
                    <th>{t('ops.sumFile')}</th>
                    <th>{t('ops.weight')}</th>
                    <th>{t('ops.rot')} X / Y / Z, °</th>
                    <th>x / y / z, {t('ops.mm')}</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const r = row(f);
                    return (
                      <tr key={f.id} className={r.on ? 'on' : ''}>
                        <td><input type="checkbox" checked={r.on} onChange={(e) => setRow(f.id, { on: e.target.checked })} aria-label={f.name} /></td>
                        <td className="fname" title={f.name}>{f.name}</td>
                        <td>
                          <div className="sumweight">
                            <div className="seg small">
                              {(['k', 'flux'] as const).map((m) => (
                                <button key={m} disabled={!r.on} className={r.wmode === m ? 'on' : ''} onClick={() => setRow(f.id, { wmode: m })}>{t(`ops.wmode_${m}`)}</button>
                              ))}
                            </div>
                            {r.wmode === 'k' ? (
                              <NumField value={r.weight} onChange={(v) => setRow(f.id, { weight: v })} min={0} step={0.1} unit="×" width={84} disabled={!r.on} aria-label={t('ops.weight')} title={t('ops.weightFluxHint', { v: fmtNum(lang, (num(r.weight) || 0) * f.summary.flux.total, 0) })} />
                            ) : (
                              <NumField value={r.flux} onChange={(v) => setRow(f.id, { flux: v })} min={0} step={100} unit={t('unit.lm')} width={100} disabled={!r.on} aria-label={t('ops.wmode_flux')} title={t('ops.weightKHint', { own: fmtNum(lang, f.summary.flux.total, 0), k: fmtNum(lang, sumWeight(f, r) || 0, 3) })} />
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="trio">
                            {(['rx', 'ry', 'rz'] as const).map((k) => (
                              <NumField key={k} value={r[k]} onChange={(v) => setRow(f.id, { [k]: v })} step={15} unit="°" width={74} disabled={!r.on} aria-label={`${t('ops.rot')} ${k[1].toUpperCase()}`} />
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="trio">
                            {(['ox', 'oy', 'oz'] as const).map((k) => (
                              <NumField key={k} value={r[k]} onChange={(v) => setRow(f.id, { [k]: v })} step={10} width={74} disabled={!r.on} aria-label={k[1]} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="opline">
                <span className="grow" />
                {applyBtn}
              </div>
            </>
          )}

          {note && <p className="muted small opnote">{note}</p>}
          {preview && 'error' in preview && <p className="error small">{preview.error}</p>}
          {ok && ok.issues.length > 0 && <p className="muted small opnote">{ok.issues.map((i) => formatIssue(i, lang)).join(' · ')}</p>}
        </section>
      </div>
      <HistoryPanel file={file} onJump={onJump} />
    </div>
  );
}
