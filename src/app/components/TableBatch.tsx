/**
 * Пакетная обработка «По таблице»: папка проекта (таблица ImportData + папка photometry), просмотр и правка
 * таблицы, проверка строк, запуск — файлы IES / LDT в папки рядом с photometry (или ZIP).
 * Логика строк — src/batch/import-table.ts.
 */
import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseFile, typeBToC, writeIES, writeLDT } from '../../core/index';
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
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState<number | null>(null);
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
      setSel(new Set());
      setFocus(null);
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
    setFocus(at);
    setSel(new Set([at]));
  };
  const delRows = () => {
    if (!table) return;
    const kill = sel.size ? sel : focus != null ? new Set([focus]) : new Set<number>();
    if (!kill.size) return;
    commit({ ...table, rows: table.rows.filter((_, i) => !kill.has(i)) });
    setSel(new Set());
    setFocus(null);
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
    setSel(new Set());
    setFocus(0);
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
          if (fmt.ies) await put('IES', `${name}.ies`, writeIES(q, { lineEnding: 'CRLF' }));
          if (fmt.ldt) await put('LDT', `${name}.ldt`, writeLDT(q.photometryType === 'B' ? typeBToC(q).photometry : q, { lineEnding: 'CRLF', fileName: `${name}.ldt` }).text);
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

  const rowClick = (e: React.MouseEvent, r: number) => {
    setFocus(r);
    if (e.shiftKey && focus != null) {
      const [a, b] = [Math.min(focus, r), Math.max(focus, r)];
      setSel(new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i)));
    } else if (e.ctrlKey || e.metaKey) {
      const s = new Set(sel);
      if (s.has(r)) s.delete(r);
      else s.add(r);
      setSel(s);
    } else setSel(new Set([r]));
  };

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
                    <tr key={r} className={`${sel.has(r) ? 'rsel' : ''}${focus === r ? ' rfocus' : ''}`} onClick={(e) => rowClick(e, r)}>
                      <td className={`tst st-${pl.status}`} title={pl.messages.map(msgText).join('\n')}>
                        <StatusIcon s={pl.status} />
                      </td>
                      {order.map((c) => {
                        const name = table.columns[c].toLowerCase();
                        const bad = errCols.get(name);
                        const isEdit = edit && edit.r === r && edit.c === c;
                        return (
                          <td
                            key={c}
                            className={`${c === artCol ? 'tart ' : ''}${bad ? (bad.level === 'error' ? 'terr' : 'twarn') : ''}`}
                            title={bad?.text}
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
                                    const nr = e.key === 'Enter' ? Math.min(r + 1, table.rows.length - 1) : r;
                                    setEdit({ r: nr, c: nc, text: table.rows[nr]?.[nc] ?? '' });
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
