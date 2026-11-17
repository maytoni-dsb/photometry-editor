import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Dimensions, Lang, LampSet, Metadata, OpSpec, Photometry } from '../../core/index';
import type { OpenFile } from '../doc';
import { LuminaireDrawing } from './LuminaireDrawing';
import { NumField, parseNum } from './NumField';
import { lampsFromXlsx } from '../../batch/lamps-xlsx';

/** Правка паспорта: название шага истории и изменение модели (применяется и к рабочему телу). */
export type PassportPatch = (label: string, fn: (p: Photometry) => void) => void;

function num(lang: string, x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Текстовое поле паспорта: изменение записывается в историю по Enter или при уходе из поля; Esc — отмена. */
function EditText({ value, onCommit, placeholder, wide }: { value: string; onCommit: (v: string) => void; placeholder?: string; wide?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) onCommit(v.trim());
  };
  return (
    <input
      type="text"
      className="pe"
      value={v}
      placeholder={placeholder ?? '—'}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/**
 * Числовое поле паспорта: стрелки, колесо, ввод. В историю — через полсекунды после последнего
 * изменения, по Enter или при уходе из поля (одна правка — один шаг истории).
 */
function EditNum({ value, onCommit, unit, step = 1, min = 0, max, maxNote, width = 96, disabled, def = 0 }: { value: number | null | undefined; onCommit: (v: number) => void; unit?: string; step?: number; min?: number; max?: number; maxNote?: string; width?: number | string; disabled?: boolean; def?: number }) {
  const shown = value == null || !Number.isFinite(value) ? '' : String(Math.round(value * 1000) / 1000);
  const [v, setV] = useState(shown);
  const timer = useRef(0);
  useEffect(() => setV(shown), [shown]);
  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    const x = parseNum(text);
    if (Number.isFinite(x) && x >= min && (max == null || x <= max + 1e-9) && text !== shown) onCommit(x);
  };
  const x = parseNum(v);
  const bad = max != null && Number.isFinite(x) && x > max + 1e-9;
  return (
    <span
      className={`pe-num${bad ? ' bad' : ''}`}
      title={bad ? maxNote : undefined}
      onBlur={() => commit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(v);
      }}
    >
      <NumField
        value={v}
        def={def}
        onChange={(t) => {
          setV(t);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(t), 700);
        }}
        unit={unit}
        step={step}
        min={min}
        width={width}
        disabled={disabled}
      />
    </span>
  );
}

