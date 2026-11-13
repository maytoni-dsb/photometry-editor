import { useTranslation } from 'react-i18next';
import { formatIssue, type Dimensions, type Lang } from '../../core/index';
import { saveAs } from '../actions';
import { LuminaireDrawing } from './LuminaireDrawing';
import type { OpenFile } from '../doc';

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

export function Passport({ file }: { file: OpenFile }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const p = file.parse.photometry;
  const s = file.summary;
  const n = (x: number | null | undefined, d = 1) => num(lang, x, d);

  const dims = (d: Dimensions) => {
    if (d.shape === 'point' || (d.length === 0 && d.width === 0 && d.height === 0)) return '—';
    if (d.shape === 'circle') return `${t('passport.diameter', { d: n(d.length) })} × ${n(d.height)}`;
    return `${n(d.length)} × ${n(d.width)} × ${n(d.height)}`;
  };

  const isB = p.photometryType === 'B';
  const hName = isB ? 'H' : 'C';
  const vName = isB ? 'V' : 'γ';
  const version = p.source.format === 'IES' ? p.ies?.versionLine || 'LM-63-1986' : p.source.format === 'LDT' ? 'EULUMDAT' : '';

  const section = (title: string, items: Array<[string, React.ReactNode]>) => (
    <section className="card" key={title}>
      <h3>{title}</h3>
      <dl className="kv">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v === '' || v == null ? <span className="muted">—</span> : v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  const meta = p.meta;
  const peakCdklm = (s.peak.value * 1000) / s.referenceFlux;

  return (
    <div className="passport">
      <div className="toolbar">
        <button className="btn" onClick={() => void saveAs(file, 'ies')}>{t('passport.saveIes')}</button>
        <button className="btn" onClick={() => void saveAs(file, 'ldt')}>{t('passport.saveLdt')}</button>
      </div>

      <section className="card issues">
        <h3>{t('passport.issues')}</h3>
        {file.issues.length === 0 ? (
          <p className="ok">{t('passport.noIssues')}</p>
        ) : (
          <ul>
            {file.issues.map((iss, i) => (
              <li key={i} className={iss.severity}>
                <span className="sev">{t(`severity.${iss.severity}`)}</span>
                {formatIssue(iss, lang)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="cards">
        {section(t('passport.calc'), [
          [t('passport.flux'), `${n(s.flux.total)} ${t('unit.lm')}`],
          [t('passport.fluxDownUp'), `${n(s.dlor)} % / ${n(100 - s.dlor)} %`],
          [t('passport.reference'), `${n(s.referenceFlux)} ${t('unit.lm')} — ${t(`ref.${s.referenceKind}`)}`],
          [t('passport.peak'), t('passport.peakValue', { cd: n(s.peak.value), cdklm: n(peakCdklm), c: n(s.peak.c), g: n(s.peak.g) })],
          [t('passport.efficacy'), s.efficacy != null ? `${n(s.efficacy)} ${t('unit.lmw')}` : ''],
          [t('passport.lor'), s.lor != null ? `${n(s.lor)} %` : ''],
          ...(p.ldt ? [['', t('passport.ldtStated', { lorl: n(p.ldt.lorl), dff: n(p.ldt.dff) })] as [string, string]] : []),
        ])}

        {section(t('passport.luminaire'), [
          [t('passport.manufacturer'), meta.manufacturer],
          [t('passport.luminaireName'), meta.luminaireName],
          [t('passport.article'), meta.article],
          [t('passport.testReport'), meta.testReport],
          [t('passport.testLab'), meta.testLab],
          [t('passport.date'), meta.date],
          [t('passport.issueDate'), meta.issueDate],
          [t('passport.lampCatalog'), meta.lampCatalog],
        ])}

        {section(t('passport.photometry'), [
          [t('passport.photometryType'), p.photometryType],
          [t('passport.symmetry'), t(`sym.${p.symmetry}`)],
          [t('passport.grid'), t('passport.gridValue', {
            h: p.hAngles.length, v: p.vAngles.length, hName, vName, hRange: range(p.hAngles), vRange: range(p.vAngles),
          })],
          [t('passport.mode'), p.absolute ? t('passport.absolute') : t('passport.relative')],
          [t('passport.inputWatts'), p.inputWatts != null ? n(p.inputWatts, 2) : ''],
          ...(p.ies ? [[t('passport.multiplier'), n(p.ies.multiplier, 6)], [t('passport.tilt'), p.ies.tilt]] as Array<[string, string]> : []),
          ...(p.ldt ? [[t('passport.conversionFactor'), n(p.ldt.conversionFactor, 4)]] as Array<[string, string]> : []),
          ...(isB ? [['', <span className="muted">{t('passport.typeBNote')}</span>]] as Array<[string, React.ReactNode]> : []),
        ])}

        {section(t('passport.dims'), [
          [t('passport.dimsLuminaire'), dims(p.luminaire)],
          [t('passport.dimsLuminous'), dims(p.luminous)],
          ...(p.ldt ? [[t('passport.luminousHeights'), p.ldt.luminousHeights.map((h) => n(h)).join(' / ')]] as Array<[string, string]> : []),
        ])}

        <section className="card drawing-card">
          <h3>{t('drawing.title')}</h3>
          <LuminaireDrawing photometry={p} />
        </section>

        {section(t('passport.file'), [
          [t('passport.fileName'), file.name],
          [t('passport.format'), p.source.format],
          [t('passport.version'), version],
          [t('passport.encoding'), `${p.source.encoding}, ${p.source.lineEnding}`],
        ])}
      </div>

      <section className="card">
        <h3>{t('passport.lamps')}</h3>
        <div className="table-scroll">
          <table className="grid small">
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
                  <td>{l.count}</td>
                  <td>{n(l.flux)}</td>
                  <td>{l.type}</td>
                  <td>{l.cct}</td>
                  <td>{l.cri}</td>
                  <td>{n(l.watts, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
