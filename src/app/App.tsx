import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CATALOG_WIDTH } from '../charts/polar-catalog';
import { defaultChartOptions, type ChartOptions } from '../charts/series';
import { catalogStyle, sanitizeStyle, type ChartStyle } from '../charts/style';
import { ChartPanel } from './components/ChartPanel';
import { IntensityTable } from './components/IntensityTable';
import { Passport } from './components/Passport';
import { StyleEditor } from './components/StyleEditor';
import { openBytes, type OpenFile } from './doc';
import { loadFonts, type LoadedFonts } from './fonts';
import { LANGS } from './i18n';
import { load, save } from './storage';

type Tab = 'passport' | 'table' | 'polar' | 'linear';
const TABS: Tab[] = ['passport', 'table', 'polar', 'linear'];

/** Настройки графиков, общие для всех файлов. planes = null — плоскости по умолчанию для файла. */
export interface ChartSettings extends Omit<ChartOptions, 'planes'> {
  planes: number[] | null;
  /** Ширина линейной КСС, мм (width — ширина полярной). */
  linearWidth: number;
}

/** По умолчанию — оформление каталога MAYTONI (образец 12.11.2026). */
function initialSettings(): ChartSettings {
  const d: ChartSettings = { ...defaultChartOptions(), layout: 'catalog', width: CATALOG_WIDTH, linearWidth: 100, planes: null };
  const saved = load<Partial<ChartSettings>>('chart-settings', {});
  // настройки v0.2 (без оформления) — переходим на каталог, ширину берём новую
  const migrated = saved.layout ? saved : { ...saved, layout: undefined, width: undefined };
  const clean = Object.fromEntries(Object.entries(migrated).filter(([, v]) => v !== undefined)) as Partial<ChartSettings>;
  return { ...d, ...clean, show: { ...d.show, ...(saved.show ?? {}) }, planes: saved.planes ?? null, title: '' };
}

