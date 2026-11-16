/** Команды, которые вызываются и из интерфейса вкладок, и из меню. */

import { typeBToC, writeIES, writeLDT } from '../core/index';
import { baseName, type OpenFile } from './doc';
import { safeFileName, saveFile } from './save-file';

/** Сохраняет открытый файл в IES или LDT (имя по умолчанию — как у исходного). */
/** Текст файла в формате fmt. */
export function fileText(file: OpenFile, fmt: 'ies' | 'ldt', name: string): string {
  const p = file.parse.photometry;
  if (fmt === 'ies') return writeIES(p, { lineEnding: p.source.lineEnding });
  const c = p.photometryType === 'B' ? typeBToC(p).photometry : p;
  return writeLDT(c, { lineEnding: 'CRLF', fileName: name }).text;
}

/** Формат файла по расширению имени (созданные операцией — по исходному формату, иначе LDT). */
export const formatOf = (file: OpenFile): 'ies' | 'ldt' =>
  /\.ies$/i.test(file.name) ? 'ies' : /\.ldt$/i.test(file.name) ? 'ldt' : file.parse.photometry.source.format === 'IES' ? 'ies' : 'ldt';

/** «Сохранить как»: диалог с именем; новое имя и файл на диске (если браузер их даёт) или null при отмене. */
export async function saveAs(file: OpenFile, fmt: 'ies' | 'ldt'): Promise<{ name: string; handle?: FileSystemFileHandle } | null> {
  const name = `${safeFileName(baseName(file.name))}.${fmt}`;
  const r = await saveFile(name, 'text/plain', fmt, () => fileText(file, fmt, name));
  if (!r) return null;
  return r === true ? { name } : { name: r.name, handle: r.handle };
}

type RWHandle = FileSystemFileHandle & {
  queryPermission?(o: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<string>;
  createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>;
};

/** «Сохранить» в тот же файл на диске. false — записать нельзя (нет файла или доступа). */
export async function saveToHandle(file: OpenFile): Promise<boolean> {
  const h = file.handle as RWHandle | undefined;
  if (!h) return false;
  if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!h.requestPermission || (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  }
  const w = await h.createWritable();
  await w.write(fileText(file, formatOf(file), h.name));
  await w.close();
  return true;
}

export type ExportFormat = 'svg' | 'pdf' | 'eps' | 'png';

/** Просит открытую вкладку графика выгрузить его (вызов из меню). */
export function requestChartExport(fmt: ExportFormat): void {
  window.dispatchEvent(new CustomEvent<ExportFormat>('pe:export', { detail: fmt }));
}
