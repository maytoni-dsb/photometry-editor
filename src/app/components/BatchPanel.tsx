import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartStyle } from '../../charts/style';
import type { ColorMode } from '../../charts/vector';
import { writeIES, writeLDT, typeBToC, type Lang, type OpSpec } from '../../core/index';
import type { ChartFormat, ChartKind } from '../../batch/charts';
import type { NamingMode } from '../../batch/naming';
import { parseStep, type Recipe } from '../../batch/recipe';
import type { BatchJob, BatchProgress, BatchResult, FileFormat } from '../../batch/run';
import { rowError, templateFromJson, type VariantRow, type VariantTemplate } from '../../batch/variants';
import type { ChartSettings } from '../App';
import { startBatch, type BatchRun } from '../batch-client';
import { baseName, isModified, type OpenFile } from '../doc';
import type { LoadedFonts } from '../fonts';
import { saveFile } from '../save-file';
import { load, save } from '../storage';
import { RecipeEditor } from './RecipeEditor';
import { VariantEditor } from './VariantEditor';

/** С чего открыть окно (пункты меню «Пакет»). */
export type BatchPreset = 'all' | 'convert' | 'variants' | 'charts' | 'summary';

export interface BatchInputFile {
  name: string;
  file: Blob;
  /** Путь в выбранной папке — для подсказки. */
  path?: string;
}

type FilesMode = 'none' | 'same' | 'other' | 'ies' | 'ldt' | 'both';

interface Options {
  recipeOn: boolean;
  variantsOn: boolean;
  files: FilesMode;
  naming: NamingMode;
  chartsOn: boolean;
  kinds: Record<ChartKind, boolean>;
  formats: Record<ChartFormat, boolean>;
  color: ColorMode;
  textAsPaths: boolean;
  commonScale: boolean;
  xlsx: boolean;
  csv: boolean;
}

const DEFAULTS: Options = {
  recipeOn: false,
  variantsOn: false,
  files: 'same',
  naming: 'source',
  chartsOn: false,
  kinds: { polar: true, linear: false },
  formats: { svg: true, pdf: false, eps: false },
  color: 'rgb',
  textAsPaths: false,
  commonScale: false,
  xlsx: true,
  csv: false,
};

const FILE_MODES: Record<FilesMode, FileFormat[]> = { none: [], same: ['same'], other: ['other'], ies: ['ies'], ldt: ['ldt'], both: ['ies', 'ldt'] };

function loadRecipes(): Recipe[] {
  const raw = load<unknown[]>('batch-recipes', []);
  const out: Recipe[] = [];
  for (const r of raw) {
    try {
      const o = r as { name: string; steps: unknown[] };
      out.push({ name: String(o.name), steps: o.steps.map(parseStep) });
    } catch {
      /* испорченная запись — пропускаем */
    }
  }
  return out;
}

function loadTemplates(): VariantTemplate[] {
  const raw = load<unknown[]>('batch-variant-templates', []);
  const out: VariantTemplate[] = [];
  for (const x of raw) {
    try {
      out.push(templateFromJson(JSON.stringify(x)));
    } catch {
      /* пропускаем */
    }
  }
  return out;
}

/** Открытый в редакторе файл → байты в исходном формате (с учётом сделанных операций). */
function openFileToInput(f: OpenFile): BatchInputFile {
  const p = f.parse.photometry;
  const ldt = p.source.format === 'LDT';
  const name = /\.(ies|ldt)$/i.test(f.name) ? f.name : `${f.name}.${ldt ? 'ldt' : 'ies'}`;
  const text = ldt ? writeLDT(p.photometryType === 'B' ? typeBToC(p).photometry : p, { fileName: name }).text : writeIES(p, { lineEnding: p.source.lineEnding });
  return { name, file: new Blob([text], { type: 'text/plain' }) };
}

/** Шаги истории файла (операции этапа 4) — для рецепта. */
export function historySteps(f: OpenFile): OpSpec[] {
  return [...f.past.slice(1).map((s) => s.spec), f.past.length ? f.spec : undefined].filter((s): s is OpSpec => !!s);
}

const fmtBytes = (n: number, lang: string, t: (k: string, o?: Record<string, unknown>) => string) =>
  n < 1e6
    ? t('batch.kb', { v: (n / 1024).toLocaleString(lang, { maximumFractionDigits: 0 }) })
    : t('batch.mb', { v: (n / 1e6).toLocaleString(lang, { maximumFractionDigits: 1 }) });

