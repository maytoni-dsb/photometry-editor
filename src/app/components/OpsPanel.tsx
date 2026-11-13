import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fontMeasure } from '../../charts/fonts';
import { buildPolar } from '../../charts/polar';
import { renderSvg } from '../../charts/render-svg';
import { approxTextWidth } from '../../charts/scene';
import { defaultPlanes } from '../../charts/series';
import type { ChartStyle } from '../../charts/style';
import {
  applyOp,
  formatIssue,
  naturalSteps,
  OpError,
  rotatedDirection,
  sumBodies,
  summarize,
  type GammaRange,
  type Issue,
  type Lang,
  type MirrorPlane,
  type NormalizeMode,
  type OpSpec,
  type Photometry,
  type PhotometrySummary,
  type RotationAxis,
  type SumComponent,
  type Symmetry,
} from '../../core/index';
import type { ChartSettings } from '../App';
import { baseName, type OpenFile } from '../doc';
import type { LoadedFonts } from '../fonts';

export type OpKind = 'normalize' | 'mirror' | 'rotate' | 'symmetrize' | 'regrid' | 'sum';
export const OP_KINDS: OpKind[] = ['normalize', 'mirror', 'rotate', 'symmetrize', 'regrid', 'sum'];

type SymTarget = Exclude<Symmetry, 'bilateral'>;

interface SumRow {
  on: boolean;
  weight: string;
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
  onApply: (p: Photometry, issues: Issue[], label: string, spec: OpSpec) => void;
  onCreate: (name: string, p: Photometry, issues: Issue[], label: string) => void;
  onJump: (index: number) => void;
}

