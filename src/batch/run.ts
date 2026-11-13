/**
 * Пакетная обработка (этап 5): одно действие над набором файлов.
 *
 *   чтение → рецепт (цепочка операций) → варианты → проверка →
 *   IES / LDT, графики (polar/, linear/), сводная таблица и отчёт → ZIP
 *
 * Работает без DOM: в браузере — в Web Worker (worker.ts), в тестах — напрямую.
 * Ошибка одного файла не останавливает пакет: файл пропускается и попадает в журнал.
 */

import JSZip from 'jszip';
import { woffToSfnt, type FontSet } from '../charts/fonts';
import {
  comparePair,
  parseFile,
  summarize,
  typeBToC,
  validatePhotometry,
  writeIES,
  writeLDT,
  OpError,
  type Issue,
  type Lang,
  type OpSpec,
  type Photometry,
  type PhotometrySummary,
} from '../core/index';
import { buildChart, chartOptions, commonScaleMax, measureFor, renderChart, type BatchCharts, type ChartKind } from './charts';
import { tr } from './messages';
import { NameRegistry, outputBase, type NamingMode } from './naming';
import { applyRecipe, StepError } from './recipe';
import { issuesCsv, summaryCsv, summaryRow, summaryXlsx, type SummaryRow } from './table';
import { makeVariant, rowError, type VariantRow } from './variants';

/** ies / ldt — этот формат; same — как исходный; other — другой (IES → LDT, LDT → IES). */
export type FileFormat = 'ies' | 'ldt' | 'same' | 'other';

export interface BatchJob {
  /** Шаги рецепта; пусто — без операций. */
  steps: OpSpec[];
  /** Таблица вариантов; пусто — по одному выходному файлу на исходный. */
  variants: VariantRow[];
  /** Фотометрические файлы: IES, LDT, «как исходный». Пусто — не выгружать. */
  files: FileFormat[];
  charts: BatchCharts | null;
  summary: Array<'csv' | 'xlsx'>;
  naming: NamingMode;
  /** Язык таблицы, отчёта и журнала. */
  lang: Lang;
}

export interface BatchInput {
  name: string;
  bytes: Uint8Array;
}

export type BatchPhase = 'read' | 'write' | 'charts' | 'pack';

export interface BatchProgress {
  phase: BatchPhase;
  done: number;
  total: number;
  current?: string;
}

export interface BatchLogEntry {
  file: string;
  message: string;
}

export interface BatchResult {
  zip: Uint8Array;
  /** Исходных файлов прочитано / всего. */
  read: number;
  inputs: number;
  /** Выходных наборов (файл или вариант). */
  outputs: number;
  /** Файлов в архиве. */
  entries: number;
  errors: BatchLogEntry[];
  /** Замечаний уровня «ошибка» и «предупреждение» в результатах. */
  issueCounts: { error: number; warning: number };
  ms: number;
}

export interface BatchEnv {
  fonts?: FontSet | null;
  onProgress?: (p: BatchProgress) => void;
  cancelled?: () => boolean;
}

export class BatchCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

