import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { housingBox, VIEWS, type View3D } from '../../charts/body3d';
import { defaultPlanes } from '../../charts/series';
import type { Lang } from '../../core/index';
import type { ChartSettings } from '../App';
import type { OpenFile } from '../doc';
import { load, save } from '../storage';

/** three.js грузится только при первом открытии 3D. */
export const Body3D = lazy(() => import('./Body3D'));

/** Пиктограммы видов: куб и выделенная грань-проекция (XZ — передняя, YZ — боковая, XY — нижняя). */
const VIEW_ICON: Record<View3D, { face?: string }> = {
  iso: {},
  xz: { face: 'M3 7h10v10H3z' },
  yz: { face: 'M13 7l5-3v10l-5 3z' },
  xy: { face: 'M3 17h10l5-3H8z' },
};
const CUBE = 'M3 7h10v10H3zM3 7l5-3h10l-5 3M18 4v10l-5 3';

/**
 * Вид 3D — кнопки с пиктограммами поверх области построения: изометрия, XZ, YZ, XY.
 * После поворота мышью ни одна не нажата; нажатие возвращает камеру в вид.
 */
export function ViewButtons({ view, custom = false, onView }: { view: View3D; custom?: boolean; onView: (v: View3D) => void }) {
  const { t } = useTranslation();
  return (
    <div className="viewbtns" role="group" aria-label={t('b3d.view')}>
      {VIEWS.map((v) => {
        const on = !custom && v === view;
        return (
          <button key={v} className={on ? 'on' : ''} aria-pressed={on} onClick={() => onView(v)} title={t(`b3d.viewHint_${v}`)} aria-label={t(`b3d.view_${v}`)}>
            <svg viewBox="0 0 21 21" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
              {VIEW_ICON[v].face && <path d={VIEW_ICON[v].face} fill="currentColor" fillOpacity="0.35" stroke="none" />}
              <path d={CUBE} />
            </svg>
          </button>
        );
      })}
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
        <ViewButtons view={view} custom={custom} onView={(v) => { setView(v); setCustom(false); setNonce(nonce + 1); }} />
        <HousingToggle on={showHousing} available={!!housing} onToggle={setShowHousing} />
        <Suspense fallback={<Fallback height={620} />}>
          <Body3D photometry={s.asC} planes={planes} housing={showHousing ? housing : null} view={view} viewNonce={nonce} height={620} onUserMove={() => setCustom(true)} />
        </Suspense>
      </div>
    </div>
  );
}