interface Props {
  open: boolean;
  preset: { kind: BatchPreset; nonce: number };
  onClose: () => void;
  /** Файлы, брошенные в окно или выбранные в папке (из App). */
  incoming: { files: BatchInputFile[]; nonce: number } | null;
  openFiles: OpenFile[];
  active: OpenFile | null;
  settings: ChartSettings;
  style: ChartStyle;
  fonts: LoadedFonts | null;
  onOpenStyle: () => void;
}

export function BatchPanel({ open, preset, onClose, incoming, openFiles, active, settings, style, fonts, onOpenStyle }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const [inputs, setInputs] = useState<BatchInputFile[]>([]);
  const [opts, setOpts] = useState<Options>(() => ({ ...DEFAULTS, ...load<Partial<Options>>('batch-options', {}) }));
  const [steps, setSteps] = useState<OpSpec[]>(() => {
    try {
      return load<unknown[]>('batch-steps', []).map(parseStep);
    } catch {
      return [];
    }
  });
  const [recipeName, setRecipeName] = useState(() => load('batch-recipe-name', ''));
  const [recipes, setRecipes] = useState<Recipe[]>(loadRecipes);
  const [rows, setRows] = useState<VariantRow[]>(() => {
    try {
      return templateFromJson(JSON.stringify({ rows: load<unknown[]>('batch-variants', []) })).rows;
    } catch {
      return [];
    }
  });
  const [templateName, setTemplateName] = useState(() => load('batch-variant-name', ''));
  const [templates, setTemplates] = useState<VariantTemplate[]>(loadTemplates);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef<BatchRun | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const sections = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => save('batch-options', opts), [opts]);
  useEffect(() => save('batch-steps', steps), [steps]);
  useEffect(() => save('batch-recipe-name', recipeName), [recipeName]);
  useEffect(() => save('batch-recipes', recipes), [recipes]);
  useEffect(() => save('batch-variants', rows), [rows]);
  useEffect(() => save('batch-variant-name', templateName), [templateName]);
  useEffect(() => save('batch-variant-templates', templates), [templates]);

  const set = (patch: Partial<Options>) => setOpts((o) => ({ ...o, ...patch }));

  const addFiles = (list: BatchInputFile[]) => {
    const ok = list.filter((f) => /\.(ies|ldt)$/i.test(f.name));
    setInputs((prev) => {
      const seen = new Set(prev.map((f) => `${f.path ?? ''}/${f.name}`));
      return [...prev, ...ok.filter((f) => !seen.has(`${f.path ?? ''}/${f.name}`))];
    });
    setResult(null);
  };

  // файлы, брошенные в окно (App перехватывает перетаскивание, пока окно открыто)
  useEffect(() => {
    if (incoming) addFiles(incoming.files);
  }, [incoming]);

  // пункты меню «Пакет» открывают окно с нужными настройками
  useEffect(() => {
    if (!preset.nonce) return;
    const k = preset.kind;
    if (k === 'convert') set({ recipeOn: false, variantsOn: false, files: 'other', chartsOn: false });
    if (k === 'variants') set({ variantsOn: true, files: opts.files === 'none' ? 'both' : opts.files });
    if (k === 'charts') set({ chartsOn: true });
    if (k === 'summary') set({ xlsx: true });
    const target = { convert: 'output', variants: 'variants', charts: 'charts', summary: 'summary', all: 'files' }[k];
    setTimeout(() => sections.current[target]?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }, [preset.nonce]);

  const history = active && historySteps(active).length ? { file: active.name, steps: historySteps(active) } : null;

  const validRows = rows.filter((r) => !rowError(r));
  const kinds = (['polar', 'linear'] as const).filter((k) => opts.kinds[k]);
  const formats = (['svg', 'pdf', 'eps'] as const).filter((f) => opts.formats[f]);
  const chartsWanted = opts.chartsOn && kinds.length > 0 && formats.length > 0;
  const needsFonts = chartsWanted && formats.some((f) => f !== 'svg');
  const summaryWanted = opts.xlsx || opts.csv;
  const anyOutput = opts.files !== 'none' || chartsWanted || summaryWanted;
  const running = progress != null;

  const counts = useMemo(() => {
    let ies = 0;
    let ldt = 0;
    let size = 0;
    for (const f of inputs) {
      if (/\.ldt$/i.test(f.name)) ldt++;
      else ies++;
      size += f.file.size;
    }
    return { ies, ldt, size };
  }, [inputs]);
  const outputsPerFile = opts.variantsOn && validRows.length ? validRows.length : 1;

  const problems: string[] = [];
  if (!inputs.length) problems.push(t('batch.needFiles'));
  if (!anyOutput) problems.push(t('batch.needOutput'));
  if (opts.recipeOn && !steps.length) problems.push(t('batch.needSteps'));
  if (opts.variantsOn && !validRows.length) problems.push(t('batch.needVariants'));
  if (needsFonts && !fonts) problems.push(t('export.fontLoading'));

  const run = async () => {
    setError(null);
    setResult(null);
    const job: BatchJob = {
      steps: opts.recipeOn ? steps : [],
      variants: opts.variantsOn ? rows : [],
      files: FILE_MODES[opts.files],
      charts: chartsWanted
        ? { kinds, formats, color: opts.color, textAsPaths: opts.textAsPaths, commonScale: opts.commonScale, settings: { ...settings, title: '' }, style }
        : null,
      summary: [...(opts.xlsx ? (['xlsx'] as const) : []), ...(opts.csv ? (['csv'] as const) : [])],
      naming: opts.naming,
      lang,
    };
    setProgress({ phase: 'read', done: 0, total: inputs.length });
    const r = startBatch(inputs.map((f) => ({ name: f.name, file: f.file })), job, fonts?.set ?? null, setProgress);
    runRef.current = r;
    try {
      const res = await r.done;
      if (res) setResult(res);
      else setError(t('batch.cancelled'));
    } catch (e) {
      setError(t('batch.failed', { msg: (e as Error).message }));
    } finally {
      runRef.current = null;
      setProgress(null);
    }
  };

  const zipName = () => {
    const d = new Date();
    const p2 = (x: number) => String(x).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}`;
    const label = opts.recipeOn && recipeName.trim() ? recipeName.trim() : t('batch.zipName');
    return `${label} ${stamp}.zip`.replace(/[\\/:*?"<>|]+/g, '_');
  };

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="modal-backdrop batch-backdrop" hidden={!open} onClick={onClose}>
      <div className="modal batch" role="dialog" aria-label={t('batch.title')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('batch.title')}</h2>
          <button className="link" onClick={onClose} aria-label={t('style.close')}>×</button>
        </header>

        <div className="modal-body batch-body">
          {/* 1. Файлы */}
          <section className="bsec" ref={(el) => { sections.current.files = el; }}>
            <h3><span className="bnum">1</span>{t('batch.files')}</h3>
            <div
              className="dropzone"
              onDragOver={(e) => { e.preventDefault(); }}
              onClick={() => filesRef.current?.click()}
            >
              <b>{t('batch.dropHere')}</b>
              <span className="muted small">{t('batch.dropHint')}</span>
            </div>
            <div className="row">
              <button className="btn small" onClick={() => filesRef.current?.click()}>{t('batch.addFiles')}</button>
              <button className="btn small" onClick={() => dirRef.current?.click()}>{t('batch.addFolder')}</button>
              <button className="btn small" disabled={!openFiles.length} onClick={() => addFiles(openFiles.map(openFileToInput))} title={openFiles.some(isModified) ? t('batch.takeOpenModified') : ''}>
                {t('batch.takeOpen', { n: openFiles.length })}
              </button>
              {inputs.length > 0 && <button className="link small" disabled={running} onClick={() => { setInputs([]); setResult(null); }}>{t('batch.clear')}</button>}
              <input ref={filesRef} type="file" multiple accept=".ies,.ldt,.IES,.LDT" hidden onChange={(e) => { addFiles([...(e.target.files ?? [])].map((f) => ({ name: f.name, file: f }))); e.target.value = ''; }} />
              <input
                ref={(el) => {
                  dirRef.current = el;
                  if (el) el.setAttribute('webkitdirectory', '');
                }}
                type="file"
                multiple
                hidden
                onChange={(e) => { addFiles([...(e.target.files ?? [])].map((f) => ({ name: f.name, file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath }))); e.target.value = ''; }}
              />
            </div>
            {inputs.length > 0 && (
              <>
                <p className="small"><b>{t('batch.count', { n: inputs.length })}</b> <span className="muted">· IES {counts.ies} · LDT {counts.ldt} · {fmtBytes(counts.size, lang, t)}</span></p>
                <ul className="bfiles">
                  {inputs.slice(0, 300).map((f, i) => (
                    <li key={`${f.path ?? ''}/${f.name}`}>
                      <span className={`fmt fmt-${/\.ldt$/i.test(f.name) ? 'ldt' : 'ies'}`}>{/\.ldt$/i.test(f.name) ? 'LDT' : 'IES'}</span>
                      <span className="fname" title={f.path || f.name}>{f.name}</span>
                      <button className="icon" disabled={running} onClick={() => setInputs(inputs.filter((_, j) => j !== i))} aria-label={t('files.close')}>×</button>
                    </li>
                  ))}
                  {inputs.length > 300 && <li className="muted small">{t('batch.more', { n: inputs.length - 300 })}</li>}
                </ul>
              </>
            )}
          </section>

          {/* 2. Рецепт */}
          <section className="bsec" ref={(el) => { sections.current.recipe = el; }}>
            <h3>
              <span className="bnum">2</span>
              <label className="check"><input type="checkbox" checked={opts.recipeOn} onChange={(e) => set({ recipeOn: e.target.checked })} />{t('batch.recipe')}</label>
              {opts.recipeOn && steps.length > 0 && <span className="muted small">{t('batch.stepsCount', { n: steps.length })}</span>}
            </h3>
            {opts.recipeOn ? (
              <RecipeEditor steps={steps} onSteps={setSteps} name={recipeName} onName={setRecipeName} saved={recipes} onSaved={setRecipes} history={history} />
            ) : (
              <p className="muted small">{t('batch.recipeOff')}</p>
            )}
          </section>

          {/* 3. Варианты */}
          <section className="bsec" ref={(el) => { sections.current.variants = el; }}>
            <h3>
              <span className="bnum">3</span>
              <label className="check"><input type="checkbox" checked={opts.variantsOn} onChange={(e) => set({ variantsOn: e.target.checked })} />{t('batch.variants')}</label>
              {opts.variantsOn && validRows.length > 0 && <span className="muted small">{t('batch.variantsCount', { n: validRows.length })}</span>}
            </h3>
            {opts.variantsOn ? (
              <>
                <p className="muted small">{t('batch.variantsNote')}</p>
                <VariantEditor rows={rows} onRows={setRows} name={templateName} onName={setTemplateName} saved={templates} onSaved={setTemplates} />
              </>
            ) : (
              <p className="muted small">{t('batch.variantsOff')}</p>
            )}
          </section>

          {/* 4. Что выгрузить */}
          <section className="bsec" ref={(el) => { sections.current.output = el; }}>
            <h3><span className="bnum">4</span>{t('batch.output')}</h3>
            <div className="form-grid wide">
              <label>{t('batch.photometryFiles')}</label>
              <select value={opts.files} onChange={(e) => set({ files: e.target.value as FilesMode })}>
                {(['same', 'other', 'ies', 'ldt', 'both', 'none'] as const).map((m) => <option key={m} value={m}>{t(`batch.files_${m}`)}</option>)}
              </select>
              <label>{t('batch.naming')}</label>
              <select value={opts.naming} onChange={(e) => set({ naming: e.target.value as NamingMode })}>
                <option value="source">{t('batch.naming_source')}</option>
                <option value="article">{t('batch.naming_article')}</option>
              </select>
            </div>
            <p className="muted small">{opts.variantsOn ? t('batch.namingVariants') : t('batch.namingNote')}</p>

            <div className="bsub" ref={(el) => { sections.current.charts = el; }}>
              <label className="check strong"><input type="checkbox" checked={opts.chartsOn} onChange={(e) => set({ chartsOn: e.target.checked })} />{t('batch.charts')}</label>
              {opts.chartsOn && (
                <>
                  <div className="row">
                    {(['polar', 'linear'] as const).map((k) => (
                      <label key={k} className="check"><input type="checkbox" checked={opts.kinds[k]} onChange={(e) => set({ kinds: { ...opts.kinds, [k]: e.target.checked } })} />{t(`tabs.${k}`)}</label>
                    ))}
                    <span className="vsep" />
                    {(['svg', 'pdf', 'eps'] as const).map((f) => (
                      <label key={f} className="check"><input type="checkbox" checked={opts.formats[f]} onChange={(e) => set({ formats: { ...opts.formats, [f]: e.target.checked } })} />{f.toUpperCase()}</label>
                    ))}
                    <div className="seg">
                      {(['rgb', 'cmyk'] as const).map((m) => (
                        <button key={m} className={opts.color === m ? 'on' : ''} onClick={() => set({ color: m })} title={m === 'cmyk' ? t('batch.cmykNote') : ''}>{m.toUpperCase()}</button>
                      ))}
                    </div>
                  </div>
                  <div className="row">
                    <label className="check"><input type="checkbox" checked={opts.commonScale} onChange={(e) => set({ commonScale: e.target.checked })} />{t('batch.commonScale')}</label>
                    <label className="check"><input type="checkbox" checked={opts.textAsPaths} onChange={(e) => set({ textAsPaths: e.target.checked })} />{t('export.textAsPaths')}</label>
                  </div>
                  <p className="muted small">
                    {t('batch.chartsUse', {
                      layout: t(settings.layout === 'catalog' ? 'chart.layoutCatalog' : 'chart.layoutStandard'),
                      unit: t(`unit.${settings.unit}`),
                      font: fonts?.family ?? '…',
                      style: style.name,
                      lang: settings.lang.toUpperCase(),
                    })}{' '}
                    <button className="link small" onClick={onOpenStyle}>{t('batch.chartsStyle')}</button>
                  </p>
                  {kinds.length > 1 && <p className="muted small">{t('batch.chartsFolders')}</p>}
                  {opts.commonScale && settings.scaleMax != null && <p className="muted small">{t('batch.commonScaleFixed', { v: settings.scaleMax })}</p>}
                </>
              )}
            </div>

            <div className="bsub" ref={(el) => { sections.current.summary = el; }}>
              <label className="check strong">{t('batch.summary')}</label>
              <div className="row">
                <label className="check"><input type="checkbox" checked={opts.xlsx} onChange={(e) => set({ xlsx: e.target.checked })} />XLSX</label>
                <label className="check"><input type="checkbox" checked={opts.csv} onChange={(e) => set({ csv: e.target.checked })} />CSV</label>
              </div>
              <p className="muted small">{t('batch.summaryNote')}</p>
            </div>
          </section>
        </div>

        <footer className="batch-foot">
          {running ? (
            <div className="bprogress">
              <div className="bar"><div style={{ width: `${pct}%` }} /></div>
              <span className="small">
                {t(`batch.phase_${progress.phase}`)} · {progress.phase === 'pack' ? `${pct}%` : `${progress.done} / ${progress.total}`}
                {progress.current && <span className="muted"> · {progress.current}</span>}
              </span>
              <button className="btn small" onClick={() => runRef.current?.cancel()}>{t('batch.cancel')}</button>
            </div>
          ) : result ? (
            <div className="bresult">
              <p className="small">
                <b>{t('batch.done', { read: result.read, inputs: result.inputs, outputs: result.outputs, entries: result.entries })}</b>{' '}
                <span className="muted">· {fmtBytes(result.zip.length, lang, t)} · {(result.ms / 1000).toLocaleString(lang, { maximumFractionDigits: 1 })} {t('batch.sec')}</span>
              </p>
              {(result.issueCounts.error > 0 || result.issueCounts.warning > 0) && (
                <p className="muted small">{t('batch.issuesFound', { e: result.issueCounts.error, w: result.issueCounts.warning })}</p>
              )}
              {result.errors.length > 0 && (
                <details className="small">
                  <summary className="error">{t('batch.errors', { n: result.errors.length })}</summary>
                  <ul className="blog">{result.errors.slice(0, 50).map((e, i) => <li key={i}><b>{e.file}</b>: {e.message}</li>)}</ul>
                </details>
              )}
              <div className="row">
                <button className="gsbtn" onClick={() => void saveFile(zipName(), 'application/zip', 'zip', () => result.zip)}>{t('batch.saveZip')}</button>
                <button className="link small" onClick={() => setResult(null)}>{t('batch.again')}</button>
              </div>
            </div>
          ) : (
            <div className="brun">
              <span className="small muted">
                {problems.length
                  ? problems.join(' · ')
                  : t('batch.willProduce', { n: inputs.length, m: inputs.length * outputsPerFile })}
              </span>
              {error && <span className="error small">{error}</span>}
              <button className="gsbtn" disabled={problems.length > 0} onClick={() => void run()}>{t('batch.run', { n: inputs.length })}</button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
