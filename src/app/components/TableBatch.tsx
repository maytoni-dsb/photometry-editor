/**
 * Пакетная обработка «По таблице»: папка проекта (таблица ImportData + папка photometry), просмотр и правка
 * таблицы, проверка строк, запуск — файлы IES / LDT в папки рядом с photometry (или ZIP).
 * Логика строк — src/batch/import-table.ts.
 */
import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseFile } from '../../core/index';
import { houseIES, houseLDT } from '../../batch/house';
import { houseCtx } from '../user';
import {
  applyRow,
  colIdx,
  emptyTable,
  indexSources,
  pickSheet,
  planTable,
  tableFromCells,
  tableToCells,
  type ImportTable,
  type RowMessage,
  type RowPlan,
} from '../../batch/import-table';
import { readXlsx, writeXlsx } from '../../batch/xlsx-read';
import type JSZipType from 'jszip';
import {
  canWriteFolders,
  ensureWrite,
  fileListSources,
  pickOutputDir,
  pickProject,
  pickSourceDir,
  pickTableFile,
  scanFileList,
  writeHandle,
  writeInto,
  type ProjectFile,
  type ProjectScan,
} from '../project-folder';
import { safeFileName, saveFile } from '../save-file';
import { load, save } from '../storage';
import { Select } from './Select';

