/** Файлы из перетаскивания, включая содержимое папок (рекурсивно). */

interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?(ok: (f: File) => void, err: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (list: Entry[]) => void, err: (e: unknown) => void): void };
}

export interface DroppedFile {
  name: string;
  file: File;
  path?: string;
}

async function walk(e: Entry, out: DroppedFile[]): Promise<void> {
  if (e.isFile && e.file) {
    const f = await new Promise<File>((ok, err) => e.file!(ok, err));
    out.push({ name: f.name, file: f, path: e.fullPath.replace(/^\//, '') });
  } else if (e.isDirectory && e.createReader) {
    const reader = e.createReader();
    // readEntries отдаёт папку порциями — читаем, пока не вернёт пустой список
    for (;;) {
      const list = await new Promise<Entry[]>((ok, err) => reader.readEntries(ok, err));
      if (!list.length) break;
      for (const x of list) await walk(x, out);
    }
  }
}

export async function droppedFiles(dt: DataTransfer): Promise<DroppedFile[]> {
  const entries: Entry[] = [];
  for (const it of [...dt.items]) {
    const e = (it as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  if (!entries.length) return [...dt.files].map((f) => ({ name: f.name, file: f }));
  const out: DroppedFile[] = [];
  for (const e of entries) await walk(e, out);
  return out;
}
