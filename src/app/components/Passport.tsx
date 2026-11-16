import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Dimensions, Lang, LampSet, Metadata, Photometry } from '../../core/index';
import { saveAs } from '../actions';
import type { OpenFile } from '../doc';
import { LuminaireDrawing } from './LuminaireDrawing';
import { NumField, parseNum } from './NumField';

/** Правка паспорта: название шага истории и изменение модели (применяется и к рабочему телу). */
export type PassportPatch = (label: string, fn: (p: Photometry) => void) => void;

function num(lang: string, x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function range(arr: number[]): string {
  if (!arr.length) return '';
  const a = arr[0];
  const b = arr[arr.length - 1];
  const step = arr.length > 1 ? arr[1] - arr[0] : 0;
  const uniform = arr.every((v, i) => i === 0 || Math.abs(v - arr[i - 1] - step) < 1e-3);
  return a === b ? `${a}°` : `${a}…${b}°${uniform && step ? `, ${Math.round(step * 1000) / 1000}°` : ''}`;
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
      className={wide ? 'pe pe-wide' : 'pe'}
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
function EditNum({ value, onCommit, unit, step = 1, min = 0, width = 96 }: { value: number | null | undefined; onCommit: (v: number) => void; unit?: string; step?: number; min?: number; width?: number }) {
  const shown = value == null || !Number.isFinite(value) ? '' : String(Math.round(value * 1000) / 1000);
  const [v, setV] = useState(shown);
  const timer = useRef(0);
  useEffect(() => setV(shown), [shown]);
  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    const x = parseNum(text);
    if (Number.isFinite(x) && x >= min && text !== shown) onCommit(x);
  };
  return (
    <span
      className="pe-num"
      onBlur={() => commit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(v);
      }}
    >
      <NumField
        value={v}
        onChange={(t) => {
          setV(t);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(t), 700);
        }}
        unit={unit}
        step={step}
        min={min}
        width={width}
      />
    </span>
  );
}

