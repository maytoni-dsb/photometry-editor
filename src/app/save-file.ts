/**
 * Сохранение файла: в Chrome / Edge — системный диалог «Сохранить как» (можно поправить имя),
 * в остальных браузерах — обычная загрузка с именем по умолчанию.
 */

type Data = string | Uint8Array | Blob;

interface PickerWindow {
  showSaveFilePicker?: (o: {
    suggestedName: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }>;
}

function toBlob(d: Data, mime: string): Blob {
  if (d instanceof Blob) return d;
  return new Blob([d as BlobPart], { type: mime });
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Спрашивает место и имя (если браузер умеет), затем строит файл и записывает.
 * Диалог открывается до построения файла — иначе браузер может отказать без жеста пользователя.
 * Возвращает false, если пользователь отменил сохранение.
 */
export async function saveFile(name: string, mime: string, ext: string, produce: () => Promise<Data> | Data): Promise<boolean> {
  const w = window as unknown as PickerWindow;
  if (w.showSaveFilePicker && window.self === window.top) {
    let handle;
    try {
      handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }] });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      handle = null; // диалог недоступен — обычная загрузка
    }
    if (handle) {
      const blob = toBlob(await produce(), mime);
      const wr = await handle.createWritable();
      await wr.write(blob);
      await wr.close();
      return true;
    }
  }
  download(toBlob(await produce(), mime), name);
  return true;
}

/** Имя файла без запрещённых в Windows символов. */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'photometry';
}