type Filter = 'all' | 'warning' | 'error';
interface Progress {
  done: number;
  total: number;
  current: string;
}
interface Result {
  written: number;
  rows: number;
  errors: Array<{ file: string; msg: string }>;
  zip?: Uint8Array;
  where: string;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Значок состояния строки. */
function StatusIcon({ s }: { s: RowPlan['status'] }) {
  const d =
    s === 'ok' ? 'M5 12.5l4.5 4.5L19 7.5' : s === 'warning' ? 'M12 4 2.8 20h18.4L12 4zM12 10v4.5M12 17.5v.01' : s === 'error' ? 'M6 6l12 12M18 6 6 18' : '';
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  addRow: 'M4 5h16M4 10h16M12 14v6M9 17h6',
  delRow: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  newTable: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7',
  paste: 'M9 4h6v3H9zM9 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-3M8.5 12h7M8.5 16h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
};
const Ico = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export function TableBatch() {
  const { t } = useTranslation();
  const [project, setProject] = useState<ProjectScan | null>(null);
  const [tableFile, setTableFile] = useState<ProjectFile | null>(null);
  const [tableName, setTableName] = useState('');
  const [table, setTable] = useState<ImportTable | null>(null);
  const [base, setBase] = useState<{ zip: JSZipType; path: string; sheet: string } | null>(null);
  const [past, setPast] = useState<ImportTable[]>([]);
  const [future, setFuture] = useState<ImportTable[]>([]);
  const [dirty, setDirty] = useState(false);
  const [sources, setSources] = useState<{ name: string; files: ProjectFile[] } | null>(null);
  const [outDir, setOutDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [outLabel, setOutLabel] = useState('');
  const [fmt, setFmt] = useState(() => load('tbl-formats', { ies: true, ldt: true }));
  /** Выделенный прямоугольник: строки таблицы r0 / r1 (по видимому порядку между ними), колонки — позиции в order. */
  const [range, setRange] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  const dragRef = useRef(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const projInput = useRef<HTMLInputElement>(null);
  const tableInput = useRef<HTMLInputElement>(null);
  const srcInput = useRef<HTMLInputElement>(null);
  const fsa = canWriteFolders();

  useEffect(() => save('tbl-formats', fmt), [fmt]);

  // Ctrl + колесо — прокрутка таблицы по горизонтали (вместо масштаба страницы)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY || e.deltaX;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [table != null]);

  // ——— таблица
  const loadTable = async (f: ProjectFile | null) => {
    setTableFile(f);
    setResult(null);
    if (!f) {
      setTable(null);
      setBase(null);
      setTableName('');
      return;
    }
    try {
      const { sheets, zip } = await readXlsx(await f.read());
      const sh = pickSheet(sheets);
      if (!sh) throw new Error(t('tbl.noSheet'));
      setTable(tableFromCells(sh.rows));
      setBase({ zip, path: sh.path, sheet: sh.name });
      setTableName(f.name);
      setPast([]);
      setFuture([]);
      setDirty(false);
      setRange(null);
      setErr(null);
    } catch (e) {
      setTable(null);
      setBase(null);
      setTableName(f.name);
      setErr(t('tbl.readError', { name: f.name, msg: (e as Error).message }));
    }
  };

  const applyScan = async (scan: ProjectScan) => {
    setProject(scan);
    setSources(scan.sources);
    setOutDir(scan.dir ?? null);
    setOutLabel(scan.dir ? t('tbl.nextTo', { name: scan.sources?.name ?? 'photometry' }) : t('tbl.toZip'));
    await loadTable(scan.tables[0] ?? null);
  };

  const openProject = async () => {
    setErr(null);
    if (!fsa) {
      projInput.current?.click();
      return;
    }
    try {
      const scan = await pickProject();
      if (scan) await applyScan(scan);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const otherTable = async () => {
    if (!fsa) {
      tableInput.current?.click();
      return;
    }
    const f = await pickTableFile();
    if (f) await loadTable(f);
  };
  const otherSources = async () => {
    if (!fsa) {
      srcInput.current?.click();
      return;
    }
    const s = await pickSourceDir();
    if (s) setSources(s);
  };
  const otherOutput = async () => {
    if (!fsa) return;
    const d = await pickOutputDir();
    if (d) {
      setOutDir(d);
      setOutLabel(t('tbl.inFolder', { name: d.name }));
    }
  };

  // ——— правка с отменой
  const commit = (next: ImportTable) => {
    if (!table) return;
    setPast((p) => [...p.slice(-99), table]);
    setFuture([]);
    setTable(next);
    setDirty(true);
    setResult(null);
  };
  const undo = () => {
    if (!past.length || !table) return;
    setFuture((f) => [table, ...f]);
    setTable(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  };
  const redo = () => {
    if (!future.length || !table) return;
    setPast((p) => [...p, table]);
    setTable(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  };
  const setCell = (r: number, c: number, text: string) => {
    if (!table || (table.rows[r]?.[c] ?? '') === text) return;
    commit({ ...table, rows: table.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? text : x)) : row)) });
  };
  const addRow = () => {
    if (!table) return;
    const at = focus != null ? focus + 1 : table.rows.length;
    const rows = [...table.rows];
    rows.splice(at, 0, table.columns.map(() => ''));
    commit({ ...table, rows });
    setRange({ r0: at, c0: 0, r1: at, c1: Math.max(0, order.length - 1) });
  };
  const delRows = () => {
    if (!table) return;
    const kill = sel.size ? sel : focus != null ? new Set([focus]) : new Set<number>();
    if (!kill.size) return;
    commit({ ...table, rows: table.rows.filter((_, i) => !kill.has(i)) });
    setRange(null);
  };
  const newTable = () => {
    const nt = emptyTable();
    nt.rows = [nt.columns.map(() => '')];
    if (table) setPast((p) => [...p, table]);
    setFuture([]);
    setTable(nt);
    setBase(null);
    setTableFile(null);
    setTableName('ImportData.xlsx');
    setDirty(true);
    setRange({ r0: 0, c0: 0, r1: 0, c1: 0 });
  };
  const saveTable = async () => {
    if (!table) return;
    try {
      const bytes = await writeXlsx(tableToCells(table), { sheetName: base?.sheet ?? 'ImportData', base: base ? { zip: base.zip, path: base.path } : undefined });
      if (tableFile?.handle && (await writeHandle(tableFile.handle, bytes))) {
        setDirty(false);
        return;
      }
      const r = await saveFile(tableName || 'ImportData.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', () => bytes);
      if (r) {
        setDirty(false);
        if (typeof r === 'object') {
          setTableName(r.name);
          setTableFile({ name: r.name, handle: r.handle, read: async () => new Uint8Array(await (await r.handle.getFile()).arrayBuffer()) });
        }
      }
    } catch (e) {
      setErr(t('tbl.saveError', { msg: (e as Error).message }));
    }
  };

  // горячие клавиши отмены — когда фокус не в поле ввода
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!table || edit) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ——— проверка строк
  const srcIndex = useMemo(() => indexSources((sources?.files ?? []).map((f) => f.name)), [sources]);
  const plans = useMemo(() => (table ? planTable(table, srcIndex) : []), [table, srcIndex]);
  const counts = useMemo(() => {
    const c = { all: 0, ok: 0, warning: 0, error: 0, outputs: 0 };
    for (const p of plans) {
      if (p.status === 'empty') continue;
      c.all++;
      c[p.status]++;
      if (p.status !== 'error') c.outputs += p.outputs.length;
    }
    return c;
  }, [plans]);
  const nFmt = (fmt.ies ? 1 : 0) + (fmt.ldt ? 1 : 0);
  const visible = plans.filter((p) => filter === 'all' || p.status === filter || (filter === 'warning' && p.status === 'warning'));

  const msgText = (m: RowMessage) => t(`tbl.msg.${m.code}`, { ...m.params, col: m.col ?? m.params?.col ?? '' });

  // ——— колонки: состояние и артикул закреплены слева, остальные — по порядку таблицы
  const artCol = table ? colIdx(table, 'LuminaireNumber') : -1;
  const order = table ? [...(artCol >= 0 ? [artCol] : []), ...table.columns.map((_, i) => i).filter((i) => i !== artCol)] : [];

  // ——— выделение диапазона ячеек
  const visRows = visible.map((p) => p.row);
  const selRows = useMemo(() => {
    if (!range) return [] as number[];
    const a = visRows.indexOf(range.r0);
    const b = visRows.indexOf(range.r1);
    if (a < 0 || b < 0) return visRows.includes(range.r1) ? [range.r1] : [];
    return visRows.slice(Math.min(a, b), Math.max(a, b) + 1);
  }, [range, visRows.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = useMemo(() => new Set(selRows), [selRows]);
  const focus = range?.r1 ?? null;
  const cMin = range ? Math.min(range.c0, range.c1) : 0;
  const cMax = range ? Math.max(range.c0, range.c1) : -1;
  const inRange = (r: number, ci: number) => sel.has(r) && ci >= cMin && ci <= cMax;

  useEffect(() => {
    const up = () => {
      dragRef.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  /** Записать матрицу значений начиная с левого верхнего угла выделения; одно значение — во все ячейки выделения. */
  const pasteText = (text: string) => {
    if (!table || !range || running) return;
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    const m = lines.map((l) => l.split('\t').map((x) => x.trim()));
    const rows = table.rows.map((r) => [...r]);
    const vis = [...visRows];
    if (m.length === 1 && m[0].length === 1) {
      for (const r of selRows) for (let ci = cMin; ci <= cMax; ci++) rows[r][order[ci]] = m[0][0];
    } else {
      const start = vis.indexOf(selRows[0] ?? range.r1);
      for (let i = 0; i < m.length; i++) {
        let r = vis[start + i];
        if (r == null) {
          if (filter !== 'all') break;
          rows.push(table.columns.map(() => ''));
          r = rows.length - 1;
          vis.push(r);
        }
        for (let j = 0; j < m[i].length; j++) {
          const ci = cMin + j;
          if (ci >= order.length) break;
          rows[r][order[ci]] = m[i][j];
        }
      }
      const last = vis[Math.min(vis.length - 1, start + m.length - 1)];
      setRange({ r0: vis[start], c0: cMin, r1: last, c1: Math.min(order.length - 1, cMin + Math.max(...m.map((x) => x.length)) - 1) });
    }
    commit({ ...table, rows });
  };
  const copyText = () =>
    table && range ? selRows.map((r) => order.slice(cMin, cMax + 1).map((c) => table.rows[r][c] ?? '').join('\t')).join('\n') : '';
  const clearRange = () => {
    if (!table || !range) return;
    const rows = table.rows.map((r, i) => (sel.has(i) ? r.map((x, j) => (order.indexOf(j) >= cMin && order.indexOf(j) <= cMax ? '' : x)) : r));
    commit({ ...table, rows });
  };

  // вставка / копирование / очистка / стрелки — когда фокус не в поле ввода
  useEffect(() => {
    const outside = (e: Event) => {
      const tag = (e.target as HTMLElement)?.tagName;
      return !edit && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT';
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!outside(e) || !range) return;
      const txt = e.clipboardData?.getData('text/plain');
      if (txt == null) return;
      e.preventDefault();
      pasteText(txt);
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!outside(e) || !range || window.getSelection()?.toString()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', copyText());
    };
    const onKey = (e: KeyboardEvent) => {
      if (!outside(e) || !range || !table) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        clearRange();
      } else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        setEdit({ r: range.r1, c: order[range.c1], text: table.rows[range.r1]?.[order[range.c1]] ?? '' });
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const vi = visRows.indexOf(range.r1);
        const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const r1 = visRows[Math.max(0, Math.min(visRows.length - 1, vi + dr))] ?? range.r1;
        const c1 = Math.max(0, Math.min(order.length - 1, range.c1 + dc));
        setRange(e.shiftKey ? { ...range, r1, c1 } : { r0: r1, c0: c1, r1, c1 });
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('copy', onCopy);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('keydown', onKey);
    };
  });

  const pasteButton = async () => {
    try {
      pasteText(await navigator.clipboard.readText());
    } catch {
      setErr(t('tbl.pasteDenied'));
    }
  };

  // ——— запуск
  const run = async (onlySel: boolean) => {
    if (!table || !sources) return;
    const targets = plans.filter((p) => (p.status === 'ok' || p.status === 'warning') && (!onlySel || sel.has(p.row)));
    if (!targets.length || !nFmt) return;
    setErr(null);
    setResult(null);
    if (outDir && !(await ensureWrite(outDir))) {
      setErr(t('tbl.noWrite'));
      return;
    }
    const zip = outDir ? null : new JSZip();
    const errors: Result['errors'] = [];
    let written = 0;
    cancelRef.current = false;
    const byName = new Map(sources.files.map((f) => [f.name, f]));
    const ctx = houseCtx();
    const total = targets.length;
    setProgress({ done: 0, total, current: '' });
    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break;
      const pl = targets[i];
      setProgress({ done: i, total, current: pl.article });
      await tick();
      const f = pl.source ? byName.get(pl.source) : undefined;
      if (!f) {
        errors.push({ file: pl.article, msg: t('tbl.msg.noSource') });
        continue;
      }
      let p0;
      try {
        p0 = parseFile(await f.read(), f.name).photometry;
      } catch (e) {
        errors.push({ file: f.name, msg: t('tbl.readError', { name: f.name, msg: (e as Error).message }) });
        continue;
      }
      for (const o of pl.outputs) {
        try {
          const q = applyRow(p0, table, pl.row, o.set).photometry;
          const name = safeFileName(o.base);
          const put = async (sub: 'IES' | 'LDT', file: string, text: string) => {
            if (zip) zip.file(`${sub}/${file}`, text);
            else await writeInto(outDir!, sub, file, text);
            written++;
          };
          if (fmt.ies) await put('IES', `${name}.ies`, houseIES(q, ctx));
          if (fmt.ldt) await put('LDT', `${name}.ldt`, houseLDT(q, ctx, `${name}.ldt`));
        } catch (e) {
          errors.push({ file: o.base, msg: (e as Error).message });
        }
      }
    }
    const cancelled = cancelRef.current;
    setProgress(null);
    const res: Result = { written, rows: targets.length, errors, where: outDir ? outLabel : t('tbl.toZip') };
    if (zip && written) res.zip = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    setResult(res);
    if (cancelled) setErr(t('batch.cancelled'));
  };

  const focusPlan = focus != null ? plans[focus] : null;
  const running = progress != null;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const selReady = plans.filter((p) => sel.has(p.row) && (p.status === 'ok' || p.status === 'warning')).length;

  const chip = (ok: boolean | null, text: string) =>
    ok == null ? <span /> : <span className={`tchip ${ok ? 'ok' : 'bad'}`}>{text}</span>;

  return (
    <>
      <div className="modal-body tbl-body">
        <div className="tform">
          <span className="tlbl">{t('tbl.project')}</span>
          <span className="tpath" title={project?.name}>{project?.name || <span className="muted">{t('tbl.projectHint')}</span>}</span>
          <button className="btn tbtn" onClick={() => void openProject()} disabled={running}>
            <Ico d={ICONS.folder} size={15} />
            {t('tbl.choose')}
          </button>
          <span />

          <span className="tlbl">{t('tbl.table')}</span>
          {project && project.tables.length > 1 ? (
            <Select value={tableFile?.name ?? ''} onChange={(e) => void loadTable(project.tables.find((x) => x.name === e.target.value) ?? null)} className="tpath tsel" aria-label={t('tbl.table')}>
              {project.tables.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
            </Select>
          ) : (
            <span className={`tpath${project && !tableName ? ' bad' : ''}`}>{tableName ? `${tableName}${dirty ? ' •' : ''}` : project ? t('tbl.noTable') : ''}</span>
          )}
          <button className="btn tbtn" onClick={() => void otherTable()} disabled={running}>{t('tbl.other')}</button>
          {table ? chip(true, t('tbl.rows', { n: counts.all })) : chip(project ? false : null, t('tbl.notFound'))}

          <span className="tlbl">{t('tbl.sources')}</span>
          <span className={`tpath${project && !sources ? ' bad' : ''}`}>{sources ? `${sources.name}${'\\'}` : project ? t('tbl.noSources') : ''}</span>
          <button className="btn tbtn" onClick={() => void otherSources()} disabled={running}>{t('tbl.other')}</button>
          {sources ? chip(sources.files.length > 0, t('tbl.files', { n: sources.files.length })) : chip(project ? false : null, t('tbl.notFound'))}

          <span className="tlbl">{t('tbl.result')}</span>
          <span className="tpath muted">{outLabel || (fsa ? '' : t('tbl.toZip'))}</span>
          <button className="btn tbtn" onClick={() => void otherOutput()} disabled={running || !fsa} title={fsa ? '' : t('tbl.zipOnly')}>{t('tbl.change')}</button>
          <span className="ttoggles" role="group" aria-label={t('tbl.formats')}>
            {(['ies', 'ldt'] as const).map((k) => (
              <button key={k} className={fmt[k] ? 'on' : ''} aria-pressed={fmt[k]} onClick={() => setFmt({ ...fmt, [k]: !fmt[k] })}>{k.toUpperCase()}</button>
            ))}
          </span>
        </div>

        <input ref={(el) => { projInput.current = el; if (el) el.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ''; if (l.length) void applyScan(scanFileList(l)); }} />
        <input ref={tableInput} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadTable({ name: f.name, read: async () => new Uint8Array(await f.arrayBuffer()) }); }} />
        <input ref={(el) => { srcInput.current = el; if (el) el.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ''; if (l.length) setSources(fileListSources(l)); }} />

        {err && <p className="error small">{err}</p>}

        <div className="ttools">
          <button className="ib" title={t('tbl.addRow')} aria-label={t('tbl.addRow')} disabled={!table || running} onClick={addRow}><Ico d={ICONS.addRow} /></button>
          <button className="ib" title={t('tbl.delRows')} aria-label={t('tbl.delRows')} disabled={!table || running || (!sel.size && focus == null)} onClick={delRows}><Ico d={ICONS.delRow} /></button>
          <span className="tsep" />
          <button className="ib" title={t('tbl.undo')} aria-label={t('tbl.undo')} disabled={!past.length || running} onClick={undo}><Ico d={ICONS.undo} /></button>
          <button className="ib" title={t('tbl.redo')} aria-label={t('tbl.redo')} disabled={!future.length || running} onClick={redo}><Ico d={ICONS.redo} /></button>
          <span className="tsep" />
          <button className="ib" title={t('tbl.paste')} aria-label={t('tbl.paste')} disabled={!table || !range || running} onClick={() => void pasteButton()}><Ico d={ICONS.paste} /></button>
          <span className="tsep" />
          <button className="ib" title={t('tbl.newTable')} aria-label={t('tbl.newTable')} disabled={running} onClick={newTable}><Ico d={ICONS.newTable} /></button>
          <button className="ib" title={t('tbl.saveTable')} aria-label={t('tbl.saveTable')} disabled={!table || running} onClick={() => void saveTable()}><Ico d={ICONS.save} /></button>
          <span className="grow" />
          {table && (
            <span className="tfilters" role="group">
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('tbl.all', { n: counts.all })}</button>
              <button className={`warn${filter === 'warning' ? ' on' : ''}`} onClick={() => setFilter(filter === 'warning' ? 'all' : 'warning')} title={t('tbl.warnings')}>
                <StatusIcon s="warning" />
                {counts.warning}
              </button>
              <button className={`bad${filter === 'error' ? ' on' : ''}`} onClick={() => setFilter(filter === 'error' ? 'all' : 'error')} title={t('tbl.errors')}>
                <StatusIcon s="error" />
                {counts.error}
              </button>
            </span>
          )}
        </div>

        <div className="tgrid" ref={scrollRef}>
          {table ? (
            <table>
              <thead>
                <tr>
                  <th className="tst" />
                  {order.map((c) => (
                    <th key={c} className={c === artCol ? 'tart' : ''}>{table.columns[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((pl) => {
                  const r = pl.row;
                  const errCols = new Map<string, { text: string; level: RowMessage['level'] }>();
                  for (const m of pl.messages) {
                    if (!m.col) continue;
                    const k = m.col.toLowerCase();
                    const prev = errCols.get(k);
                    errCols.set(k, { text: (prev ? `${prev.text}\n` : '') + msgText(m), level: prev?.level === 'error' || m.level === 'error' ? 'error' : 'warning' });
                  }
                  return (
                    <tr key={r} className={`${sel.has(r) ? 'rsel' : ''}${focus === r ? ' rfocus' : ''}`}>
                      <td
                        className={`tst st-${pl.status}`}
                        title={pl.messages.map(msgText).join('\n')}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          dragRef.current = true;
                          setRange(e.shiftKey && range ? { ...range, r1: r, c0: 0, c1: order.length - 1 } : { r0: r, c0: 0, r1: r, c1: order.length - 1 });
                        }}
                        onMouseEnter={() => dragRef.current && range && setRange({ ...range, r1: r, c0: 0, c1: order.length - 1 })}
                      >
                        <StatusIcon s={pl.status} />
                      </td>
                      {order.map((c) => {
                        const name = table.columns[c].toLowerCase();
                        const bad = errCols.get(name);
                        const isEdit = edit && edit.r === r && edit.c === c;
                        const ci = order.indexOf(c);
                        return (
                          <td
                            key={c}
                            className={`${c === artCol ? 'tart ' : ''}${bad ? (bad.level === 'error' ? 'terr ' : 'twarn ') : ''}${!isEdit && inRange(r, ci) ? 'tin' : ''}`}
                            title={bad?.text}
                            onMouseDown={(e) => {
                              if (e.button !== 0 || isEdit) return;
                              e.preventDefault();
                              dragRef.current = true;
                              setRange(e.shiftKey && range ? { ...range, r1: r, c1: ci } : { r0: r, c0: ci, r1: r, c1: ci });
                            }}
                            onMouseEnter={() => dragRef.current && range && setRange({ ...range, r1: r, c1: ci })}
                            onDoubleClick={() => !running && setEdit({ r, c, text: table.rows[r][c] ?? '' })}
                          >
                            {isEdit ? (
                              <input
                                autoFocus
                                className="tedit"
                                value={edit.text}
                                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                                onBlur={() => {
                                  setCell(r, c, edit.text.trim());
                                  setEdit(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === 'Tab') {
                                    e.preventDefault();
                                    setCell(r, c, edit.text.trim());
                                    const i = order.indexOf(c);
                                    const nc = e.key === 'Tab' ? order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length] : c;
                                    const vi = visRows.indexOf(r);
                                    const nr = e.key === 'Enter' ? (visRows[Math.min(vi + 1, visRows.length - 1)] ?? r) : r;
                                    const nci = order.indexOf(nc);
                                    setEdit(null);
                                    setRange({ r0: nr, c0: nci, r1: nr, c1: nci });
                                  } else if (e.key === 'Escape') setEdit(null);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setEdit({ ...edit, text: '' });
                                }}
                              />
                            ) : (
                              table.rows[r][c]
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="tempty muted">{project ? t('tbl.emptyNoTable') : t('tbl.emptyStart')}</div>
          )}
        </div>
        {table && <p className="muted small thint">{t('tbl.hint')}</p>}

        {focusPlan && focusPlan.status !== 'empty' && (
          <div className="tdet small">
            <b>{focusPlan.article || '—'}</b>
            {focusPlan.source && (
              <>
                {' — '}
                {t('tbl.detSource', { file: focusPlan.source })} · {t('tbl.detSym', { sym: focusPlan.symmetry ? t(`ops.sym_${focusPlan.symmetry}`) : t('tbl.symNone') })} · {t('tbl.detNorm')}
              </>
            )}
            {focusPlan.outputs.length > 0 && focusPlan.status !== 'error' && (
              <div>
                {t('tbl.detOut', { n: focusPlan.outputs.length * nFmt })}: {focusPlan.outputs.map((o) => `«${o.base}»`).join(', ')}
                {nFmt ? ` — ${[fmt.ies && 'IES', fmt.ldt && 'LDT'].filter(Boolean).join(', ')}` : ''}
              </div>
            )}
            {focusPlan.messages.map((m, i) => (
              <div key={i} className={m.level === 'error' ? 'error' : 'warn'}>{msgText(m)}</div>
            ))}
          </div>
        )}
      </div>

      <footer className="batch-foot">
        {running ? (
          <div className="bprogress">
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <span className="small">{progress.done} / {progress.total} <span className="muted">· {progress.current}</span></span>
            <button className="btn small" onClick={() => { cancelRef.current = true; }}>{t('batch.cancel')}</button>
          </div>
        ) : result ? (
          <div className="bresult">
            <p className="small">
              <b>{t('tbl.done', { files: result.written, rows: result.rows })}</b> <span className="muted">· {result.where}</span>
            </p>
            {result.errors.length > 0 && (
              <details className="small">
                <summary className="error">{t('batch.errors', { n: result.errors.length })}</summary>
                <ul className="blog">{result.errors.slice(0, 50).map((e, i) => <li key={i}><b>{e.file}</b>: {e.msg}</li>)}</ul>
              </details>
            )}
            <div className="row">
              {result.zip && <button className="gsbtn" onClick={() => void saveFile(`${safeFileName(project?.name || 'photometry')}.zip`, 'application/zip', 'zip', () => result.zip!)}>{t('batch.saveZip')}</button>}
              <button className="link small" onClick={() => setResult(null)}>{t('batch.again')}</button>
            </div>
          </div>
        ) : (
          <div className="tfoot">
            <span className="small muted">
              {!table
                ? t('tbl.needTable')
                : !sources
                  ? t('tbl.needSources')
                  : !nFmt
                    ? t('tbl.needFormat')
                    : t('tbl.summary', { ok: counts.ok + counts.warning, skip: counts.error, files: counts.outputs * nFmt })}
            </span>
            <button className="btn tbtn" disabled={!table || !sources || !nFmt || !selReady} onClick={() => void run(true)}>{t('tbl.runSelected')}</button>
            <button className="gsbtn" disabled={!table || !sources || !nFmt || counts.ok + counts.warning === 0} onClick={() => void run(false)}>{t('tbl.run')}</button>
          </div>
        )}
      </footer>
    </>
  );
}