/** Стиль: сохранённый (v0.2.1+, с пунктиром сетки) или стиль каталога. */
function initialStyle(): ChartStyle {
  const saved = load<Record<string, unknown> | null>('chart-style', null);
  return saved && 'gridDash' in saved ? sanitizeStyle(saved) : catalogStyle();
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => load<Tab>('tab', 'passport'));
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState<ChartSettings>(initialSettings);
  const [style, setStyle] = useState<ChartStyle>(initialStyle);
  const [styleOpen, setStyleOpen] = useState(false);
  const [fonts, setFonts] = useState<LoadedFonts | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFonts().then(setFonts, (e) => setErrors((x) => [...x, String(e)]));
  }, []);
  useEffect(() => save('chart-settings', { ...settings, title: '' }), [settings]);
  useEffect(() => save('chart-style', style), [style]);
  useEffect(() => save('tab', tab), [tab]);
  // шрифт в стиле — тот, что реально загружен
  useEffect(() => {
    if (fonts && style.font.family !== fonts.family) setStyle((s) => ({ ...s, font: { ...s.font, family: fonts.family } }));
  }, [fonts, style.font.family]);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const arr = [...list].filter((f) => /\.(ies|ldt)$/i.test(f.name));
    const opened: OpenFile[] = [];
    const errs: string[] = [];
    for (const f of arr) {
      try {
        opened.push(openBytes(f.name, new Uint8Array(await f.arrayBuffer())));
      } catch (e) {
        errs.push(t('error.read', { name: f.name, msg: (e as Error).message }));
      }
    }
    setErrors(errs);
    if (opened.length) {
      setFiles((prev) => [...prev, ...opened]);
      setActiveId(opened[0].id);
    }
  }, [t]);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  const close = (id: string) => {
    setFiles((prev) => {
      const i = prev.findIndex((f) => f.id === id);
      const next = prev.filter((f) => f.id !== id);
      if (id === activeId) setActiveId(next[Math.min(i, next.length - 1)]?.id ?? null);
      return next;
    });
  };

  const active = files.find((f) => f.id === activeId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <circle cx="16" cy="12" r="9" fill="none" stroke="var(--accent)" strokeWidth="3" />
            <path d="M16 21v8" stroke="var(--accent-2)" strokeWidth="3" />
          </svg>
          <span>{t('app.title')}</span>
        </div>
        <div className="topbar-actions">
          <button className="btn primary" onClick={() => inputRef.current?.click()}>{t('app.open')}</button>
          <input
            ref={inputRef}
            type="file"
            accept=".ies,.ldt,.IES,.LDT"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button className="btn" onClick={() => setStyleOpen(true)}>{t('app.style')}</button>
          <select aria-label={t('app.language')} value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="banner error" role="alert">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
          <button className="link" onClick={() => setErrors([])}>×</button>
        </div>
      )}

      <div className="body">
        {files.length > 0 && (
          <aside className="sidebar">
            <div className="sidebar-head">
              <span>{t('files.title')} ({files.length})</span>
              <button className="link" onClick={() => { setFiles([]); setActiveId(null); }}>{t('files.closeAll')}</button>
            </div>
            <ul className="filelist">
              {files.map((f) => {
                const worst = f.issues[0]?.severity;
                return (
                  <li key={f.id} className={f.id === activeId ? 'active' : ''}>
                    <button className="file-item" onClick={() => setActiveId(f.id)} title={f.name}>
                      <span className={`fmt fmt-${f.parse.photometry.source.format.toLowerCase()}`}>{f.parse.photometry.source.format}</span>
                      <span className="fname">{f.name}</span>
                      {worst && worst !== 'info' && <span className={`dot ${worst}`} title={t('files.issues', { count: f.issues.length })} />}
                    </button>
                    <button className="close" aria-label={t('files.close')} onClick={() => close(f.id)}>×</button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}

        <main className="main">
          {!active ? (
            <div className="empty" onClick={() => inputRef.current?.click()}>
              <div className="empty-art" aria-hidden="true">
                <svg viewBox="0 0 120 80" width="160">
                  <path d="M10 10 A50 50 0 0 0 110 10" fill="none" stroke="var(--line)" strokeWidth="1" />
                  <path d="M35 10 A25 25 0 0 0 85 10" fill="none" stroke="var(--line)" strokeWidth="1" />
                  <path d="M60 10 C40 40 44 62 60 64 C76 62 80 40 60 10" fill="none" stroke="var(--accent)" strokeWidth="2" />
                  <path d="M60 10 C30 30 38 52 60 54 C82 52 90 30 60 10" fill="none" stroke="var(--accent-2)" strokeWidth="2" strokeDasharray="4 2" />
                </svg>
              </div>
              <h1>{t('drop.title')}</h1>
              <p>{t('drop.hint')}</p>
              <p className="muted">{t('app.privacy')}</p>
            </div>
          ) : (
            <>
              <nav className="tabs" role="tablist">
                {TABS.map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
                    {t(`tabs.${k}`)}
                  </button>
                ))}
                <span className="tabs-file" title={active.name}>{active.name}</span>
              </nav>
              <div className="tab-body">
                {tab === 'passport' && <Passport file={active} />}
                {tab === 'table' && <IntensityTable file={active} />}
                {(tab === 'polar' || tab === 'linear') && (
                  <ChartPanel
                    kind={tab}
                    file={active}
                    settings={settings}
                    onSettings={setSettings}
                    style={style}
                    onStyle={setStyle}
                    fonts={fonts}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {styleOpen && (
        <StyleEditor
          style={style}
          onChange={setStyle}
          fonts={fonts}
          onFonts={setFonts}
          onClose={() => setStyleOpen(false)}
        />
      )}
      {dragging && <div className="drop-overlay">{t('drop.overlay')}</div>}
    </div>
  );
}
