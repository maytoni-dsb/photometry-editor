import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CATALOG_WIDTH } from '../charts/polar-catalog';
import { defaultChartOptions, type ChartOptions } from '../charts/series';
import { catalogStyle, sanitizeStyle, STYLE_PRESETS, type ChartStyle } from '../charts/style';
import { requestChartExport, saveAs } from './actions';
import { About } from './components/About';
import { MenuBar, type Menu, type MenuItem } from './components/MenuBar';
import { ChartPanel, layoutPatch } from './components/ChartPanel';
import { IntensityTable } from './components/IntensityTable';
import { Passport } from './components/Passport';
import { MaytoniLogo } from './components/MaytoniLogo';
import { StyleEditor } from './components/StyleEditor';
import { OpsPanel, opLabel, OP_KINDS, type OpKind } from './components/OpsPanel';
import { applyStep, isModified, jumpTo, newDoc, openBytes, redo, undo, type OpenFile } from './doc';
import { applyOp, OpError, type Issue, type MirrorPlane, type OpSpec, type Photometry } from '../core/index';
import { loadFonts, type LoadedFonts } from './fonts';
import { LANGS } from './i18n';
import { load, save } from './storage';

type Tab = 'passport' | 'table' | 'polar' | 'linear' | 'ops';
type Theme = 'system' | 'light' | 'dark';
const TABS: Tab[] = ['passport', 'table', 'polar', 'linear', 'ops'];

/** Настройки графиков, общие для всех файлов. planes = null — плоскости по умолчанию для файла. */
export interface ChartSettings extends Omit<ChartOptions, 'planes'> {
  planes: number[] | null;
  /** Ширина линейной КСС, мм (width — ширина полярной). */
  linearWidth: number;
}

/** По умолчанию — оформление каталога MAYTONI (образец 12.11.2026). */
function initialSettings(): ChartSettings {
  const d: ChartSettings = { ...defaultChartOptions(), layout: 'catalog', width: CATALOG_WIDTH, linearWidth: CATALOG_WIDTH, planes: null };
  const saved = load<Partial<ChartSettings>>('chart-settings', {});
  // настройки v0.2 (без оформления) — переходим на каталог, ширину берём новую
  const migrated = saved.layout ? saved : { ...saved, layout: undefined, width: undefined };
  const clean = Object.fromEntries(Object.entries(migrated).filter(([, v]) => v !== undefined)) as Partial<ChartSettings>;
  return { ...d, ...clean, show: { ...d.show, ...(saved.show ?? {}) }, planes: saved.planes ?? null, title: '' };
}