/** Набор на выходе: исходный файл или его вариант. */
interface Item {
  base: string;
  source: string;
  p: Photometry;
  s: PhotometrySummary;
  issues: Issue[];
  sourceFormat: 'IES' | 'LDT' | 'none';
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const byteName = (n: string) => n.replace(/^.*[\\/]/, '');
const extOf = (n: string) => (/\.ldt$/i.test(n) ? 'LDT' : /\.ies$/i.test(n) ? 'IES' : '');

function sortIssues(list: Issue[]): Issue[] {
  const order = { error: 0, warning: 1, info: 2 };
  return [...list].sort((a, b) => order[a.severity] - order[b.severity]);
}

function errorMessage(lang: Lang, e: unknown, steps: OpSpec[]): string {
  if (e instanceof StepError) {
    const inner = e.reason instanceof OpError ? tr(lang, `ops.err.${e.reason.code}`, e.reason.params) : String((e.reason as Error)?.message ?? e.reason);
    return tr(lang, 'batch.log.step', { n: e.step + 1, op: tr(lang, `ops.kind_${steps[e.step].op}`), msg: inner });
  }
  if (e instanceof OpError) return tr(lang, `ops.err.${e.code}`, e.params);
  return String((e as Error)?.message ?? e);
}

export async function runBatch(inputs: BatchInput[], job: BatchJob, env: BatchEnv = {}): Promise<BatchResult> {
  const t0 = Date.now();
  const lang = job.lang;
  const progress = env.onProgress ?? (() => {});
  const check = async (i: number) => {
    if (i % 4 === 0) await tick();
    if (env.cancelled?.()) throw new BatchCancelled();
  };
  const errors: BatchLogEntry[] = [];
  const items: Item[] = [];
  const variants = job.variants.filter((r) => !rowError(r));
  for (const r of job.variants) {
    const err = rowError(r);
    if (err) errors.push({ file: '—', message: tr(lang, `batch.variantErr.${err}`, { suffix: r.suffix || r.cct || '' }) });
  }
  const originals = new Map<string, { name: string; p: Photometry }[]>();

  // ——— 1. чтение, рецепт, варианты, проверка
  let read = 0;
  for (let i = 0; i < inputs.length; i++) {
    await check(i);
    const inp = inputs[i];
    const name = byteName(inp.name);
    progress({ phase: 'read', done: i, total: inputs.length, current: name });
    let parsed;
    try {
      parsed = parseFile(inp.bytes, name);
      read++;
    } catch (e) {
      errors.push({ file: name, message: tr(lang, 'batch.log.read', { msg: (e as Error).message }) });
      continue;
    }
    const key = name.replace(/\.(ies|ldt)$/i, '').toLowerCase();
    if (!originals.has(key)) originals.set(key, []);
    originals.get(key)!.push({ name, p: parsed.photometry });

    let p = parsed.photometry;
    const issues: Issue[] = [...parsed.issues];
    if (job.steps.length) {
      try {
        const r = applyRecipe(p, job.steps);
        p = r.photometry;
        issues.push(...r.issues);
      } catch (e) {
        errors.push({ file: name, message: errorMessage(lang, e, job.steps) });
        continue;
      }
    }
    const fmt = parsed.photometry.source.format;
    const add = (base: string, q: Photometry, extra: Issue[]) => {
      const s = summarize(q);
      const all = [...extra];
      if (q.photometryType === 'B') all.push(...typeBToC(q).issues.filter((x) => x.code === 'typeb-light-outside'));
      all.push(...validatePhotometry(s.asC, { fileName: `${base}.${fmt === 'LDT' ? 'ldt' : 'ies'}` }));
      items.push({ base, source: name, p: q, s, issues: sortIssues(all), sourceFormat: fmt });
    };
    if (variants.length) {
      for (const row of variants) {
        try {
          const v = makeVariant(p, row);
          add(outputBase(p, name, job.naming, row.suffix), v.photometry, [...issues, ...v.issues]);
        } catch (e) {
          errors.push({ file: name, message: tr(lang, 'batch.log.variant', { suffix: row.suffix, msg: errorMessage(lang, e, job.steps) }) });
        }
      }
    } else add(outputBase(p, name, job.naming), p, issues);
  }
  progress({ phase: 'read', done: inputs.length, total: inputs.length });

  // пары IES / LDT с одним именем — сверка исходных файлов (ТЗ, «Проверка файлов»)
  if (job.summary.length) {
    for (const [, list] of originals) {
      const ies = list.find((x) => extOf(x.name) === 'IES');
      const ldt = list.find((x) => extOf(x.name) === 'LDT');
      if (!ies || !ldt) continue;
      const pair = comparePair(ies.p, ldt.p);
      if (!pair.length) continue;
      for (const it of items) if (it.source === ies.name || it.source === ldt.name) it.issues = sortIssues([...it.issues, ...pair]);
    }
  }

  const zip = new JSZip();
  let entries = 0;
  const put = (path: string, data: string | Uint8Array) => {
    zip.file(path, data);
    entries++;
  };

  // ——— 2. фотометрические файлы
  const fileNames = new NameRegistry();
  if (job.files.length) {
    for (let i = 0; i < items.length; i++) {
      await check(i);
      const it = items[i];
      progress({ phase: 'write', done: i, total: items.length, current: it.base });
      const fmts = new Set<'ies' | 'ldt'>();
      const src = it.sourceFormat === 'LDT' ? 'ldt' : 'ies';
      for (const f of job.files) fmts.add(f === 'same' ? src : f === 'other' ? (src === 'ldt' ? 'ies' : 'ldt') : f);
      const exts = [...fmts];
      const base = fileNames.takeAll('', it.base, exts);
      for (const ext of exts) {
        try {
          if (ext === 'ies') put(`${base}.ies`, writeIES(it.p, { lineEnding: it.p.source.lineEnding }));
          else {
            const c = it.p.photometryType === 'B' ? typeBToC(it.p).photometry : it.p;
            const w = writeLDT(c, { lineEnding: 'CRLF', fileName: `${base}.ldt` });
            put(`${base}.ldt`, w.text);
          }
        } catch (e) {
          errors.push({ file: it.source, message: tr(lang, 'batch.log.write', { file: `${base}.${ext}`, msg: (e as Error).message }) });
        }
      }
    }
  }

  // ——— 3. графики
  const cfg = job.charts;
  if (cfg && cfg.kinds.length && cfg.formats.length) {
    // WOFF (встроенный Roboto) один раз распаковываем: подмножество для PDF из TTF собирается в ~10 раз быстрее
    const f = env.fonts;
    const fonts: FontSet | null = f
      ? { regular: await woffToSfnt(f.regular), bold: f.bold && (await woffToSfnt(f.bold)), fallback: f.fallback && (await woffToSfnt(f.fallback)) }
      : null;
    const measure = measureFor(fonts);
    const folders = cfg.kinds.length > 1;
    const total = items.length * cfg.kinds.length;
    let done = 0;
    for (const kind of cfg.kinds as ChartKind[]) {
      const shared = commonScaleMax(items.map((x) => ({ p: x.p, s: x.s })), kind, cfg);
      const dir = folders ? `${kind}/` : '';
      const names = new NameRegistry();
      for (const it of items) {
        await check(done);
        progress({ phase: 'charts', done, total, current: it.base });
        done++;
        const base = names.takeAll(dir, it.base, cfg.formats);
        try {
          const scene = buildChart(kind, it.p, it.s, chartOptions(kind, it.p, cfg.settings, shared), cfg.style, measure);
          for (const fmt of cfg.formats) put(`${dir}${base}.${fmt}`, await renderChart(scene, fmt, cfg, fonts));
        } catch (e) {
          errors.push({ file: it.source, message: tr(lang, 'batch.log.chart', { kind: tr(lang, `tabs.${kind}`), msg: (e as Error).message }) });
        }
      }
    }
    progress({ phase: 'charts', done: total, total });
  }

  // ——— 4. сводная таблица и отчёт проверки
  const rows: SummaryRow[] = items.map((it) => summaryRow(it.p, it.base, it.source, it.issues));
  const base = tr(lang, 'batch.summaryFile');
  if (job.summary.includes('csv')) {
    put(`${base}.csv`, summaryCsv(rows, lang));
    put(`${tr(lang, 'batch.issuesFile')}.csv`, issuesCsv(rows, lang));
  }
  if (job.summary.includes('xlsx')) put(`${base}.xlsx`, await summaryXlsx(rows, lang));

  // ——— 5. журнал (только если что-то пошло не так)
  if (errors.length) {
    const lines = [tr(lang, 'batch.log.title'), '', ...errors.map((e) => `${e.file}: ${e.message}`)];
    put(`${tr(lang, 'batch.logFile')}.txt`, '﻿' + lines.join('\r\n') + '\r\n');
  }

  if (env.cancelled?.()) throw new BatchCancelled();
  progress({ phase: 'pack', done: 0, total: 100 });
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (m) =>
    progress({ phase: 'pack', done: Math.round(m.percent), total: 100 }),
  );
  return {
    zip: out,
    read,
    inputs: inputs.length,
    outputs: items.length,
    entries,
    errors,
    issueCounts: {
      error: rows.reduce((a, r) => a + r.errors, 0),
      warning: rows.reduce((a, r) => a + r.warnings, 0),
    },
    ms: Date.now() - t0,
  };
}
