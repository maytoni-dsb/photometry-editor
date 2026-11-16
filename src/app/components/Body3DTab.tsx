import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select';
import { housingBox, VIEWS, type View3D } from '../../charts/body3d';
import { defaultPlanes } from '../../charts/series';
import type { Lang } from '../../core/index';
import type { ChartSettings } from '../App';
import type { OpenFile } from '../doc';
import { load, save } from '../storage';

/** three.js грузится только при первом открытии 3D. */
export const Body3D = lazy(() => import('./Body3D'));

/** Кнопки видов камеры — общие для вкладки и предпросмотра операций. */
/** Вид 3D — «таблетка» с выпадающим списком поверх области построения. */
export function ViewPill({ view, onView }: { view: View3D; onView: (v: View3D) => void }) {
  const { t } = useTranslation();
  return (
    <div className="viewpill">
      <Select value={view} onChange={(e) => onView(e.target.value as View3D)} aria-label={t('b3d.view')}>
        {VIEWS.map((v) => (
          <option key={v} value={v}>{t(`b3d.view_${v}`)}</option>
        ))}
      </Select>
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
  const [showHousing, setShowHousing] = useState(() => load('b3d-housing', true));
  const housing = useMemo(() => housingBox(file.parse.photometry), [file.parse.photometry]);
  const s = file.summary;
  const planes = settings.planes ?? defaultPlanes(file.parse.photometry);
  const n = (x: number, d = 0) => x.toLocaleString(lang, { maximumFractionDigits: d });

  return (
    <div className="chart-view">
      <aside className="chart-settings">
        <h3>{t('b3d.title')}</h3>
        <p className="muted small">{t('b3d.mouse')}</p>
        <fieldset>
          <label className="check">
            <input type="checkbox" checked={showHousing} disabled={!housing} onChange={(e) => { setShowHousing(e.target.checked); save('b3d-housing', e.target.checked); }} />
            {t('b3d.housing')}
          </label>
          <p className="muted small">{housing ? t('b3d.housingNote') : t('b3d.noHousing')}</p>
          <p className="muted small">{t('b3d.planesNote', { planes: planes.map((c) => `C${c}–C${(c + 180) % 360}`).join(', ') })}</p>
        </fieldset>
        <fieldset>
          <p className="muted small">
            Iₘₐₓ = {n(s.peak.value)} {t('unit.cd')} · C{n(s.peak.c, 1)} γ{n(s.peak.g, 1)}° · Φ = {n(s.flux.total)} {t('unit.lm')}
          </p>
          <p className="muted small">{t('b3d.note')}</p>
        </fieldset>
      </aside>
      <div className="chart-stage b3d-stage b3d-wrap">
        <ViewPill view={view} onView={(v) => { setView(v); setNonce(nonce + 1); }} />
        <Suspense fallback={<Fallback height={620} />}>
          <Body3D photometry={s.asC} planes={planes} housing={showHousing ? housing : null} view={view} viewNonce={nonce} height={620} />
        </Suspense>
      </div>
    </div>
  );
}
