import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GammaRange, MirrorPlane, NormalizeMode, OpSpec, RotationAxis, Symmetry } from '../../core/index';
import { parseStep, recipeFromJson, recipeToJson, RecipeError, type Recipe } from '../../batch/recipe';
import { safeFileName, saveFile } from '../save-file';
import { opLabel } from './OpsPanel';

type StepKind = OpSpec['op'];
const STEP_KINDS: StepKind[] = ['normalize', 'mirror', 'rotate', 'symmetrize', 'smooth', 'regrid'];
type SymTarget = Exclude<Symmetry, 'bilateral'>;

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

interface Props {
  steps: OpSpec[];
  onSteps: (s: OpSpec[]) => void;
  name: string;
  onName: (n: string) => void;
  saved: Recipe[];
  onSaved: (r: Recipe[]) => void;
  /** Шаги истории активного файла (null — нет файла или операций). */
  history: { file: string; steps: OpSpec[] } | null;
}

/** Редактор рецепта: список шагов, форма шага, сохранённые рецепты, JSON. */
export function RecipeEditor({ steps, onSteps, name, onName, saved, onSaved, history }: Props) {
  const { t, i18n } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<StepKind>('normalize');
  const [nMode, setNMode] = useState<NormalizeMode>('cdklm');
  const [nValue, setNValue] = useState('1000');
  const [plane, setPlane] = useState<MirrorPlane>('c0c180');
  const [axis, setAxis] = useState<RotationAxis>('z');
  const [angle, setAngle] = useState('90');
  const [sym, setSym] = useState<SymTarget>('axial');
  const [width, setWidth] = useState('5');
  const [keepFlux, setKeepFlux] = useState(true);
  const [cStep, setCStep] = useState('5');
  const [gStep, setGStep] = useState('2.5');
  const [gRange, setGRange] = useState<GammaRange>('keep');
  const [editing, setEditing] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const draft = (): OpSpec | null => {
    const raw: Record<StepKind, unknown> = {
      normalize: { op: 'normalize', mode: nMode, value: nMode === 'cdklm' ? undefined : num(nValue) },
      mirror: { op: 'mirror', plane },
      rotate: { op: 'rotate', axis, angle: num(angle) },
      symmetrize: { op: 'symmetrize', symmetry: sym },
      smooth: { op: 'smooth', width: num(width), keepFlux },
      regrid: { op: 'regrid', cStep: num(cStep), gStep: num(gStep), gRange },
    };
    try {
      return parseStep(raw[kind]);
    } catch {
      return null;
    }
  };
  const spec = draft();

  const load = (s: OpSpec) => {
    setKind(s.op);
    switch (s.op) {
      case 'normalize':
        setNMode(s.mode);
        if (s.value != null) setNValue(String(s.value));
        break;
      case 'mirror':
        setPlane(s.plane);
        break;
      case 'rotate':
        setAxis(s.axis);
        setAngle(String(s.angle));
        break;
      case 'symmetrize':
        setSym(s.symmetry);
        break;
      case 'smooth':
        setWidth(String(s.width));
        setKeepFlux(s.keepFlux !== false);
        break;
      case 'regrid':
        setCStep(String(s.cStep));
        setGStep(String(s.gStep));
        setGRange(s.gRange ?? 'keep');
        break;
    }
  };

  const commit = () => {
    if (!spec) return;
    if (editing != null) {
      onSteps(steps.map((s, i) => (i === editing ? spec : s)));
      setEditing(null);
    } else onSteps([...steps, spec]);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onSteps(next);
  };

  const saveRecipe = () => {
    const n = name.trim() || t('batch.recipeUntitled');
    onSaved([...saved.filter((r) => r.name !== n), { name: n, steps }].sort((a, b) => a.name.localeCompare(b.name)));
    onName(n);
    setMsg(t('batch.recipeSaved', { name: n }));
  };
  const importJson = async (f: File) => {
    try {
      const r = recipeFromJson(await f.text(), f.name.replace(/\.json$/i, ''));
      onSteps(r.steps);
      onName(r.name);
      setMsg(t('batch.recipeLoaded', { name: r.name, n: r.steps.length }));
    } catch (e) {
      setMsg(e instanceof RecipeError ? t(`batch.recipeErr.${e.code}`, e.params) : String(e));
    }
  };

  const lang = i18n.language;
  return (
    <div className="recipe">
      <div className="row">
        <select
          value=""
          aria-label={t('batch.recipeSavedList')}
          onChange={(e) => {
            const r = saved.find((x) => x.name === e.target.value);
            if (r) {
              onSteps(r.steps);
              onName(r.name);
              setEditing(null);
              setMsg(null);
            }
          }}
        >
          <option value="">{saved.length ? t('batch.recipeOpen') : t('batch.recipeNone')}</option>
          {saved.map((r) => <option key={r.name} value={r.name}>{r.name} ({r.steps.length})</option>)}
        </select>
        <input type="text" className="grow" placeholder={t('batch.recipeName')} value={name} onChange={(e) => onName(e.target.value)} />
        <button className="btn small" disabled={!steps.length} onClick={saveRecipe}>{t('batch.recipeSave')}</button>
        {saved.some((r) => r.name === name.trim()) && (
          <button className="link small" onClick={() => onSaved(saved.filter((r) => r.name !== name.trim()))}>{t('batch.recipeDelete')}</button>
        )}
      </div>
      <div className="row">
        <button className="btn small" disabled={!history?.steps.length} onClick={() => { if (history) { onSteps(history.steps); setMsg(t('batch.recipeFromHistoryDone', { n: history.steps.length, file: history.file })); } }} title={history ? history.file : ''}>
          {t('batch.recipeFromHistory')}
        </button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>{t('batch.recipeImport')}</button>
        <button
          className="btn small"
          disabled={!steps.length}
          onClick={() => void saveFile(`${safeFileName(name.trim() || t('batch.recipeUntitled'))}.json`, 'application/json', 'json', () => recipeToJson({ name: name.trim(), steps }))}
        >
          {t('batch.recipeExport')}
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
      </div>
      {msg && <p className="muted small">{msg}</p>}

      {steps.length ? (
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i} className={editing === i ? 'editing' : ''}>
              <span className="stepn">{i + 1}</span>
              <button className="steplabel" onClick={() => { load(s); setEditing(i); }} title={t('batch.stepEdit')}>{opLabel(t, lang, s)}</button>
              <button className="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('batch.stepUp')}>↑</button>
              <button className="icon" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={t('batch.stepDown')}>↓</button>
              <button className="icon" onClick={() => { onSteps(steps.filter((_, j) => j !== i)); setEditing(null); }} aria-label={t('batch.stepRemove')}>×</button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">{t('batch.recipeEmpty')}</p>
      )}

      <div className="stepform">
        <div className="form-grid">
          <label>{t('batch.stepKind')}</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as StepKind)}>
            {STEP_KINDS.map((k) => <option key={k} value={k}>{t(`ops.kind_${k}`)}</option>)}
          </select>
          {kind === 'normalize' && (
            <>
              <label>{t('batch.stepMode')}</label>
              <select value={nMode} onChange={(e) => setNMode(e.target.value as NormalizeMode)}>
                {(['cdklm', 'flux', 'peak', 'factor'] as const).map((m) => <option key={m} value={m}>{t(`ops.norm_${m}`)}</option>)}
              </select>
              {nMode !== 'cdklm' && (
                <>
                  <label>{nMode === 'flux' ? t('batch.valueLm') : nMode === 'peak' ? t('batch.valueCd') : t('batch.valueK')}</label>
                  <input type="text" inputMode="decimal" value={nValue} onChange={(e) => setNValue(e.target.value)} />
                </>
              )}
            </>
          )}
          {kind === 'mirror' && (
            <>
              <label>{t('batch.stepPlane')}</label>
              <select value={plane} onChange={(e) => setPlane(e.target.value as MirrorPlane)}>
                {(['c0c180', 'c90c270', 'updown'] as const).map((m) => <option key={m} value={m}>{t(`ops.mirror_${m}`)}</option>)}
              </select>
            </>
          )}
          {kind === 'rotate' && (
            <>
              <label>{t('ops.axis')}</label>
              <select value={axis} onChange={(e) => setAxis(e.target.value as RotationAxis)}>
                {(['z', 'x', 'y'] as const).map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
              <label>{t('ops.angle')}, °</label>
              <input type="text" inputMode="decimal" value={angle} onChange={(e) => setAngle(e.target.value)} />
            </>
          )}
          {kind === 'symmetrize' && (
            <>
              <label>{t('batch.stepSym')}</label>
              <select value={sym} onChange={(e) => setSym(e.target.value as SymTarget)}>
                {(['axial', 'c0c180', 'c90c270', 'quadrant', 'none'] as const).map((m) => <option key={m} value={m}>{t(`ops.sym_${m}`)}</option>)}
              </select>
            </>
          )}
          {kind === 'smooth' && (
            <>
              <label>{t('ops.smoothWidth')}, °</label>
              <input type="text" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
              <span />
              <label className="check"><input type="checkbox" checked={keepFlux} onChange={(e) => setKeepFlux(e.target.checked)} />{t('ops.keepFlux')}</label>
            </>
          )}
          {kind === 'regrid' && (
            <>
              <label>{t('ops.cStep')}</label>
              <input type="text" inputMode="decimal" value={cStep} onChange={(e) => setCStep(e.target.value)} />
              <label>{t('ops.gStep')}</label>
              <input type="text" inputMode="decimal" value={gStep} onChange={(e) => setGStep(e.target.value)} />
              <label>{t('ops.gRange')}</label>
              <select value={gRange} onChange={(e) => setGRange(e.target.value as GammaRange)}>
                <option value="keep">{t('ops.gRange_keep')}</option>
                <option value="lower">{t('chart.rangeLower')}</option>
                <option value="full">{t('chart.rangeFull')}</option>
              </select>
            </>
          )}
        </div>
        {kind === 'rotate' && <p className="muted small">{t(`ops.axisNote_${axis}`)}</p>}
        <div className="row">
          <button className="btn small primary" disabled={!spec} onClick={commit}>
            {editing != null ? t('batch.stepSave', { n: editing + 1 }) : t('batch.stepAdd')}
          </button>
          {editing != null && <button className="link small" onClick={() => setEditing(null)}>{t('batch.stepCancel')}</button>}
          {!spec && <span className="error small">{t('batch.stepInvalid')}</span>}
        </div>
      </div>
    </div>
  );
}
