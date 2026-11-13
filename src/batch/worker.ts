/**
 * Фоновый поток пакетной обработки: интерфейс не зависает на сотнях файлов.
 * Сообщения: run → progress* → done | cancelled | error; cancel — прервать.
 */

import type { FontSet } from '../charts/fonts';
import { BatchCancelled, runBatch, type BatchInput, type BatchJob, type BatchProgress, type BatchResult } from './run';

export type WorkerRequest =
  | { type: 'run'; inputs: Array<{ name: string; file: Blob }>; job: BatchJob; fonts: FontSet | null }
  | { type: 'cancel' };

export type WorkerResponse =
  | { type: 'progress'; progress: BatchProgress }
  | { type: 'done'; result: BatchResult }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

interface WorkerScope {
  postMessage(m: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}
const ctx = self as unknown as WorkerScope;
let cancelled = false;
const post = (m: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  try {
    // файлы читаются здесь, а не в основном потоке
    const inputs: BatchInput[] = [];
    for (let i = 0; i < m.inputs.length; i++) {
      if (cancelled) throw new BatchCancelled();
      inputs.push({ name: m.inputs[i].name, bytes: new Uint8Array(await m.inputs[i].file.arrayBuffer()) });
    }
    let last = 0;
    let lastPhase = '';
    const result = await runBatch(inputs, m.job, {
      fonts: m.fonts,
      cancelled: () => cancelled,
      onProgress: (progress) => {
        // не чаще 20 раз в секунду, но смену этапа — сразу
        const now = Date.now();
        if (progress.phase === lastPhase && now - last < 50 && progress.done < progress.total) return;
        last = now;
        lastPhase = progress.phase;
        post({ type: 'progress', progress });
      },
    });
    post({ type: 'done', result }, [result.zip.buffer]);
  } catch (err) {
    if (err instanceof BatchCancelled) post({ type: 'cancelled' });
    else post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
