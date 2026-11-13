/**
 * Подключённая папка: файлы IES / LDT папки (с вложенными) видны в списке слева и обновляются,
 * когда в папке что-то меняется.
 *
 * Chrome / Edge — File System Access API: папка выбирается или перетаскивается, доступ хранится
 * в браузере (IndexedDB), изменения отслеживаются (FileSystemObserver, где он есть, иначе опрос
 * раз в несколько секунд). После перезагрузки страницы браузер просит подтвердить доступ одним щелчком.
 * Остальные браузеры — снимок папки через <input webkitdirectory>, без отслеживания.
 */

export interface FolderEntry {
  /** Путь внутри папки, через «/». */
  path: string;
  name: string;
  size: number;
  lastModified: number;
  handle?: FileSystemFileHandle;
  /** Снимок (браузеры без File System Access). */
  file?: File;
}

export interface FolderState {
  name: string;
  entries: FolderEntry[];
  /** Изменения отслеживаются. */
  live: boolean;
  /** Доступ после перезагрузки страницы ещё не подтверждён. */
  needsPermission?: boolean;
  handle?: FileSystemDirectoryHandle;
}

type PermState = 'granted' | 'denied' | 'prompt';
interface PermHandle {
  queryPermission?(o: { mode: 'read' }): Promise<PermState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermState>;
}
interface DirIter {
  values(): AsyncIterable<FileSystemHandle>;
}

const PHOT = /\.(ies|ldt)$/i;

export const canWatchFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (window as unknown as { showDirectoryPicker(o?: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read', id: 'photometry' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const sortEntries = (a: FolderEntry, b: FolderEntry) => collator.compare(a.path, b.path);

/** Все файлы IES / LDT папки и вложенных папок. */
export async function scanFolder(dir: FileSystemDirectoryHandle): Promise<FolderEntry[]> {
  const out: FolderEntry[] = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string) => {
    for await (const h of (d as unknown as DirIter).values()) {
      if (h.kind === 'directory') {
        if (!h.name.startsWith('.')) await walk(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`);
      } else if (PHOT.test(h.name)) {
        try {
          const f = await (h as FileSystemFileHandle).getFile();
          out.push({ path: prefix + h.name, name: h.name, size: f.size, lastModified: f.lastModified, handle: h as FileSystemFileHandle });
        } catch {
          /* файл исчез во время обхода */
        }
      }
    }
  };
  await walk(dir, '');
  return out.sort(sortEntries);
}

/** Снимок папки из <input webkitdirectory> или перетаскивания без File System Access. */
export function entriesFromFiles(files: Array<{ file: File; path?: string }>): FolderEntry[] {
  return files
    .filter((f) => PHOT.test(f.file.name))
    .map((f) => {
      const rel = (f.path || f.file.name).split('/');
      const path = rel.length > 1 ? rel.slice(1).join('/') : rel[0]; // без имени корневой папки
      return { path, name: f.file.name, size: f.file.size, lastModified: f.file.lastModified, file: f.file };
    })
    .sort(sortEntries);
}

export async function readEntry(e: FolderEntry): Promise<Uint8Array> {
  const f = e.file ?? (await e.handle!.getFile());
  return new Uint8Array(await f.arrayBuffer());
}

export async function entryBlob(e: FolderEntry): Promise<Blob> {
  return e.file ?? (await e.handle!.getFile());
}

export interface FolderDiff {
  added: FolderEntry[];
  removed: FolderEntry[];
  changed: FolderEntry[];
}

export function diffEntries(prev: FolderEntry[], next: FolderEntry[]): FolderDiff {
  const old = new Map(prev.map((e) => [e.path, e]));
  const now = new Map(next.map((e) => [e.path, e]));
  const added: FolderEntry[] = [];
  const changed: FolderEntry[] = [];
  for (const e of next) {
    const o = old.get(e.path);
    if (!o) added.push(e);
    else if (o.lastModified !== e.lastModified || o.size !== e.size) changed.push(e);
  }
  const removed = prev.filter((e) => !now.has(e.path));
  return { added, removed, changed };
}

// ——— доступ к папке после перезагрузки (IndexedDB) ———

const DB = 'photometry-editor';
const STORE = 'handles';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberFolder(h: FileSystemDirectoryHandle | null): Promise<void> {
  try {
    await idb(h ? 'readwrite' : 'readwrite', (s) => (h ? s.put(h, 'folder') : s.delete('folder')));
  } catch {
    /* IndexedDB недоступна (приватное окно) — папку придётся выбрать заново */
  }
}

export async function recallFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idb<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get('folder'))) ?? null;
  } catch {
    return null;
  }
}

/** Есть ли доступ на чтение; ask — спросить пользователя (только по щелчку). */
export async function folderPermission(h: FileSystemDirectoryHandle, ask = false): Promise<boolean> {
  const p = h as unknown as PermHandle;
  if (!p.queryPermission) return true;
  if ((await p.queryPermission({ mode: 'read' })) === 'granted') return true;
  if (!ask || !p.requestPermission) return false;
  return (await p.requestPermission({ mode: 'read' })) === 'granted';
}

/**
 * Следит за папкой: FileSystemObserver, если браузер его знает, плюс опрос (когда вкладка видна).
 * onTick вызывается, когда, возможно, что-то изменилось. Возвращает функцию остановки.
 */
export function watchFolder(h: FileSystemDirectoryHandle, onTick: () => void, intervalMs = 3000): () => void {
  let observer: { observe(h: FileSystemHandle, o: object): Promise<void>; disconnect(): void } | null = null;
  const Obs = (window as unknown as { FileSystemObserver?: new (cb: () => void) => typeof observer }).FileSystemObserver;
  if (Obs) {
    try {
      observer = new Obs(() => onTick());
      void observer!.observe(h, { recursive: true }).catch(() => {
        observer = null;
      });
    } catch {
      observer = null;
    }
  }
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') onTick();
  }, observer ? intervalMs * 4 : intervalMs);
  const onVisible = () => document.visibilityState === 'visible' && onTick();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    observer?.disconnect();
  };
}
