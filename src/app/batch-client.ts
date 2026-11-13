/** Запуск пакетной обработки в фоновом потоке (Web Worker). */

import type { FontSet } from '../charts/fonts';
import type { BatchJob, BatchProgress, BatchResult } from '../batch/run';
import type { WorkerRequest, WorkerResponse } from '../batch/worker';

export interface BatchRun {
  done: Promise<BatchResult | null>;
  cancel(): void;
}

/** Результат null — пакет отменён. */
export function startBatch(
  inputs: Array<{ name: string; file: Blob }>,
  job: BatchJob,
  fonts: FontSet | null,
  onProgress: (p: BatchProgress) => void,
): BatchRun {
  const w = new Worker(new URL('../batch/worker.ts', import.meta.url), { type: 'module' });
  const done = new Promise<BatchResult | null>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.progress);
      else {
        w.terminate();
        if (m.type === 'done') resolve(m.result);
        else if (m.type === 'cancelled') resolve(null);
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'worker'));
    };
  });
  const req: WorkerRequest = { type: 'run', inputs, job, fonts };
  w.postMessage(req);
  return { done, cancel: () => w.postMessage({ type: 'cancel' } satisfies WorkerRequest) };
}