/** Стиль: сохранённый (v0.2.1+, с пунктиром сетки) или стиль каталога. */
function initialStyle(): ChartStyle {
  const saved = load<Record<string, unknown> | null>('chart-style', null);
  if (!saved || !('gridDash' in saved)) return catalogStyle();
  // стиль каталога из v0.3 без цвета перекрытия — обновляем до текущего
  const colors = saved.colors as Record<string, unknown> | undefined;
  if (saved.name === catalogStyle().name && colors && !('fillOverlap' in colors)) return catalogStyle();
  return sanitizeStyle(saved);
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(() => load('show-files', true));
  const [theme, setTheme] = useState<Theme>(() => load<Theme | null>('theme', null) ?? 'system');
  const [opKind, setOpKind] = useState<OpKind>('normalize');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFonts().then(setFonts, (e) => setErrors((x) => [...x, String(e)]));
  }, []);
  useEffect(() => save('chart-settings', { ...settings, title: '' }), [settings]);
  useEffect(() => save('chart-style', style), [style]);
  useEffect(() => save('tab', tab), [tab]);
  // несохранённые изменения — браузер переспросит при закрытии вкладки
  const anyModified = files.some(isModified);
  useEffect(() => {
    if (!anyModified) return;
    const on = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [anyModified]);
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

  // ——— операции и история (этап 4)
  const updateFile = (id: string, fn: (f: OpenFile) => OpenFile) => setFiles((prev) => prev.map((f) => (f.id === id ? fn(f) : f)));
  const applyToActive = (p: Photometry, issues: Issue[], label: string, spec: OpSpec) => {
    if (active) updateFile(active.id, (f) => applyStep(f, p, issues, label, spec));
  };
  /** Быстрая команда меню: операция сразу применяется к активному файлу (отменяется Ctrl+Z). */
  const quickOp = (spec: OpSpec) => {
    if (!active) return;
    try {
      const r = applyOp(active.parse.photometry, spec);
      applyToActive(r.photometry, r.issues, opLabel(t, i18n.language, spec), spec);
    } catch (e) {
      setErrors([e instanceof OpError ? t(`ops.err.${e.code}`, e.params) : String(e)]);
    }
  };
  const createDoc = (name: string, p: Photometry, issues: Issue[], label: string) => {
    const d = newDoc(name, p, issues, label);
    setFiles((prev) => [...prev, d]);
    setActiveId(d.id);
  };
  const doUndo = () => active && updateFile(active.id, undo);
  const doRedo = () => active && updateFile(active.id, redo);
  const jump = (i: number) => {
    if (!active) return;
    updateFile(active.id, (f) => {
      if (i <= f.past.length) return jumpTo(f, i);
      let g = f;
      while (g.past.length < i && g.future.length) g = redo(g);
      return g;
    });
  };
  const openOp = (k: OpKind) => {
    setOpKind(k);
    setTab('ops');
  };

  // тема: system — как в системе, light / dark — выбрана явно
  const applyTheme = (th: Theme) => {
    setTheme(th);
    save('theme', th === 'system' ? null : th);
    if (th === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = th;
  };
  const toggleTheme = () => {
    const dark = theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : theme === 'dark';
    applyTheme(dark ? 'light' : 'dark');
  };

  const openDialog = () => inputRef.current?.click();
  const closeAll = () => {
    setFiles([]);
    setActiveId(null);
  };
  const step = (d: number) => {
    if (!files.length) return;
    const i = Math.max(0, files.findIndex((f) => f.id === activeId));
    setActiveId(files[(i + d + files.length) % files.length].id);
  };
  const isChart = !!active && (tab === 'polar' || tab === 'linear');
  const applyPreset = (id: string) => {
    const pr = STYLE_PRESETS.find((x) => x.id === id);
    if (pr) {
      const n = pr.make();
      setStyle({ ...n, font: { ...n.font, family: style.font.family } });
    }
  };

  // горячие клавиши (Ctrl на Windows / Linux, ⌘ на Mac)
  const hotkeys = useRef<(e: KeyboardEvent) => void>(() => {});
  hotkeys.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const target = e.target as HTMLElement;
    // в полях ввода клавиши работают как обычно (кроме скрытого выбора файлов и флажков)
    if (target.matches?.('input:not([type=file]):not([type=checkbox]), select, textarea')) return;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openDialog();
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
    } else if (mod && !e.shiftKey && ['1', '2', '3', '4', '5'].includes(e.key) && active) {
      e.preventDefault();
      setTab(TABS[Number(e.key) - 1]);
    } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'F1') {
      e.preventDefault();
      setAboutOpen(true);
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => hotkeys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const menus: Menu[] = [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        { label: t('menu.open'), shortcut: `${mod}O`, onClick: openDialog },
        'sep',
        { label: t('passport.saveIes'), disabled: !active, onClick: () => active && void saveAs(active, 'ies') },
        { label: t('passport.saveLdt'), disabled: !active, onClick: () => active && void saveAs(active, 'ldt') },
        'sep',
        {
          label: t('menu.exportChart'),
          disabled: !isChart,
          submenu: [
            { label: 'SVG', onClick: () => requestChartExport('svg') },
            { label: 'PDF', disabled: !fonts, onClick: () => requestChartExport('pdf') },
            { label: 'EPS', disabled: !fonts, onClick: () => requestChartExport('eps') },
            { label: 'PNG', disabled: !fonts, onClick: () => requestChartExport('png') },
          ],
        },
        'sep',
        { label: t('files.close'), disabled: !active, onClick: () => active && close(active.id) },
        { label: t('files.closeAll'), disabled: !files.length, onClick: closeAll },
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        {
          label: active?.past.length ? t('menu.undoStep', { step: active.label }) : t('menu.undo'),
          shortcut: `${mod}Z`,
          disabled: !active?.past.length,
          onClick: doUndo,
        },
        {
          label: active?.future.length ? t('menu.redoStep', { step: active.future[0].label }) : t('menu.redo'),
          shortcut: mod === '⌘' ? '⇧⌘Z' : 'Ctrl+Y',
          disabled: !active?.future.length,
          onClick: doRedo,
        },
        'sep',
        { label: t('menu.history'), disabled: !active, onClick: () => setTab('ops') },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        ...TABS.map((k, i): MenuItem => ({ label: t(`tabs.${k}`), shortcut: `${mod}${i + 1}`, checked: tab === k, disabled: !active, onClick: () => setTab(k) })),
        'sep',
        { label: t('menu.fileList'), checked: showFiles, onClick: () => { setShowFiles(!showFiles); save('show-files', !showFiles); } },
        'sep',
        {
          label: t('menu.theme'),
          submenu: (['system', 'light', 'dark'] as Theme[]).map((th) => ({ label: t(`menu.theme_${th}`), checked: theme === th, onClick: () => applyTheme(th) })),
        },
        {
          label: t('app.language'),
          submenu: LANGS.map((l) => ({ label: { ru: 'Русский', en: 'English', de: 'Deutsch' }[l], checked: i18n.language === l, onClick: () => void i18n.changeLanguage(l) })),
        },
      ],
    },
    {
      id: 'photometry',
      label: t('menu.photometry'),
      items: [
        ...OP_KINDS.map((k): MenuItem => ({ label: `${t(`ops.kind_${k}`)}…`, disabled: !active, onClick: () => openOp(k) })),
        'sep',
        {
          label: t('menu.mirrorNow'),
          disabled: !active,
          submenu: (['c0c180', 'c90c270', 'updown'] as MirrorPlane[]).map((pl) => ({ label: t(`ops.mirror_${pl}`), onClick: () => quickOp({ op: 'mirror', plane: pl }) })),
        },
        {
          label: t('menu.rotateZNow'),
          disabled: !active,
          submenu: [90, -90, 180].map((a) => ({ label: `${a > 0 ? '+' : '−'}${Math.abs(a)}°`, onClick: () => quickOp({ op: 'rotate', axis: 'z', angle: a }) })),
        },
        { label: t('menu.normalize1000'), disabled: !active, onClick: () => quickOp({ op: 'normalize', mode: 'cdklm' }) },
      ],
    },
    {
      id: 'format',
      label: t('menu.format'),
      items: [
        { label: `${t('app.style')}…`, onClick: () => setStyleOpen(true) },
        {
          label: t('style.preset'),
          submenu: STYLE_PRESETS.map((x) => ({ label: t(`style.preset${x.id[0].toUpperCase()}${x.id.slice(1)}`), checked: style.name === x.make().name, onClick: () => applyPreset(x.id) })),
        },
        'sep',
        {
          label: t('chart.layout'),
          submenu: (['catalog', 'standard'] as const).map((l) => ({
            label: t(l === 'catalog' ? 'chart.layoutCatalog' : 'chart.layoutStandard'),
            checked: settings.layout === l,
            onClick: () => setSettings({ ...settings, ...layoutPatch(settings, l) }),
          })),
        },
        {
          label: t('chart.labelLang'),
          submenu: LANGS.map((l) => ({ label: l.toUpperCase(), checked: settings.lang === l, onClick: () => setSettings({ ...settings, lang: l }) })),
        },
      ],
    },
    {
      id: 'window',
      label: t('menu.window'),
      items: files.length
        ? [
            { label: t('menu.nextFile'), shortcut: 'Alt+↓', disabled: files.length < 2, onClick: () => step(1) },
            { label: t('menu.prevFile'), shortcut: 'Alt+↑', disabled: files.length < 2, onClick: () => step(-1) },
            'sep',
            ...files.slice(0, 30).map((f): MenuItem => ({ label: f.name, checked: f.id === activeId, onClick: () => setActiveId(f.id) })),
          ]
        : [{ label: t('menu.noFiles'), disabled: true }],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [{ label: t('menu.about'), shortcut: 'F1', onClick: () => setAboutOpen(true) }],
    },
  ];

  return (
    <div className="app">
      <header className="sbar">
        <span className="brand">
          <MaytoniLogo />
        </span>
        <span className="apptitle">
          {t('app.title')}
          <span className="appver" title={`commit ${__APP_COMMIT__}`}>v{__APP_VERSION__} · {__APP_COMMIT__}</span>
        </span>
        <MenuBar menus={menus} />
        <div className="sbtools">
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
          <button className="themebtn" onClick={toggleTheme} aria-label={t('app.theme')} title={t('app.theme')}>
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 2.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="banner error" role="alert">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
          <button className="link" onClick={() => setErrors([])}>×</button>
        </div>
      )}

      <div className="body">
        {files.length > 0 && showFiles && (
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
                      {isModified(f) && <span className="modmark" title={t('files.modified')}>●</span>}
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
                  <path d="M60 10 C40 40 44 62 60 64 C76 62 80 40 60 10" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.6" />
                  <path d="M60 10 C30 30 38 52 60 54 C82 52 90 30 60 10" fill="none" stroke="var(--ink3)" strokeWidth="1.2" strokeDasharray="4 2" />
                </svg>
              </div>
              <h1>{t('drop.title')}</h1>
              <p>{t('drop.hint')}</p>
              <p className="muted">{t('app.privacy')}</p>
              <button className="gsbtn" onClick={(e) => { e.stopPropagation(); openDialog(); }}>{t('app.open')}</button>
            </div>
          ) : (
            <>
              <div className="mainhead">
                <span className={`fmt fmt-${active.parse.photometry.source.format.toLowerCase()}`}>{active.parse.photometry.source.format}</span>
                <b title={active.name}>{active.name}</b>
                {isModified(active) && <span className="modmark" title={t('files.modified')}>●</span>}
                <nav className="stnav" role="tablist">
                  {TABS.map((k) => (
                    <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'gsst cur' : 'gsst'} onClick={() => setTab(k)}>
                      {t(`tabs.${k}`)}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="tab-body">
                {tab === 'passport' && <Passport file={active} />}
                {tab === 'table' && <IntensityTable file={active} />}
                {tab === 'ops' && (
                  <OpsPanel
                    file={active}
                    files={files}
                    op={opKind}
                    onOp={setOpKind}
                    settings={settings}
                    style={style}
                    fonts={fonts}
                    onApply={applyToActive}
                    onCreate={createDoc}
                    onJump={jump}
                  />
                )}
                {(tab === 'polar' || tab === 'linear') && (
                  <ChartPanel
                    kind={tab}
                    file={active}
                    settings={settings}
                    onSettings={setSettings}
                    style={style}
                    onStyle={setStyle}
                    fonts={fonts}
                    onFonts={setFonts}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
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
