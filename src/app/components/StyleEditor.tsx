import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Color } from '../../charts/scene';
import { defaultStyle, hexToRgb, naiveCmyk, rgbHex, sanitizeStyle, STYLE_PRESETS, type ChartStyle } from '../../charts/style';
import { clearCustomFont, loadFonts, setCustomFont, type LoadedFonts } from '../fonts';
import { saveFile, safeFileName } from '../save-file';

interface Props {
  style: ChartStyle;
  onChange: (s: ChartStyle) => void;
  fonts: LoadedFonts | null;
  onFonts: (f: LoadedFonts) => void;
  onClose: () => void;
}

function ColorRow({ label, value, onChange, extra }: { label: string; value: Color; onChange: (c: Color) => void; extra?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="color-row">
      <span className="color-label">{label}</span>
      <input
        type="color"
        value={rgbHex(value)}
        onChange={(e) => {
          const rgb = hexToRgb(e.target.value);
          if (rgb) onChange({ ...value, rgb });
        }}
        aria-label={`${label} RGB`}
      />
      <code className="hex">{rgbHex(value).toUpperCase()}</code>
      <span className="cmyk">
        {(['C', 'M', 'Y', 'K'] as const).map((ch, i) => (
          <label key={ch}>
            {ch}
            <input
              type="number"
              min={0}
              max={100}
              value={value.cmyk[i]}
              onChange={(e) => {
                const cmyk = [...value.cmyk] as Color['cmyk'];
                cmyk[i] = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                onChange({ ...value, cmyk });
              }}
            />
          </label>
        ))}
      </span>
      <button className="link small" onClick={() => onChange({ ...value, cmyk: naiveCmyk(value.rgb) })} title={t('style.fromRgb')}>
        ⇣CMYK
      </button>
      {extra}
    </div>
  );
}