export function Passport({ file, onPatch, onOp }: { file: OpenFile; onPatch: PassportPatch; onOp: (spec: OpSpec, label: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const p = file.parse.photometry;
  const s = file.summary;
  const n = (x: number | null | undefined, d = 1) => num(lang, x, d);
  const meta = p.meta;
  const isB = p.photometryType === 'B';
  const hName = isB ? 'H' : 'C';
  const vName = isB ? 'V' : 'γ';
  const version = p.source.format === 'IES' ? p.ies?.versionLine || 'LM-63-1986' : p.source.format === 'LDT' ? 'EULUMDAT' : '';
  const step = (a: number[]) => {
    if (a.length < 2) return null;
    const d = a[1] - a[0];
    return a.every((v, i) => i === 0 || Math.abs(v - a[i - 1] - d) < 1e-3) ? Math.round(d * 1000) / 1000 : null;
  };
  const dh = step(p.hAngles);
  const dv = step(p.vAngles);
  const gridText = t('passport.gridText', {
    hName,
    vName,
    nh: p.hAngles.length,
    nv: p.vAngles.length,
    dh: dh != null ? `${n(dh, 3)}°` : t('passport.stepVaries'),
    dv: dv != null ? `${n(dv, 3)}°` : t('passport.stepVaries'),
    v0: n(p.vAngles[0], 3),
    v1: n(p.vAngles[p.vAngles.length - 1], 3),
  });
  /** Исходное состояние файла — значения по умолчанию (правая кнопка) для потока, КПД, ламп. */
  const orig = file.past[0] ?? file;
  const r1 = (x: number | null | undefined) => (x == null ? 0 : Math.round(x * 10) / 10);

  const label = (field: string) => t('passport.edit', { field });
  const setMeta = (k: keyof Omit<Metadata, 'keywords'>, v: string) => onPatch(label(t(`passport.${k}`)), (q) => (q.meta[k] = v));
  const setDim = (which: 'luminaire' | 'luminous', patch: Partial<Dimensions>) =>
    onPatch(label(t(which === 'luminaire' ? 'passport.dimsLuminaire' : 'passport.dimsLuminous')), (q) => {
      q[which] = { ...q[which], ...patch };
      if (which === 'luminous' && patch.height != null && q.ldt && q.ldt.luminousHeights.every((h) => h === p.luminous.height)) {
        q.ldt.luminousHeights = [patch.height, patch.height, patch.height, patch.height];
      }
    });
  const setLamp = (i: number, patch: Partial<LampSet>, field: string) =>
    onPatch(label(`${t('passport.lamps')} ${i + 1}: ${field}`), (q) => {
      const l = q.lamps[i];
      // первый источник задаёт масштаб сил света (кд/клм сохраняются)
      if (i === 0 && patch.flux != null && l.flux && l.flux > 0) {
        const k = patch.flux / l.flux;
        q.candela = q.candela.map((row) => row.map((x) => x * k));
      }
      q.lamps[i] = { ...l, ...patch };
    });

  const addLamp = () =>
    onPatch(label(t('passport.addSource')), (q) => {
      const l = q.lamps[q.lamps.length - 1] ?? { count: 1, flux: null, type: 'LED', cct: '', cri: '', watts: q.inputWatts };
      q.lamps.push({ ...l });
    });
  const removeLamp = (i: number) =>
    onPatch(label(t('passport.removeSource', { n: i + 1 })), (q) => {
      if (q.lamps.length > 1) q.lamps.splice(i, 1);
    });
  const xlsxInput = useRef<HTMLInputElement>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const importLamps = async (f: File) => {
    setImportErr(null);
    try {
      const rows = await lampsFromXlsx(new Uint8Array(await f.arrayBuffer()));
      if (!rows.length) throw new Error(t('passport.importNone'));
      onPatch(label(t('passport.importSources', { n: rows.length })), (q) => {
        // пустой единственный источник заменяется
        const blank = q.lamps.length === 1 && !q.lamps[0].type && !q.lamps[0].cct;
        q.lamps = [...(blank ? [] : q.lamps), ...rows.map((r) => ({ ...r, count: q.absolute ? -1 : r.count }))];
      });
    } catch (e) {
      setImportErr(t('passport.importError', { msg: (e as Error).message }));
    }
  };

  const kv = (k: string, v: React.ReactNode, key = k) => (
    <div key={key}>
      <dt>{k}</dt>
      <dd>{v === '' || v == null ? <span className="muted">—</span> : v}</dd>
    </div>
  );

  /** Блок размеров: «Корпус» / «Световое отверстие», форма, затем длина (диаметр) — ширина — высота. */
  const dimBlock = (which: 'luminaire' | 'luminous') => {
    const d = p[which];
    const circle = d.shape === 'circle';
    const mm = t('unit.mm');
    // световое отверстие не больше корпуса по каждому измерению (0 у корпуса — размер не задан, без ограничения)
    const H = p.luminaire;
    const hw = H.shape === 'circle' ? H.length : H.width;
    const lim = which === 'luminous' && H.shape !== 'point' ? { length: H.length > 0 ? H.length : undefined, width: hw > 0 ? hw : undefined, height: H.height > 0 ? H.height : undefined } : undefined;
    const limNote = t('passport.luminousTooBig');
    return (
      <div className="pe-block">
        <div className="pe-head">
          <span>{t(which === 'luminaire' ? 'passport.housing' : 'passport.aperture')}</span>
          <span className="seg small icons pe-shape" role="radiogroup" aria-label={t('passport.shape')}>
            {(['rect', 'circle'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={(v === 'circle') === circle}
                className={(v === 'circle') === circle ? 'on' : ''}
                onClick={() => (v === 'circle') !== circle && setDim(which, v === 'circle' ? { shape: 'circle', width: 0 } : { shape: 'rect', width: d.width > 0 ? d.width : d.length })}
                title={t(v === 'rect' ? 'passport.shape_box' : 'passport.shape_cylinder')}
                aria-label={t(v === 'rect' ? 'passport.shape_box' : 'passport.shape_cylinder')}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                  {v === 'rect' ? (
                    <path d="M2.5 5.5 8 3l5.5 2.5v5L8 13l-5.5-2.5zM2.5 5.5 8 8l5.5-2.5M8 8v5" />
                  ) : (
                    <path d="M3 4.5c0-1.1 2.2-2 5-2s5 .9 5 2v7c0 1.1-2.2 2-5 2s-5-.9-5-2zM3 4.5c0 1.1 2.2 2 5 2s5-.9 5-2" />
                  )}
                </svg>
              </button>
            ))}
          </span>
        </div>
        <div className="pe-fields">
          <label>
            <span>{circle ? t('passport.diameterL') : t('passport.lengthL')}</span>
            <EditNum value={d.length} onCommit={(v) => setDim(which, { length: v, shape: d.shape === 'point' ? (d.width > 0 ? 'rect' : 'circle') : d.shape })} unit={mm} step={1} width="100%" max={lim?.length} maxNote={limNote} />
          </label>
          <label>
            <span>{circle ? '\u00a0' : t('passport.widthL')}</span>
            <EditNum
              value={circle ? 0 : d.width}
              onCommit={(v) => setDim(which, v > 0 ? { width: v, shape: 'rect' } : { width: 0, shape: 'circle' })}
              unit={mm}
              step={1}
              width="100%"
              max={lim?.width}
              maxNote={limNote}
            />
          </label>
          <label>
            <span>{t('passport.heightL')}</span>
            <EditNum value={d.height} onCommit={(v) => setDim(which, { height: v, shape: d.shape === 'point' ? (d.width > 0 ? 'rect' : 'circle') : d.shape })} unit={mm} step={1} width="100%" max={lim?.height} maxNote={limNote} />
          </label>
        </div>
      </div>
    );
  };

  const toggleMode = (absolute: boolean) =>
    onPatch(label(t('passport.mode')), (q) => {
      const total = s.flux.total;
      q.absolute = absolute;
      const l = q.lamps[0] ?? { count: 1, flux: null, type: '', cct: '', cri: '', watts: q.inputWatts };
      if (!q.lamps.length) q.lamps.push(l);
      // силы света не меняются; поток ламп = поток светильника (КПД 100 %), абсолютная — заявленный поток светильника
      q.lamps[0] = { ...l, count: absolute ? l.count : Math.max(1, Math.abs(l.count) || 1), flux: Math.round(total * 10) / 10 };
    });

  return (
    <div className="passport">
      <div className="pp-grid">
        <section className="card">
          <h3>{t('passport.luminaire')}</h3>
          <dl className="kv grid2">
            {(['manufacturer', 'luminaireName', 'article', 'testReport', 'testLab', 'date', 'issueDate'] as const).map((k) =>
              kv(t(`passport.${k}`), <EditText value={meta[k]} onCommit={(v) => setMeta(k, v)} />, k),
            )}
            {kv(t('passport.inputWatts'), <EditNum value={p.inputWatts} onCommit={(v) => onPatch(label(t('passport.inputWatts')), (q) => (q.inputWatts = v))} unit={t("unit.w")} step={1} width="100%" />)}
          </dl>
        </section>

        <section className="card">
          <h3>{t('passport.dims')}</h3>
          {dimBlock('luminaire')}
          {dimBlock('luminous')}
          {p.ldt && (
            <div className="pe-block">
              <div className="pe-head"><span>{t('passport.luminousHeights')}</span></div>
              <div className="pe-grid22">
                {p.ldt.luminousHeights.map((h, i) => (
                  <label key={i}>
                    <span>C{i * 90}</span>
                    <EditNum
                      value={h}
                      onCommit={(v) =>
                        onPatch(label(t('passport.luminousHeights')), (q) => {
                          if (q.ldt) q.ldt.luminousHeights = q.ldt.luminousHeights.map((x, j) => (j === i ? v : x)) as [number, number, number, number];
                        })
                      }
                      unit={t('unit.mm')}
                      step={1}
                      width="100%"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="card drawing-card">
          <h3>{t('drawing.title')}</h3>
          <LuminaireDrawing photometry={p} />
        </section>

        <section className="card span2">
          <h3>{t('passport.photoChars')}</h3>
          <div className="pp-two">
            <dl className="kv grid2">
              {kv(
                t('passport.mode'),
                <span className="seg small" role="radiogroup" aria-label={t('passport.mode')}>
                  {[true, false].map((abs) => (
                    <button key={String(abs)} role="radio" aria-checked={abs === p.absolute} className={abs === p.absolute ? 'on' : ''} onClick={() => abs !== p.absolute && toggleMode(abs)}>
                      {t(abs ? 'passport.absolute' : 'passport.relative')}
                    </button>
                  ))}
                </span>,
              )}
              {kv(t('passport.photometryType'), p.photometryType)}
              {kv(t('passport.symmetry'), t(`sym.${p.symmetry}`))}
              {kv(t('passport.grid'), <span className="gridtext">{gridText.split(' · ').map((x, i) => <span key={i}>{x}</span>)}</span>)}
              {isB && kv('', <span className="muted">{t('passport.typeBNote')}</span>, 'b')}
            </dl>
            <dl className="kv grid2">
              {p.absolute
                ? kv(t('passport.flux'), <EditNum value={Math.round(s.flux.total * 10) / 10} onCommit={(v) => onOp({ op: 'normalize', mode: 'flux', value: v }, label(t('passport.flux')))} unit={t('unit.lm')} step={10} width="100%" def={r1(orig.summary.flux.total)} />)
                : kv(
                    t('passport.lor'),
                    <EditNum
                      value={s.lor != null ? Math.round(s.lor * 10) / 10 : null}
                      onCommit={(v) => s.lor && s.lor > 0 && onOp({ op: 'normalize', mode: 'factor', value: v / s.lor }, label(t('passport.lor')))}
                      unit="%"
                      step={1}
                      width="100%"
                      def={r1(orig.summary.lor ?? 100)}
                    />,
                  )}
              {kv(t('passport.fluxDown'), `${n(s.dlor)} %`)}
              {kv(t('passport.efficacy'), s.efficacy != null ? `${n(s.efficacy)} ${t('unit.lmw')}` : '')}
              {p.ies && kv(t('passport.multiplier'), n(p.ies.multiplier, 6))}
              {p.ies && p.ies.tilt !== 'NONE' && kv(t('passport.tilt'), p.ies.tilt)}
            </dl>
          </div>
        </section>

        <section className="card">
          <h3>{t('passport.file')}</h3>
          <dl className="kv grid2">
            {kv(t('passport.fileName'), file.name)}
            {kv(t('passport.format'), p.source.format)}
            {kv(t('passport.version'), version)}
            {kv(t('passport.encoding'), `${p.source.encoding}, ${p.source.lineEnding}`)}
          </dl>
        </section>
      </div>

      <section className="card">
        <div className="h3row">
          <h3>{t('passport.sources')}</h3>
          <span className="row">
            <button className="btn small" onClick={addLamp}>{t('passport.addSource')}</button>
            <button className="btn small" onClick={() => xlsxInput.current?.click()}>{t('passport.importSourcesBtn')}</button>
            <input ref={xlsxInput} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importLamps(f); }} />
          </span>
        </div>
        <div className="table-scroll">
          <table className="grid small edit lamps">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('passport.lampCount')}</th>
                <th>{t('passport.lampType')}</th>
                <th>{t('passport.lampFlux')}</th>
                <th>{t('passport.lampCct')}</th>
                <th>{t('passport.lampCri')}</th>
                <th>{t('passport.lampWatts')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.lamps.map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    {p.absolute ? (
                      <EditNum value={1} onCommit={() => undefined} step={1} min={1} width={84} disabled />
                    ) : (
                      <EditNum value={Math.abs(l.count)} onCommit={(v) => setLamp(i, { count: Math.max(1, Math.round(v)) }, t('passport.lampCount'))} step={1} min={1} width={84} def={1} />
                    )}
                  </td>
                  <td><EditText value={l.type} onCommit={(v) => setLamp(i, { type: v }, t('passport.lampType'))} placeholder={t('passport.lampTypeHint')} /></td>
                  <td><EditNum value={l.flux} onCommit={(v) => setLamp(i, { flux: v }, t('passport.lampFlux'))} step={10} width={110} def={r1(orig.parse.photometry.lamps[i]?.flux ?? orig.summary.flux.total)} /></td>
                  <td><EditNum value={l.cct && Number.isFinite(parseNum(l.cct.replace(/k$/i, ''))) ? parseNum(l.cct.replace(/k$/i, '')) : null} onCommit={(v) => setLamp(i, { cct: String(Math.round(v)) }, t('passport.lampCct'))} unit="K" step={100} width={110} /></td>
                  <td><EditText value={l.cri} onCommit={(v) => setLamp(i, { cri: v }, t('passport.lampCri'))} /></td>
                  <td><EditNum value={l.watts} onCommit={(v) => setLamp(i, { watts: v }, t('passport.lampWatts'))} step={1} width={96} /></td>
                  <td>{p.lamps.length > 1 && <button className="close vis" title={t('passport.removeSource', { n: i + 1 })} aria-label={t('passport.removeSource', { n: i + 1 })} onClick={() => removeLamp(i)}>×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {importErr && <p className="error small">{importErr}</p>}
      </section>

      {meta.keywords.length > 0 && (
        <details className="card">
          <summary>{t('passport.keywords')} ({meta.keywords.length})</summary>
          <dl className="kv mono">
            {meta.keywords.map(([k, v], i) => (
              <div key={i}>
                <dt>[{k}]</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
