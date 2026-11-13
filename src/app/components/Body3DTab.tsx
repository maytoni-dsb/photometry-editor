import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RAMP_CSS, VIEWS, type View3D } from '../../charts/body3d';
import { defaultPlanes } from '../../charts/series';
import type { Lang } from '../../core/index';
import type { ChartSettings } from '../App';
import type { OpenFile } from '../doc';
import { load, save } from '../storage';

/** three.js грузится только при первом открытии 3D. */
export const Body3D = lazy(() => import('./Body3D'));

/** Кнопки видов камеры — общие для вкладки и предпросмотра операций. */
export function ViewButtons({ onView }: { onView: (v: View3D) => void }) {
  const { t } = useTranslation();
  return (
    <div className="row b3d-views">
      {VIEWS.map((v) => (
        <button key={v} className="btn small" onClick={() => onView(v)} title={t(`b3d.viewHint_${v}`)}>
          {t(`b3d.view_${v}`)}
        </button>
      ))}
    </div>
  );
}

export function RampLegend() {
  const { t } = useTranslation();
  return (
    <div className="b3d-legend">
      <div className="b3d-ramp" style={{ background: RAMP_CSS }} />
      <div className="b3d-ramp-labels muted small">
        <span>0</span>
        <span>50 %</span>
        <span>{t('b3d.peak')}</span>
      </div>
    </div>
  );
}

export function Fallback({ height }: { height: number }) {
  const { t } = useTranslation();
  return <div className="b3d b3d-loading muted" style={{ height }}>{t('b3d.loading')}</div>;
}

export function Body3DTab({ file, settings }: { file: OpenFile; settings: ChartSettings }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const [view, setView] = useState<View3D>('iso');
  const [nonce, setNonce] = useState(0);
  const [wire, setWire] = useState(() => load('b3d-wire', false));
  const s = file.summary;
  const planes = settings.planes ?? defaultPlanes(file.parse.photometry);
  const n = (x: number, d = 0) => x.toLocaleString(lang, { maximumFractionDigits: d });

  return (
    <div className="chart-view">
      <aside className="chart-settings">
        <h3>{t('b3d.title')}</h3>
        <fieldset>
          <legend>{t('b3d.view')}</legend>
          <ViewButtons onView={(v) => { setView(v); setNonce(nonce + 1); }} />
          <p className="muted small">{t('b3d.mouse')}</p>
        </fieldset>
        <fieldset>
          <label className="check">
            <input type="checkbox" checked={wire} onChange={(e) => { setWire(e.target.checked); save('b3d-wire', e.target.checked); }} />
            {t('b3d.wireframe')}
          </label>
          <p className="muted small">{t('b3d.planesNote', { planes: planes.map((c) => `C${c}–C${(c + 180) % 360}`).join(', ') })}</p>
        </fieldset>
        <fieldset>
          <legend>{t('b3d.colors')}</legend>
          <RampLegend />
          <p className="muted small">
            Iₘₐₓ = {n(s.peak.value)} {t('unit.cd')} · C{n(s.peak.c, 1)} γ{n(s.peak.g, 1)}° · Φ = {n(s.flux.total)} {t('unit.lm')}
          </p>
          <p className="muted small">{t('b3d.note')}</p>
        </fieldset>
      </aside>
      <div className="chart-stage b3d-stage">
        <Suspense fallback={<Fallback height={620} />}>
          <Body3D photometry={s.asC} planes={planes} wireframe={wire} view={view} viewNonce={nonce} height={620} />
        </Suspense>
      </div>
    </div>
  );
}
