/** Открытый файл: исходные байты, модель, сводка и замечания. */

import {
  parseFile,
  summarize,
  typeBToC,
  validatePhotometry,
  type Issue,
  type ParseResult,
  type PhotometrySummary,
} from '../core/index';

export interface OpenFile {
  id: string;
  name: string;
  parse: ParseResult;
  summary: PhotometrySummary;
  /** Замечания разбора и проверки. */
  issues: Issue[];
}

let seq = 0;

export function openBytes(name: string, bytes: Uint8Array): OpenFile {
  const parse = parseFile(bytes, name);
  const p = parse.photometry;
  const summary = summarize(p);
  const issues = [...parse.issues];
  if (p.photometryType === 'B') issues.push(...typeBToC(p).issues.filter((i) => i.code === 'typeb-light-outside'));
  issues.push(...validatePhotometry(summary.asC, { fileName: name }));
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { id: `f${++seq}`, name, parse, summary, issues };
}

/** Имя без расширения. */
export function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.(ies|ldt)$/i, '');
}
