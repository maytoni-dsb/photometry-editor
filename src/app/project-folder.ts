/**
 * Папка проекта для пакетной обработки по таблице: в ней лежат таблица ImportData*.xlsx и папка
 * photometry (имя без учёта регистра) с исходными файлами; результат — папки IES и LDT рядом с photometry.
 *
 * Chrome / Edge — File System Access API (папка с правом записи). Остальные браузеры — снимок
 * через <input webkitdirectory>, результат — ZIP.
 */

export interface ProjectFile {
  name: string;
  read(): Promise<Uint8Array>;
  /** Файл на диске — можно записать обратно. */
  handle?: FileSystemFileHandle;
}

export interface ProjectScan {
  /** Имя папки проекта. */
  name: string;
  dir?: FileSystemDirectoryHandle;
  /** Таблицы .xlsx в корне папки; ImportData* — первыми. */
  tables: ProjectFile[];
  /** Папка с исходниками (photometry) — её имя и файлы IES / LDT. */
  sources: { name: string; files: ProjectFile[] } | null;
}

interface DirIter {
  values(): AsyncIterable<FileSystemHandle>;
}
type PermState = 'granted' | 'denied' | 'prompt';
interface PermHandle {
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermState>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermState>;
}
interface PickerWin {
  showDirectoryPicker?(o?: object): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?(o?: object): Promise<FileSystemFileHandle[]>;
}

export const canWriteFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window && window.self === window.top;

const PHOT = /\.(ies|ldt)$/i;
const XLSX = /\.xlsx$/i;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byTable = (a: ProjectFile, b: ProjectFile) => {
  const ia = /^importdata/i.test(a.name) ? 0 : 1;
  const ib = /^importdata/i.test(b.name) ? 0 : 1;
  return ia - ib || collator.compare(a.name, b.name);
};

const fromHandle = (h: FileSystemFileHandle): ProjectFile => ({
  name: h.name,
  handle: h,
  read: async () => new Uint8Array(await (await h.getFile()).arrayBuffer()),
});
const fromFile = (f: File, name = f.name): ProjectFile => ({ name, read: async () => new Uint8Array(await f.arrayBuffer()) });

async function pickDir(id: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (window as unknown as PickerWin).showDirectoryPicker!({ mode: 'readwrite', id });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

/** Файлы IES / LDT папки (без вложенных). */
async function photometryFiles(d: FileSystemDirectoryHandle): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];
  for await (const h of (d as unknown as DirIter).values()) if (h.kind === 'file' && PHOT.test(h.name)) out.push(fromHandle(h as FileSystemFileHandle));
  return out.sort((a, b) => collator.compare(a.name, b.name));
}

export async function scanProject(dir: FileSystemDirectoryHandle): Promise<ProjectScan> {
  const tables: ProjectFile[] = [];
  let src: FileSystemDirectoryHandle | null = null;
  for await (const h of (dir as unknown as DirIter).values()) {
    if (h.kind === 'file' && XLSX.test(h.name) && !h.name.startsWith('~$')) tables.push(fromHandle(h as FileSystemFileHandle));
    if (h.kind === 'directory' && h.name.trim().toLowerCase() === 'photometry') src = h as FileSystemDirectoryHandle;
  }
  return { name: dir.name, dir, tables: tables.sort(byTable), sources: src ? { name: src.name, files: await photometryFiles(src) } : null };
}

/** Выбрать папку проекта (Chrome / Edge). null — отменено. */
export async function pickProject(): Promise<ProjectScan | null> {
  const d = await pickDir('photometry-project');
  return d ? scanProject(d) : null;
}

/** Снимок папки проекта из <input webkitdirectory> (браузеры без File System Access). */
export function scanFileList(files: File[]): ProjectScan {
  const rel = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split('/');
  const name = files.length ? rel(files[0])[0] : '';
  const tables: ProjectFile[] = [];
  const src: ProjectFile[] = [];
  let srcName = '';
  for (const f of files) {
    const parts = rel(f);
    if (parts.length === 2 && XLSX.test(f.name) && !f.name.startsWith('~$')) tables.push(fromFile(f));
    if (parts.length === 3 && parts[1].trim().toLowerCase() === 'photometry' && PHOT.test(f.name)) {
      srcName = parts[1];
      src.push(fromFile(f));
    }
  }
  return { name, tables: tables.sort(byTable), sources: srcName ? { name: srcName, files: src.sort((a, b) => collator.compare(a.name, b.name)) } : null };
}

/** Выбрать другую таблицу (.xlsx). */
export async function pickTableFile(): Promise<ProjectFile | null> {
  const w = window as unknown as PickerWin;
  if (!w.showOpenFilePicker || window.self !== window.top) return null;
  try {
    const [h] = await w.showOpenFilePicker({ id: 'photometry-table', types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
    return h ? fromHandle(h) : null;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

/** Выбрать другую папку с исходниками. */
export async function pickSourceDir(): Promise<{ name: string; files: ProjectFile[] } | null> {
  const d = await pickDir('photometry-sources');
  return d ? { name: d.name, files: await photometryFiles(d) } : null;
}

/** Выбрать папку для результата (в ней будут IES / LDT). */
export const pickOutputDir = () => pickDir('photometry-output');

export const fileListSources = (files: File[]) => ({
  name: files.length ? ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '').split('/')[0] || '' : '',
  files: files.filter((f) => PHOT.test(f.name)).map((f) => fromFile(f)),
});

export async function ensureWrite(h: FileSystemHandle): Promise<boolean> {
  const p = h as unknown as PermHandle;
  if (!p.queryPermission) return true;
  if ((await p.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await p.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

type Writable = { write(d: Blob | string | Uint8Array): Promise<void>; close(): Promise<void> };

/** Записать файл в подпапку sub папки dir (создаётся при необходимости). */
export async function writeInto(dir: FileSystemDirectoryHandle, sub: string, name: string, data: string | Uint8Array): Promise<void> {
  const d = sub ? await dir.getDirectoryHandle(sub, { create: true }) : dir;
  const fh = await d.getFileHandle(name, { create: true });
  const w = (await (fh as unknown as { createWritable(): Promise<Writable> }).createWritable()) as Writable;
  await w.write(data);
  await w.close();
}

/** Записать файл на место (таблица). */
export async function writeHandle(h: FileSystemFileHandle, data: Uint8Array): Promise<boolean> {
  if (!(await ensureWrite(h))) return false;
  const w = (await (h as unknown as { createWritable(): Promise<Writable> }).createWritable()) as Writable;
  await w.write(data);
  await w.close();
  return true;
}
