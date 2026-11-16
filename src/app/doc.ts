/** Открытый файл: модель, сводка, замечания и история операций (отмена / повтор). */

import {
  parseFile,
  summarize,
  typeBToC,
  validatePhotometry,
  workFrom,
  type Issue,
  type Work,
  type OpSpec,
  type ParseResult,
  type Photometry,
  type PhotometrySummary,
} from '../core/index';

/** Состояние файла на одном шаге истории. */
export interface DocState {
  parse: ParseResult;
  summary: PhotometrySummary;
  /** Замечания разбора, последней операции и проверки. */
  issues: Issue[];
  /** Название шага, который привёл к этому состоянию (пусто — исходный файл). */
  label: string;
  /** Описание операции — шаг рецепта. */
  spec?: OpSpec;
  /** Рабочее тело операций (интерполянт); у исходного файла создаётся при первой операции. */
  work?: Work;
}

export interface OpenFile extends DocState {
  id: string;
  name: string;
  /** Предыдущие состояния (последнее — ближайшее). */
  past: DocState[];
  /** Отменённые состояния для «Повторить». */
  future: DocState[];
  /** Файл создан операцией (сложение), а не открыт с диска. */
  derived?: boolean;
  /** Путь в подключённой папке (файл из папки). */
  folderPath?: string;
  /** Файл в папке изменился или удалён, а в редакторе есть несохранённые правки. */
  disk?: 'changed' | 'removed';
  /** Файл на диске (открыт через системный диалог, из папки или перетаскиванием) — для «Сохранить». */
  handle?: FileSystemFileHandle;
  /** Длина истории в момент последнего сохранения (нет — файл не сохранялся после открытия). */
  savedLen?: number;
}

/** Не больше стольких шагов отмены на файл. */
const HISTORY_LIMIT = 50;

let seq = 0;

function makeState(parse: ParseResult, extra: Issue[], label: string, spec?: OpSpec, fileName?: string, work?: Work): DocState {
  const p = parse.photometry;
  const summary = summarize(p);
  const issues = [...parse.issues, ...extra];
  if (p.photometryType === 'B') issues.push(...typeBToC(p).issues.filter((i) => i.code === 'typeb-light-outside'));
  issues.push(...validatePhotometry(summary.asC, { fileName }));
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { parse, summary, issues, label, spec, work };
}

export function openBytes(name: string, bytes: Uint8Array): OpenFile {
  const parse = parseFile(bytes, name);
  return { id: `f${++seq}`, name, ...makeState(parse, [], '', undefined, name), past: [], future: [] };
}

/** Новый файл из модели (результат сложения). */
export function newDoc(name: string, p: Photometry, issues: Issue[], label: string, work?: Work): OpenFile {
  return { id: `f${++seq}`, name, ...makeState({ photometry: p, issues: [] }, issues, label, undefined, undefined, work), past: [], future: [], derived: true };
}

function stateOf(f: OpenFile): DocState {
  return { parse: f.parse, summary: f.summary, issues: f.issues, label: f.label, spec: f.spec, work: f.work };
}

const works = new WeakMap<object, Work>();

/** Рабочее тело состояния (для исходного файла — строится один раз и запоминается). */
export function workOf(s: DocState): Work {
  if (s.work) return s.work;
  let w = works.get(s.parse.photometry);
  if (!w) {
    w = workFrom(s.parse.photometry).work;
    works.set(s.parse.photometry, w);
  }
  return w;
}

/**
 * Новый шаг истории: модель после операции. Замечания разбора исходного файла
 * больше не относятся к данным — остаются замечания операции и проверки.
 */
export function applyStep(f: OpenFile, p: Photometry, opIssues: Issue[], label: string, spec?: OpSpec, work?: Work): OpenFile {
  const next = makeState({ photometry: p, issues: [] }, opIssues, label, spec, f.derived ? undefined : f.name, work);
  return { ...f, ...next, past: [...f.past, stateOf(f)].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(f: OpenFile): OpenFile {
  if (!f.past.length) return f;
  const prev = f.past[f.past.length - 1];
  return { ...f, ...prev, past: f.past.slice(0, -1), future: [stateOf(f), ...f.future] };
}

export function redo(f: OpenFile): OpenFile {
  if (!f.future.length) return f;
  const [next, ...rest] = f.future;
  return { ...f, ...next, past: [...f.past, stateOf(f)], future: rest };
}

/** Вернуться к состоянию истории: index — номер в past (0 — исходный файл). */
export function jumpTo(f: OpenFile, index: number): OpenFile {
  let g = f;
  while (g.past.length > index) g = undo(g);
  return g;
}

/** Есть ли несохранённые изменения. */
export const isModified = (f: OpenFile) => (f.savedLen != null ? f.past.length !== f.savedLen : f.past.length > 0 || !!f.derived);

/**
 * Удалить текущее состояние из истории: текущим становится предыдущее, шаги «вперёд» сохраняются.
 * У исходного состояния (истории нет) — без изменений.
 */
export function deleteCurrent(f: OpenFile): OpenFile {
  if (!f.past.length) return f;
  const prev = f.past[f.past.length - 1];
  const savedLen = f.savedLen != null && f.savedLen >= f.past.length ? f.savedLen - 1 : f.savedLen;
  return { ...f, ...prev, past: f.past.slice(0, -1), savedLen };
}

/** Имя без расширения. */
export function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.(ies|ldt)$/i, '');
}