export function StyleEditor({ style, onChange, fonts, onFonts, onClose }: Props) {
  const { t } = useTranslation();
  const fontInput = useRef<HTMLInputElement>(null);
  const styleInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const s = style;
  const set = (patch: Partial<ChartStyle>) => onChange({ ...s, ...patch });
  const setColors = (patch: Partial<ChartStyle['colors']>) => set({ colors: { ...s.colors, ...patch } });
  const numIn = (v: number, on: (x: number) => void, step = 0.05, min = 0.01, max = 30) => (
    <input type="number" step={step} min={min} max={max} value={v} onChange={(e) => { const x = Number(e.target.value); if (Number.isFinite(x) && x >= min) on(Math.min(max, x)); }} />
  );

  const uploadFont = async (f: File) => {
    try {
      const loaded = await setCustomFont(new Uint8Array(await f.arrayBuffer()));
      onFonts(loaded);
      setMsg(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const importStyle = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data !== 'object' || !('colors' in data)) throw new Error(t('style.badFile'));
      onChange(sanitizeStyle(data));
      setMsg(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={t('style.title')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('style.title')}</h2>
          <button className="link" onClick={onClose} aria-label={t('style.close')}>×</button>
        </header>
        <div className="modal-body">
          <div className="form-grid">
            <label>{t('style.preset')}</label>
            <select
              value=""
              onChange={(e) => {
                const pr = STYLE_PRESETS.find((x) => x.id === e.target.value);
                if (pr) {
                  const n = pr.make();
                  onChange({ ...n, font: { ...n.font, family: s.font.family } });
                }
              }}
            >
              <option value="">…</option>
              {STYLE_PRESETS.map((x) => (
                <option key={x.id} value={x.id}>{t(`style.preset${x.id[0].toUpperCase()}${x.id.slice(1)}`)}</option>
              ))}
            </select>
            <label>{t('style.name')}</label>
            <input type="text" value={s.name} onChange={(e) => set({ name: e.target.value })} />
          </div>

          <fieldset>
            <legend>{t('style.font')}</legend>
            <div className="row">
              <strong>{fonts?.custom ? t('style.fontCustom', { name: fonts.family }) : t('style.fontBuiltin')}</strong>
              <button className="btn small" onClick={() => fontInput.current?.click()}>{t('style.fontUpload')}</button>
              {fonts?.custom && (
                <button className="link small" onClick={async () => { clearCustomFont(); onFonts(await loadFonts()); }}>{t('style.fontReset')}</button>
              )}
              <input ref={fontInput} type="file" accept=".ttf,.otf,.woff" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFont(f); e.target.value = ''; }} />
            </div>
            <div className="row">
              <span>{t('style.sizes')}:</span>
              <label>{t('style.sizeTitle')} {numIn(s.font.title, (x) => set({ font: { ...s.font, title: x } }), 0.5, 3)}</label>
              <label>{t('style.sizeLabel')} {numIn(s.font.label, (x) => set({ font: { ...s.font, label: x } }), 0.5, 3)}</label>
              <label>{t('style.sizeTick')} {numIn(s.font.tick, (x) => set({ font: { ...s.font, tick: x } }), 0.5, 3)}</label>
            </div>
          </fieldset>

          <fieldset>
            <legend>{t('style.colors')}</legend>
            <ColorRow label={t('style.colorText')} value={s.colors.text} onChange={(c) => setColors({ text: c })} />
            <ColorRow label={t('style.colorGrid')} value={s.colors.grid} onChange={(c) => setColors({ grid: c })} />
            <ColorRow label={t('style.colorGridMajor')} value={s.colors.gridMajor} onChange={(c) => setColors({ gridMajor: c })} />
            <div className="color-row">
              <span className="color-label">{t('style.colorBackground')}</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.colors.background === null}
                  onChange={(e) => setColors({ background: e.target.checked ? null : { rgb: [255, 255, 255], cmyk: [0, 0, 0, 0] } })}
                />
                {t('style.transparent')}
              </label>
            </div>
            {s.colors.background && <ColorRow label="" value={s.colors.background} onChange={(c) => setColors({ background: c })} />}
            <div className="color-row">
              <span className="color-label">{t('style.fill')}</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.colors.fill === null}
                  onChange={(e) => setColors({ fill: e.target.checked ? null : { rgb: [255, 255, 204], cmyk: [0, 0, 20, 0] } })}
                />
                {t('style.noFill')}
              </label>
            </div>
            {s.colors.fill && <ColorRow label="" value={s.colors.fill} onChange={(c) => setColors({ fill: c })} />}
            {s.colors.series.map((c, i) => (
              <ColorRow
                key={i}
                label={t('style.colorSeries', { n: i + 1 })}
                value={c}
                onChange={(nc) => setColors({ series: s.colors.series.map((x, j) => (j === i ? nc : x)) })}
                extra={
                  <input
                    key={(s.dashes[i] ?? []).join(' ')}
                    className="dash"
                    type="text"
                    title={t('style.dashHint')}
                    placeholder={t('style.dash')}
                    defaultValue={(s.dashes[i] ?? []).join(' ')}
                    onBlur={(e) => {
                      const d = e.target.value.trim().split(/[\s;]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => Number.isFinite(x) && x > 0);
                      const dashes = [...s.dashes];
                      while (dashes.length <= i) dashes.push([]);
                      dashes[i] = d;
                      set({ dashes });
                    }}
                  />
                }
              />
            ))}
          </fieldset>

          <fieldset>
            <legend>{t('style.widths')}</legend>
            <div className="row">
              <label>{t('style.widthCurve')} {numIn(s.widths.curve, (x) => set({ widths: { ...s.widths, curve: x } }))}</label>
              <label>{t('style.widthGrid')} {numIn(s.widths.grid, (x) => set({ widths: { ...s.widths, grid: x } }))}</label>
              <label>{t('style.widthGridMajor')} {numIn(s.widths.gridMajor, (x) => set({ widths: { ...s.widths, gridMajor: x } }))}</label>
            </div>
            <div className="row">
              <label>
                {t('style.gridDash')}{' '}
                <input
                  key={s.gridDash.join(' ')}
                  className="dash"
                  type="text"
                  title={t('style.dashHint')}
                  defaultValue={s.gridDash.map((v) => Math.round(v * 1000) / 1000).join(' ')}
                  onBlur={(e) => {
                    const d = e.target.value.trim().split(/[\s;]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => Number.isFinite(x) && x > 0);
                    set({ gridDash: d });
                  }}
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>{t('style.grid')}</legend>
            <div className="row">
              <label>
                {t('style.angleStep')}{' '}
                <select value={s.grid.angleStep} onChange={(e) => set({ grid: { ...s.grid, angleStep: Number(e.target.value) } })}>
                  {[5, 10, 15, 30].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>
                {t('style.labelEvery')}{' '}
                <select value={s.grid.angleLabelEvery} onChange={(e) => set({ grid: { ...s.grid, angleLabelEvery: Number(e.target.value) } })}>
                  {[1, 2, 3, 6].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            </div>
          </fieldset>

          {msg && <p className="error small">{msg}</p>}
        </div>
        <footer>
          <button className="btn" onClick={() => styleInput.current?.click()}>{t('style.import')}</button>
          <input ref={styleInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importStyle(f); e.target.value = ''; }} />
          <button className="btn" onClick={() => void saveFile(`${safeFileName(s.name)}.style.json`, 'application/json', 'json', () => JSON.stringify(s, null, 2))}>
            {t('style.export')}
          </button>
          <button className="btn" onClick={() => onChange({ ...defaultStyle(), font: { ...defaultStyle().font, family: s.font.family } })}>{t('style.reset')}</button>
          <span className="grow" />
          <button className="btn primary" onClick={onClose}>{t('style.close')}</button>
        </footer>
      </div>
    </div>
  );
}
