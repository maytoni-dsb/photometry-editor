/** Команды, которые вызываются и из интерфейса вкладок, и из меню. */

import { houseIES, houseLDT } from '../batch/house';
import { houseCtx } from './user';
import { baseName, type OpenFile } from './doc';
import { safeFileName, saveFile } from './save-file';

/** Сохраняет открытый файл в IES или LDT (имя по умолчанию — как у исходного). */
/** Имя файла при сохранении: артикул, если он задан, иначе имя открытого файла. */
export const saveBase = (file: OpenFile): string => file.parse.photometry.meta.article.trim() || baseName(file.name);

/** Текст файла в формате fmt (name — имя файла на диске, для строки 11 LDT). */
export function fileText(file: OpenFile, fmt: 'ies' | 'ldt', name: string): string {
  const p = file.parse.photometry;
  if (fmt === 'ies') return houseIES(p, houseCtx(), { lineEnding: p.source.lineEnding });
  return houseLDT(p, houseCtx(), name);
}

/** Формат файла по расширению имени (созданные операцией — по исходному формату, иначе LDT). */
export const formatOf = (file: OpenFile): 'ies' | 'ldt' =>
  /\.ies$/i.test(file.name) ? 'ies' : /\.ldt$/i.test(file.name) ? 'ldt' : file.parse.photometry.source.format === 'IES' ? 'ies' : 'ldt';

/** «Сохранить как»: диалог с именем; новое имя и файл на диске (если браузер их даёт) или null при отмене. */
export async function saveAs(file: OpenFile, fmt: 'ies' | 'ldt'): Promise<{ name: string; handle?: FileSystemFileHandle } | null> {
  const name = `${safeFileName(saveBase(file))}.${fmt}`;
  const r = await saveFile(name, 'text/plain', fmt, (n) => fileText(file, fmt, n));
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
