/** Команды, которые вызываются и из интерфейса вкладок, и из меню. */

import { typeBToC, writeIES, writeLDT } from '../core/index';
import { baseName, type OpenFile } from './doc';
import { safeFileName, saveFile } from './save-file';

/** Сохраняет открытый файл в IES или LDT (имя по умолчанию — как у исходного). */
export async function saveAs(file: OpenFile, fmt: 'ies' | 'ldt'): Promise<void> {
  const p = file.parse.photometry;
  const name = `${safeFileName(baseName(file.name))}.${fmt}`;
  await saveFile(name, 'text/plain', fmt, () => {
    if (fmt === 'ies') return writeIES(p, { lineEnding: p.source.lineEnding });
    const c = p.photometryType === 'B' ? typeBToC(p).photometry : p;
    return writeLDT(c, { lineEnding: 'CRLF', fileName: name }).text;
  });
}

export type ExportFormat = 'svg' | 'pdf' | 'eps' | 'png';

/** Просит открытую вкладку графика выгрузить его (вызов из меню). */
export function requestChartExport(fmt: ExportFormat): void {
  window.dispatchEvent(new CustomEvent<ExportFormat>('pe:export', { detail: fmt }));
}
