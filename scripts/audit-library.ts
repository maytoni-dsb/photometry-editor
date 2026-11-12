/**
 * Проверка библиотеки фотометрических файлов.
 *
 *   npm run audit -- <папка> [--out reports/audit] [--lang ru|en|de] [--min info|warning|error]
 *
 * Для каждого файла: чтение, проверки, обратная запись в тот же формат и
 * конвертация в другой формат с повторным чтением и сравнением сил света.
 * Пары IES/LDT с одинаковым именем сверяются между собой.
 * Результат: сводка в консоли, <out>.csv (по замечанию в строке) и <out>.json.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import {
  comparePair,
  computeFlux,
  diffIntensity,
  formatIssue,
  parseFile,
  parseIES,
  parseLDT,
  typeBToC,
  validatePhotometry,
  writeIES,
  writeLDT,
  type Issue,
  type Lang,
  type Photometry,
} from '../src/core/index';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('Usage: npm run audit -- <folder> [--out reports/audit] [--lang ru]');
  process.exit(1);
}
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const out = opt('out', 'reports/audit');
const lang = opt('lang', 'ru') as Lang;
const rank = { info: 0, warning: 1, error: 2 } as const;
const minRank = rank[opt('min', 'info') as keyof typeof rank] ?? 0;

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ies|ldt)$/i.test(n) ? [p] : [];
  });
}

interface Row {
  file: string;
  issues: Issue[];
  roundTrip?: number;
  crossFormat?: number;
  flux?: number;
  peak?: number;
  failed?: string;
}

const rows: Row[] = [];
const models = new Map<string, Photometry>();
const files = walk(dir).sort();
const t0 = Date.now();

for (const f of files) {
  const name = basename(f);
  const row: Row = { file: name, issues: [] };
  rows.push(row);
  try {
    const { photometry, issues } = parseFile(new Uint8Array(readFileSync(f)), name);
    row.issues.push(...issues, ...validatePhotometry(photometry, { fileName: name }));
    let p = photometry;
    if (p.photometryType === 'B') {
      const r = typeBToC(p);
      row.issues.push(...r.issues);
      p = r.photometry;
    }
    if (p.photometryType !== 'C') continue;
    models.set(f, p);
    row.flux = Math.round(computeFlux(p).total * 10) / 10;
    // обратная запись в тот же формат
    const isIes = /\.ies$/i.test(name);
    const same = isIes ? parseIES(writeIES(photometry), name).photometry : parseLDT(writeLDT(p).text, name).photometry;
    row.roundTrip = diffIntensity(p, same.photometryType === 'B' ? typeBToC(same).photometry : same).maxRelToPeak;
    // конвертация в другой формат
    const other = isIes ? parseLDT(writeLDT(p).text, name).photometry : parseIES(writeIES(p), name).photometry;
    row.crossFormat = diffIntensity(p, other).maxRelToPeak;
  } catch (e) {
    row.failed = (e as Error).message;
  }
}

// пары IES/LDT
const byBase = new Map<string, string[]>();
for (const f of models.keys()) {
  const k = join(dirname(f), basename(f, extname(f))).toLowerCase();
  byBase.set(k, [...(byBase.get(k) ?? []), f]);
}
let pairs = 0;
for (const group of byBase.values()) {
  if (group.length !== 2) continue;
  pairs++;
  const [a, b] = group;
  const pi = comparePair(models.get(a)!, models.get(b)!);
  if (pi.length) rows.find((r) => r.file === basename(a))!.issues.push(...pi);
}

// сводка
const count = new Map<string, number>();
for (const r of rows) for (const i of r.issues) count.set(`${i.severity}\t${i.code}`, (count.get(`${i.severity}\t${i.code}`) ?? 0) + 1);
const failed = rows.filter((r) => r.failed);
const worst = (k: 'roundTrip' | 'crossFormat') => rows.filter((r) => r[k] != null).sort((a, b) => b[k]! - a[k]!).slice(0, 5);

console.log(`Файлов: ${files.length}, пар IES/LDT: ${pairs}, не прочитано: ${failed.length}, время: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
for (const r of failed) console.log(`  НЕ ПРОЧИТАН ${r.file}: ${r.failed}`);
console.log('Замечания:');
for (const [k, v] of [...count.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
for (const k of ['roundTrip', 'crossFormat'] as const) {
  console.log(`Худшие расхождения ${k} (доля от пика):`);
  for (const r of worst(k)) console.log(`  ${r[k]!.toExponential(2)}  ${r.file}`);
}

mkdirSync(dirname(out), { recursive: true });
const csv = ['file;severity;code;message'];
for (const r of rows) {
  if (r.failed) csv.push(`${r.file};error;parse-failed;${r.failed}`);
  for (const i of r.issues) if (rank[i.severity] >= minRank) csv.push(`${r.file};${i.severity};${i.code};${formatIssue(i, lang).replace(/;/g, ',')}`);
}
writeFileSync(`${out}.csv`, '﻿' + csv.join('\n'));
writeFileSync(`${out}.json`, JSON.stringify(rows, null, 1));
console.log(`Отчёт: ${out}.csv, ${out}.json`);