/** Число из поля ввода: запятая или точка. Пусто / мусор → NaN. */
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
const fmtNum = (lang: string, x: number, d = 1) => x.toLocaleString(lang, { maximumFractionDigits: d });
const signed = (lang: string, x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtNum(lang, Math.abs(x), 2)}°`;

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
  const [sumRows, setSumRows] = useState<Record<string, SumRow>>({});

  const row = (f: OpenFile): SumRow =>
    sumRows[f.id] ?? { on: f.id === file.id, weight: '1', rx: '0', ry: '0', rz: '0', ox: '0', oy: '0', oz: '0' };
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
      case 'regrid':
        return { op: 'regrid', cStep: cStep === '' ? steps.cStep : num(cStep), gStep: gStep === '' ? steps.gStep : num(gStep), gRange };
      default:
        return null;
    }
  }, [op, nMode, nValue, plane, axis, angle, symT, cStep, gStep, gRange, steps]);

  const sumComps = useMemo(() => {
    if (op !== 'sum') return [];
    return files
      .filter((f) => row(f).on)
      .map((f): SumComponent & { name: string } => {
        const r = row(f);
        const rotations = (['x', 'y', 'z'] as const).map((a) => ({ axis: a, angle: num(r[`r${a}`]) || 0 })).filter((x) => x.angle !== 0);
        return {
          name: baseName(f.name),
          photometry: f.parse.photometry,
          weight: num(r.weight),
          rotations,
          offset: { x: num(r.ox) || 0, y: num(r.oy) || 0, z: num(r.oz) || 0 },
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, files, sumRows, file.id]);

  // предпросмотр
  const preview = useMemo((): { p: Photometry; summary: PhotometrySummary; issues: Issue[] } | { error: string } | null => {
    try {
      if (op === 'sum') {
        if (!sumComps.length) return { error: t('ops.err.no-components') };
        const r = sumBodies(sumComps);
        return { p: r.photometry, summary: summarize(r.photometry), issues: r.issues };
      }
      if (!spec) return null;
      const r = applyOp(p, spec);
      return { p: r.photometry, summary: summarize(r.photometry), issues: r.issues };
    } catch (e) {
      return { error: errorText(t, e) };
    }
  }, [op, spec, sumComps, p, t]);
  const ok = preview && !('error' in preview) ? preview : null;

  // графики «до» и «после» — одни и те же плоскости
  const measure = useMemo(() => (fonts ? fontMeasure(fonts.set) : approxTextWidth), [fonts]);
  const planes = useMemo(() => {
    const set = new Set<number>([...defaultPlanes(p), ...(ok ? defaultPlanes(ok.p) : [])]);
    return [...set].sort((a, b) => a - b).slice(0, 6);
  }, [p, ok]);
  const chart = (ph: Photometry, sm: PhotometrySummary) =>
    renderSvg(buildPolar(ph, sm, { ...settings, planes, width: settings.width, title: '' }, style, measure));
  const before = useMemo(() => chart(p, s), [p, s, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = useMemo(() => (ok ? chart(ok.p, ok.summary) : null), [ok, planes, settings, style, measure]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (!ok) return;
    if (op === 'sum') {
      const names = sumComps.map((c) => c.name);
      const name = names.length > 3 ? `${names.slice(0, 3).join(' + ')} + …` : names.join(' + ');
      onCreate(name, ok.p, ok.issues, t('ops.label.sum', { n: sumComps.length }));
    } else if (spec) onApply(ok.p, ok.issues, opLabel(t, lang, spec), spec);
  };

  const stats = (sm: PhotometrySummary, ph: Photometry) => (
    <dl className="opstats">
      <div><dt>Φ</dt><dd>{fmtNum(lang, sm.flux.total, 0)} {t('unit.lm')}</dd></div>
      <div><dt>Iₘₐₓ</dt><dd>{fmtNum(lang, sm.peak.value, 0)} {t('unit.cd')} · C{fmtNum(lang, sm.peak.c)} γ{fmtNum(lang, sm.peak.g)}°</dd></div>
      <div><dt>{t('ops.down')}</dt><dd>{fmtNum(lang, sm.dlor, 1)} %</dd></div>
      <div><dt>{t('passport.symmetry')}</dt><dd>{t(`sym.${sm.asC.symmetry}`)}</dd></div>
      <div><dt>{t('passport.grid')}</dt><dd>{sm.asC.hAngles.length} × {sm.asC.vAngles.length}{ph.photometryType === 'B' ? ' (B→C)' : ''}</dd></div>
    </dl>
  );

  // подсказка, куда уходит надир / C0 после поворота
  const rotHint = () => {
    const a = num(angle);
    if (!Number.isFinite(a)) return null;
    if (axis === 'z') return t('ops.hintZ', { c: fmtNum(lang, ((a % 360) + 360) % 360) });
    const d = rotatedDirection([{ axis, angle: a }]);
    return t('ops.hintXY', { c: fmtNum(lang, d.c), g: fmtNum(lang, d.g) });
  };

  const timeline = [...file.past.map((x) => x.label), file.label, ...file.future.map((x) => x.label)];
  const cur = file.past.length;

  return (
    <div className="chart-view ops-view">
      <aside className="chart-settings">
        <h3>{t('ops.title')}</h3>
        <div className="opkinds" role="tablist">
          {OP_KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={op === k} className={op === k ? 'opkind on' : 'opkind'} onClick={() => onOp(k)}>
              {t(`ops.kind_${k}`)}
            </button>
          ))}
        </div>

        <div className="opform">
          {op === 'normalize' && (
            <>
              <div className="radios">
                {(['flux', 'cdklm', 'peak', 'factor'] as const).map((m) => (
                  <label key={m} className="check">
                    <input type="radio" name="nmode" checked={nMode === m} onChange={() => setNMode(m)} />
                    {t(`ops.norm_${m}`)}
                  </label>
                ))}
              </div>
              {nMode !== 'cdklm' && (
                <div className="row">
                  <input type="number" step="any" min={0} value={nValue} onChange={(e) => setNValue(e.target.value)} className="w-wide" aria-label={t(`ops.norm_${nMode}`)} />
                  <span className="muted">{nMode === 'flux' ? t('unit.lm') : nMode === 'peak' ? t('unit.cd') : '×'}</span>
                </div>
              )}
              <p className="muted small">
                {nMode === 'flux' && t('ops.normNowFlux', { v: fmtNum(lang, s.flux.total, 0) })}
                {nMode === 'peak' && t('ops.normNowPeak', { v: fmtNum(lang, s.peak.value, 0) })}
                {nMode === 'cdklm' && t('ops.normNowRef', { v: fmtNum(lang, s.referenceFlux, 0), kind: t(`ref.${s.referenceKind}`) })}
                {nMode === 'factor' && t('ops.normFactorNote')}
              </p>
              <p className="muted small">{t('ops.normNote')}</p>
            </>
          )}

          {op === 'mirror' && (
            <div className="radios">
              {(['c0c180', 'c90c270', 'updown'] as const).map((m) => (
                <label key={m} className="check">
                  <input type="radio" name="plane" checked={plane === m} onChange={() => setPlane(m)} />
                  {t(`ops.mirror_${m}`)}
                </label>
              ))}
            </div>
          )}

          {op === 'rotate' && (
            <>
              <div className="row">
                <span className="muted small">{t('ops.axis')}</span>
                <div className="seg">
                  {(['z', 'x', 'y'] as const).map((a) => (
                    <button key={a} className={axis === a ? 'on' : ''} onClick={() => setAxis(a)}>{a.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div className="row">
                <input type="number" step="any" value={angle} onChange={(e) => setAngle(e.target.value)} className="w-wide" aria-label={t('ops.angle')} />
                <span className="muted">°</span>
              </div>
              <div className="row">
                {[-90, -45, -15, 15, 45, 90, 180].map((a) => (
                  <button key={a} className="btn small" onClick={() => setAngle(String(a))}>{a > 0 ? `+${a}` : `−${-a}`}</button>
                ))}
              </div>
              <p className="muted small">{t(`ops.axisNote_${axis}`)} {rotHint()}</p>
              <p className="muted small">{t('ops.rotateSteps')}</p>
            </>
          )}

          {op === 'symmetrize' && (
            <>
              <div className="radios">
                {(['axial', 'c0c180', 'c90c270', 'quadrant', 'none'] as const).map((m) => (
                  <label key={m} className="check">
                    <input type="radio" name="sym" checked={symT === m} onChange={() => setSymT(m)} />
                    {t(`ops.sym_${m}`)}
                  </label>
                ))}
              </div>
              <p className="muted small">{t('ops.symNote')}</p>
            </>
          )}

          {op === 'regrid' && (
            <>
              <div className="form-grid">
                <label>{t('ops.cStep')}</label>
                <input type="number" step="any" min={0} placeholder={String(steps.cStep)} value={cStep} disabled={s.asC.symmetry === 'axial'} onChange={(e) => setCStep(e.target.value)} />
                <label>{t('ops.gStep')}</label>
                <input type="number" step="any" min={0} placeholder={String(steps.gStep)} value={gStep} onChange={(e) => setGStep(e.target.value)} />
                <label>{t('ops.gRange')}</label>
                <select value={gRange} onChange={(e) => setGRange(e.target.value as GammaRange)}>
                  <option value="keep">{t('ops.gRange_keep')}</option>
                  <option value="lower">0…90°</option>
                  <option value="full">0…180°</option>
                </select>
              </div>
              <p className="muted small">{t('ops.regridNote')}</p>
            </>
          )}

          {op === 'sum' && (
            <>
              <div className="sumlist">
                {files.map((f) => {
                  const r = row(f);
                  return (
                    <div key={f.id} className={r.on ? 'sumrow on' : 'sumrow'}>
                      <label className="check" title={f.name}>
                        <input type="checkbox" checked={r.on} onChange={(e) => setRow(f.id, { on: e.target.checked })} />
                        <span className="fname">{f.name}</span>
                      </label>
                      {r.on && (
                        <div className="sumfields">
                          <label>{t('ops.weight')}<input type="number" step="any" min={0} value={r.weight} onChange={(e) => setRow(f.id, { weight: e.target.value })} /></label>
                          {(['rx', 'ry', 'rz'] as const).map((k) => (
                            <label key={k}>{t('ops.rot')} {k[1].toUpperCase()}, °<input type="number" step="any" value={r[k]} onChange={(e) => setRow(f.id, { [k]: e.target.value })} /></label>
                          ))}
                          {(['ox', 'oy', 'oz'] as const).map((k) => (
                            <label key={k}>{k[1]}, {t('ops.mm')}<input type="number" step="any" value={r[k]} onChange={(e) => setRow(f.id, { [k]: e.target.value })} /></label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="muted small">{t('ops.sumNote')}</p>
            </>
          )}
        </div>

        <div className="opapply">
          {preview && 'error' in preview && <p className="error small">{preview.error}</p>}
          {ok && ok.issues.length > 0 && (
            <ul className="opissues">
              {ok.issues.map((i, k) => <li key={k} className="muted small">{formatIssue(i, lang)}</li>)}
            </ul>
          )}
          <button className="btn primary" disabled={!ok} onClick={apply}>
            {op === 'sum' ? t('ops.applySum') : t('ops.apply')}
          </button>
        </div>

        <fieldset className="history">
          <legend>{t('ops.history')}</legend>
          <ol>
            {timeline.map((label, i) => (
              <li key={i} className={i === cur ? 'cur' : i > cur ? 'undone' : ''}>
                <button className="link" onClick={() => onJump(i)} disabled={i === cur}>
                  {label || (file.derived ? t('ops.created') : t('ops.original'))}
                </button>
              </li>
            ))}
          </ol>
          <p className="muted small">{t('ops.historyNote')}</p>
        </fieldset>
      </aside>

      <div className="chart-stage ops-stage">
        <div className="ops-pair">
          <figure>
            <figcaption>{t('ops.before')}</figcaption>
            <div className="paper" dangerouslySetInnerHTML={{ __html: before }} />
            {stats(s, p)}
          </figure>
          <figure>
            <figcaption>{t('ops.after')}</figcaption>
            {after && ok ? (
              <>
                <div className="paper" dangerouslySetInnerHTML={{ __html: after }} />
                {stats(ok.summary, ok.p)}
              </>
            ) : (
              <div className="paper empty-preview">{preview && 'error' in preview ? preview.error : '—'}</div>
            )}
          </figure>
        </div>
      </div>
    </div>
  );
}
