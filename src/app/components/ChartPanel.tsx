import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fontMeasure } from '../../charts/fonts';
import { buildLinear } from '../../charts/linear';
import { buildPolar } from '../../charts/polar';
import { CATALOG_WIDTH } from '../../charts/polar-catalog';
import { renderSvg } from '../../charts/render-svg';
import { approxTextWidth } from '../../charts/scene';
import { defaultPlanes, type IntensityUnit } from '../../charts/series';
import { catalogStyle, type ChartStyle } from '../../charts/style';
import type { ColorMode } from '../../charts/vector';
import type { Lang } from '../../core/issues';
import type { ChartSettings } from '../App';
import { baseName, type OpenFile } from '../doc';
import type { LoadedFonts } from '../fonts';
import { LANGS } from '../i18n';
import { safeFileName, saveFile } from '../save-file';
import { load, save } from '../storage';

interface Props {
  kind: 'polar' | 'linear';
  file: OpenFile;
  settings: ChartSettings;
  onSettings: (s: ChartSettings) => void;
  style: ChartStyle;
  onStyle: (s: ChartStyle) => void;
  fonts: LoadedFonts | null;
}

/** Ширина превью на экране, пикселей на миллиметр. */
const PX_PER_MM = 6.5;

export function ChartPanel({ kind, file, settings, onSettings, style, onStyle, fonts }: Props) {
  const { t } = useTranslation();
  const p = file.parse.photometry;
  const axial = file.summary.asC.symmetry === 'axial' || file.summary.asC.hAngles.length === 1;
  const planes = settings.planes ?? defaultPlanes(p);
  const [newPlane, setNewPlane] = useState('45');
  const [color, setColor] = useState<ColorMode>(() => load<ColorMode>('export-color', 'rgb'));
  const [textAsPaths, setTextAsPaths] = useState(() => load('export-text-paths', false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<ChartSettings>) => onSettings({ ...settings, ...patch });
  const catalog = kind === 'polar' && settings.layout === 'catalog';

  const measure = useMemo(() => (fonts ? fontMeasure(fonts.set) : approxTextWidth), [fonts]);
  const scene = useMemo(() => {
    const opts = { ...settings, planes, width: kind === 'polar' ? settings.width : settings.linearWidth };
    return kind === 'polar' ? buildPolar(p, file.summary, opts, style, measure) : buildLinear(p, file.summary, opts, style, measure);
  }, [kind, p, file.summary, settings, planes, style, measure]);
  const svg = useMemo(() => renderSvg(scene), [scene]);

  const fileBase = safeFileName(`${baseName(file.name)}_${kind}`);

  const doExport = async (fmt: 'svg' | 'pdf' | 'eps') => {
    setError(null);
    setBusy(true);
    try {
      const mime = fmt === 'svg' ? 'image/svg+xml' : fmt === 'pdf' ? 'application/pdf' : 'application/postscript';
      const suffix = fmt !== 'svg' && color === 'cmyk' ? '_cmyk' : '';
      await saveFile(`${fileBase}${suffix}.${fmt}`, mime, fmt, async () => {
        if (fmt === 'svg') return renderSvg(scene, { xmlDeclaration: true });
        if (!fonts) throw new Error(t('export.fontLoading'));
        const o = { color, fonts: fonts.set, textAsPaths };
        // PDF и EPS-рендеры (pdf-lib) грузятся только при первом экспорте
        if (fmt === 'pdf') return (await import('../../charts/render-pdf')).renderPdf(scene, o);
        return (await import('../../charts/render-eps')).renderEps(scene, o);
      });
    } catch (e) {
      setError(t('export.error', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const addPlane = () => {
    const v = Number(newPlane.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    const c = ((v % 180) + 180) % 180;
    if (!planes.some((x) => Math.abs(x - c) < 1e-6) && planes.length < 6) set({ planes: [...planes, c].sort((a, b) => a - b) });
  };

  return (
    <div className="chart-view">
      <aside className="chart-settings">
        <h3>{t('chart.settings')}</h3>

        <fieldset>
          <legend>{t('chart.planes')}</legend>
          {axial ? (
            <p className="muted small">{t('chart.axialNote')}</p>
          ) : (
            <>
              <div className="chips">
                {planes.map((c) => (
                  <span key={c} className="chip">
                    C{c}–C{(c + 180) % 360}
                    {planes.length > 1 && (
                      <button aria-label={t('chart.removePlane')} onClick={() => set({ planes: planes.filter((x) => x !== c) })}>×</button>
                    )}
                  </span>
                ))}
              </div>
              <div className="row">
                <span className="prefix">C</span>
                <input type="number" min={0} max={179} step={1} value={newPlane} onChange={(e) => setNewPlane(e.target.value)} className="w-num" />
                <button className="btn small" onClick={addPlane} disabled={planes.length >= 6}>{t('chart.addPlane')}</button>
                {settings.planes && <button className="link small" onClick={() => set({ planes: null })}>↺</button>}
              </div>
            </>
          )}
        </fieldset>

        <div className="form-grid">
          {kind === 'polar' && (
            <>
              <label>{t('chart.layout')}</label>
              <select
                value={settings.layout}
                onChange={(e) => {
                  const layout = e.target.value as ChartSettings['layout'];
                  // ширина по умолчанию для оформления
                  const width = layout === 'catalog' ? (settings.width > 60 ? CATALOG_WIDTH : settings.width) : settings.width < 60 ? 100 : settings.width;
                  set({ layout, width });
                }}
              >
                <option value="catalog">{t('chart.layoutCatalog')}</option>
                <option value="standard">{t('chart.layoutStandard')}</option>
              </select>
            </>
          )}

          <label>{t('chart.unit')}</label>
          <select value={settings.unit} onChange={(e) => set({ unit: e.target.value as IntensityUnit })}>
            <option value="cdklm">{t('unit.cdklm')}</option>
            <option value="cd">{t('unit.cd')}</option>
          </select>

          <label>{t('chart.scale')}</label>
          <input
            type="number"
            min={0}
            placeholder={t('chart.scaleAuto')}
            value={settings.scaleMax ?? ''}
            onChange={(e) => set({ scaleMax: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) || null })}
          />

          <label>{t('chart.range')}</label>
          <select value={settings.range} onChange={(e) => set({ range: e.target.value as ChartSettings['range'] })}>
            <option value="auto">{t('chart.rangeAuto')}</option>
            <option value="lower">{t('chart.rangeLower')}</option>
            <option value="full">{t('chart.rangeFull')}</option>
          </select>

          <label>{t('chart.cSide')}</label>
          <select value={settings.cSide} onChange={(e) => set({ cSide: e.target.value as 'right' | 'left' })}>
            <option value="right">{t('chart.cRight')}</option>
            <option value="left">{t('chart.cLeft')}</option>
          </select>

          <label>{t('chart.labelLang')}</label>
          <select value={settings.lang} onChange={(e) => set({ lang: e.target.value as Lang })}>
            {LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>

          <label>{t('chart.width')}</label>
          {kind === 'polar' ? (
            <input type="number" min={20} max={400} step={0.1} value={settings.width} onChange={(e) => set({ width: Math.min(400, Math.max(20, Number(e.target.value) || CATALOG_WIDTH)) })} />
          ) : (
            <input type="number" min={40} max={400} value={settings.linearWidth} onChange={(e) => set({ linearWidth: Math.min(400, Math.max(40, Number(e.target.value) || 100)) })} />
          )}

          {kind === 'linear' && (
            <>
              <label>{t('chart.height')}</label>
              <input type="number" min={15} max={400} value={settings.height} onChange={(e) => set({ height: Math.min(400, Math.max(15, Number(e.target.value) || 60)) })} />
            </>
          )}

          <label>{t('chart.titleText')}</label>
          <input type="text" placeholder={t('chart.titlePlaceholder')} value={settings.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
        </div>

        <fieldset>
          <legend>{t('chart.show')}</legend>
          {(catalog ? (['title'] as const) : (['title', 'info', 'legend'] as const)).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={settings.show[k]} onChange={(e) => set({ show: { ...settings.show, [k]: e.target.checked } })} />
              {t(`chart.show${k[0].toUpperCase()}${k.slice(1)}`)}
            </label>
          ))}
        </fieldset>

        {catalog && (
          <div className="note small">
            <p className="muted">{t('chart.catalogNote')}</p>
            {!style.colors.fill && (
              <button className="btn small" onClick={() => onStyle({ ...catalogStyle(), font: { ...catalogStyle().font, family: style.font.family } })}>
                {t('chart.applyCatalogStyle')}
              </button>
            )}
          </div>
        )}

        <fieldset className="export">
          <legend>{t('export.title')}</legend>
          <div className="row">
            <label>{t('export.color')}</label>
            <div className="seg">
              {(['rgb', 'cmyk'] as const).map((m) => (
                <button key={m} className={color === m ? 'on' : ''} onClick={() => { setColor(m); save('export-color', m); }}>{m.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={textAsPaths} onChange={(e) => { setTextAsPaths(e.target.checked); save('export-text-paths', e.target.checked); }} />
            {t('export.textAsPaths')}
          </label>
          <div className="row export-buttons">
            <button className="btn" disabled={busy} onClick={() => void doExport('svg')} title={t('export.svgRgb')}>SVG</button>
            <button className="btn" disabled={busy || !fonts} onClick={() => void doExport('pdf')}>PDF</button>
            <button className="btn" disabled={busy || !fonts} onClick={() => void doExport('eps')}>EPS</button>
          </div>
          {!fonts && <p className="muted small">{t('export.fontLoading')}</p>}
          {busy && <p className="muted small">{t('export.busy')}</p>}
          {error && <p className="error small">{error}</p>}
        </fieldset>
      </aside>

      <div className="chart-stage">
        {/* узкие графики (каталог 39 мм) показываем крупнее, но не шире 600 px */}
        <div className="paper" style={{ width: Math.max(scene.width * PX_PER_MM, Math.min(600, scene.width * 15)) }} dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="muted small center">{t('chart.size', { w: Math.round(scene.width), h: Math.round(scene.height) })}</p>
      </div>
    </div>
  );
}