export function Passport({ file, onPatch }: { file: OpenFile; onPatch: PassportPatch }) {
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
  const peakCdklm = (s.peak.value * 1000) / s.referenceFlux;

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
      // относительная фотометрия: поток ламп задаёт масштаб сил света (кд/клм сохраняются)
      if (i === 0 && patch.flux != null && !q.absolute && l.flux && l.flux > 0) {
        const k = patch.flux / l.flux;
        q.candela = q.candela.map((row) => row.map((x) => x * k));
      }
      q.lamps[i] = { ...l, ...patch };
    });

  const kv = (k: string, v: React.ReactNode, key = k) => (
    <div key={key}>
      <dt>{k}</dt>
      <dd>{v === '' || v == null ? <span className="muted">—</span> : v}</dd>
    </div>
  );

  const dimRow = (which: 'luminaire' | 'luminous') => {
    const d = p[which];
    const circle = d.shape === 'circle';
    return (
      <div className="pe-dims">
        <select value={d.shape} onChange={(e) => setDim(which, { shape: e.target.value as Dimensions['shape'] })} className="pe-shape">
          {(['rect', 'circle', 'point'] as const).map((sh) => <option key={sh} value={sh}>{t(`passport.shape_${sh}`)}</option>)}
          {d.shape === 'other' && <option value="other">{t('passport.shape_other')}</option>}
        </select>
        {d.shape !== 'point' && (
          <>
            <EditNum value={d.length} onCommit={(v) => setDim(which, { length: v })} unit={circle ? '⌀' : t('passport.l')} step={10} width={88} />
            {!circle && <EditNum value={d.width} onCommit={(v) => setDim(which, { width: v })} unit={t('passport.w')} step={10} width={88} />}
            <EditNum value={d.height} onCommit={(v) => setDim(which, { height: v })} unit={t('passport.h')} step={5} width={88} />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="passport">
      <div className="toolbar">
        <button className="btn" onClick={() => void saveAs(file, 'ies')}>{t('passport.saveIes')}</button>
        <button className="btn" onClick={() => void saveAs(file, 'ldt')}>{t('passport.saveLdt')}</button>
        <span className="muted small">{t('passport.editHint')}</span>
      </div>

      <div className="pp-top">
        <div className="pp-col">
          <section className="card drawing-card">
            <h3>{t('drawing.title')}</h3>
            <LuminaireDrawing photometry={p} />
          </section>
          <section className="card">
            <h3>{t('passport.dims')}</h3>
            <dl className="kv edit stack">
              {kv(t('passport.dimsLuminaire'), dimRow('luminaire'))}
              {kv(t('passport.dimsLuminous'), dimRow('luminous'))}
              {p.ldt &&
                kv(
                  t('passport.luminousHeights'),
                  <div className="pe-dims">
                    {p.ldt.luminousHeights.map((h, i) => (
                      <EditNum
                        key={i}
                        value={h}
                        onCommit={(v) =>
                          onPatch(label(t('passport.luminousHeights')), (q) => {
                            if (q.ldt) q.ldt.luminousHeights = q.ldt.luminousHeights.map((x, j) => (j === i ? v : x)) as [number, number, number, number];
                          })
                        }
                        step={5}
                        width={74}
                      />
                    ))}
                  </div>,
                )}
            </dl>
          </section>
        </div>

        <section className="card">
          <h3>{t('passport.luminaire')}</h3>
          <dl className="kv edit">
            {(['manufacturer', 'luminaireName', 'article', 'testReport', 'testLab', 'date', 'issueDate', 'lampCatalog'] as const).map((k) =>
              kv(t(`passport.${k}`), <EditText value={meta[k]} onCommit={(v) => setMeta(k, v)} wide />, k),
            )}
            {kv(t('passport.inputWatts'), <EditNum value={p.inputWatts} onCommit={(v) => onPatch(label(t('passport.inputWatts')), (q) => (q.inputWatts = v))} unit={t('unit.w')} step={1} />)}
          </dl>
        </section>
      </div>

      <div className="cards">
        <section className="card">
          <h3>{t('passport.calc')}</h3>
          <dl className="kv">
            {kv(t('passport.flux'), `${n(s.flux.total)} ${t('unit.lm')}`)}
            {kv(t('passport.fluxDownUp'), `${n(s.dlor)} % / ${n(100 - s.dlor)} %`)}
            {kv(t('passport.reference'), `${n(s.referenceFlux)} ${t('unit.lm')} — ${t(`ref.${s.referenceKind}`)}`)}
            {kv(t('passport.peak'), t('passport.peakValue', { cd: n(s.peak.value), cdklm: n(peakCdklm), c: n(s.peak.c), g: n(s.peak.g) }))}
            {kv(t('passport.efficacy'), s.efficacy != null ? `${n(s.efficacy)} ${t('unit.lmw')}` : '')}
            {kv(t('passport.lor'), s.lor != null ? `${n(s.lor)} %` : '')}
            {p.ldt && kv('', t('passport.ldtStated', { lorl: n(p.ldt.lorl), dff: n(p.ldt.dff) }), 'ldt')}
          </dl>
        </section>

        <section className="card">
          <h3>{t('passport.photometry')}</h3>
          <dl className="kv">
            {kv(t('passport.photometryType'), p.photometryType)}
            {kv(t('passport.symmetry'), t(`sym.${p.symmetry}`))}
            {kv(t('passport.grid'), t('passport.gridValue', { h: p.hAngles.length, v: p.vAngles.length, hName, vName, hRange: range(p.hAngles), vRange: range(p.vAngles) }))}
            {kv(t('passport.mode'), p.absolute ? t('passport.absolute') : t('passport.relative'))}
            {p.ies && kv(t('passport.multiplier'), n(p.ies.multiplier, 6))}
            {p.ies && kv(t('passport.tilt'), p.ies.tilt)}
            {p.ldt && kv(t('passport.conversionFactor'), n(p.ldt.conversionFactor, 4))}
            {isB && kv('', <span className="muted">{t('passport.typeBNote')}</span>, 'b')}
          </dl>
        </section>

        <section className="card">
          <h3>{t('passport.file')}</h3>
          <dl className="kv">
            {kv(t('passport.fileName'), file.name)}
            {kv(t('passport.format'), p.source.format)}
            {kv(t('passport.version'), version)}
            {kv(t('passport.encoding'), `${p.source.encoding}, ${p.source.lineEnding}`)}
          </dl>
        </section>
      </div>

      <section className="card">
        <h3>{t('passport.lamps')}</h3>
        <div className="table-scroll">
          <table className="grid small edit lamps">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('passport.lampCount')}</th>
                <th>{t('passport.lampFlux')}</th>
                <th>{t('passport.lampType')}</th>
                <th>{t('passport.lampCct')}</th>
                <th>{t('passport.lampCri')}</th>
                <th>{t('passport.lampWatts')}</th>
              </tr>
            </thead>
            <tbody>
              {p.lamps.map((l, i) => (
                <tr key={i} className={i > 0 ? 'muted' : ''}>
                  <td>{i + 1}{i > 0 ? ` (${t('passport.lampAlt')})` : ''}</td>
                  <td>
                    {p.absolute && i === 0 ? (
                      <span className="muted">{l.count}</span>
                    ) : (
                      <EditNum value={Math.abs(l.count)} onCommit={(v) => setLamp(i, { count: Math.max(1, Math.round(v)) }, t('passport.lampCount'))} step={1} min={1} width={70} />
                    )}
                  </td>
                  <td>
                    <EditNum value={l.flux} onCommit={(v) => setLamp(i, { flux: v }, t('passport.lampFlux'))} step={10} width={104} />
                  </td>
                  <td><EditText value={l.type} onCommit={(v) => setLamp(i, { type: v }, t('passport.lampType'))} /></td>
                  <td><EditText value={l.cct} onCommit={(v) => setLamp(i, { cct: v }, t('passport.lampCct'))} /></td>
                  <td><EditText value={l.cri} onCommit={(v) => setLamp(i, { cri: v }, t('passport.lampCri'))} /></td>
                  <td>
                    <EditNum value={l.watts} onCommit={(v) => setLamp(i, { watts: v }, t('passport.lampWatts'))} step={1} width={90} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!p.absolute && <p className="muted small">{t('passport.lampFluxNote')}</p>}
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
