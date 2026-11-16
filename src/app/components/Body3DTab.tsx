import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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

/**
 * Вид 3D — «таблетка» с выпадающим списком поверх области построения. После поворота мышью
 * показывает «Произвольно»; выбор вида возвращает камеру в него.
 */
export function ViewPill({ view, custom = false, onView }: { view: View3D; custom?: boolean; onView: (v: View3D) => void }) {
  const { t } = useTranslation();
  return (
    <div className="viewpill">
      <Select value={custom ? 'custom' : view} onChange={(e) => e.target.value !== 'custom' && onView(e.target.value as View3D)} aria-label={t('b3d.view')}>
        {VIEWS.map((v) => (
          <option key={v} value={v}>{t(`b3d.view_${v}`)}</option>
        ))}
        {custom && (
          <option value="custom" disabled>
            {t('b3d.view_custom')}
          </option>
        )}
      </Select>
    </div>
  );
}

/** Показ корпуса светильника — общий для всех 3D-видов, запоминается. */
export function useHousingPref(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => load('b3d-housing', true));
  useEffect(() => {
    const f = () => setOn(load('b3d-housing', true));
    window.addEventListener('pe-housing', f);
    return () => window.removeEventListener('pe-housing', f);
  }, []);
  return [
    on,
    (v: boolean) => {
      save('b3d-housing', v);
      window.dispatchEvent(new Event('pe-housing'));
    },
  ];
}

/** Кнопка с пиктограммой «корпус светильника» в углу 3D-вида. */
export function HousingToggle({ on, available, onToggle }: { on: boolean; available: boolean; onToggle: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`housingbtn${on && available ? ' on' : ''}`}
      disabled={!available}
      aria-pressed={on && available}
      title={available ? t(on ? 'b3d.housingHide' : 'b3d.housingShow') : t('b3d.noHousing')}
      onClick={() => onToggle(!on)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {/* корпус-параллелепипед и световой поток вниз */}
        <path d="M5 6.5 12 3l7 3.5v4L12 14l-7-3.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M5 6.5 12 10l7-3.5M12 10v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9 17l-1.5 3.5M12 17.5V21M15 17l1.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        {!on && <path d="M3.5 3.5l17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      </svg>
    </button>
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
  const [showHousing, setShowHousing] = useHousingPref();
  const [custom, setCustom] = useState(false);
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
        <ViewPill view={view} custom={custom} onView={(v) => { setView(v); setCustom(false); setNonce(nonce + 1); }} />
        <HousingToggle on={showHousing} available={!!housing} onToggle={setShowHousing} />
        <Suspense fallback={<Fallback height={620} />}>
          <Body3D photometry={s.asC} planes={planes} housing={showHousing ? housing : null} view={view} viewNonce={nonce} height={620} onUserMove={() => setCustom(true)} />
        </Suspense>
      </div>
    </div>
  );
}
