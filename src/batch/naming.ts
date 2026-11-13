/**
 * Имена выходных файлов пакетной обработки (ТЗ, «Пакетная выгрузка»):
 *  - по умолчанию — как исходный файл (в библиотеке имя = артикул вместе с вариантом «@ 3000K»);
 *  - по выбору — артикул из файла (IES [LUMCAT], LDT строка 10); нет артикула → имя исходного файла;
 *  - вариант — «<артикул> @ <суффикс>»;
 *  - совпадение имён → суффикс _2, _3 (без учёта регистра: Windows не различает).
 */

import { articleFromFileName } from '../core/index';
import type { Photometry } from '../core/model';

export type NamingMode = 'source' | 'article';

/** Имя без запрещённых в Windows символов. */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'photometry';
}

/** Базовое имя выходного файла (без расширения). */
export function outputBase(p: Photometry, sourceName: string, mode: NamingMode, variantSuffix?: string): string {
  const { base, withoutVariant } = articleFromFileName(sourceName);
  const article = p.meta.article.trim();
  if (variantSuffix != null) {
    const head = mode === 'article' && article ? article.replace(/\s*@.*$/, '') : withoutVariant || article || base;
    return safeName(`${head} @ ${variantSuffix.trim()}`);
  }
  return safeName(mode === 'article' && article ? article : base);
}

/** Раздаёт уникальные имена в пределах одной папки архива. */
export class NameRegistry {
  private used = new Map<string, Set<string>>();

  /** Свободное имя «base», «base_2»… для расширения ext в папке dir. */
  take(dir: string, base: string, ext: string): string {
    const key = `${dir}|${ext.toLowerCase()}`;
    let set = this.used.get(key);
    if (!set) this.used.set(key, (set = new Set()));
    let name = base;
    for (let k = 2; set.has(name.toLowerCase()); k++) name = `${base}_${k}`;
    set.add(name.toLowerCase());
    return name;
  }

  /** Одно имя сразу для нескольких расширений (IES и LDT одного файла называются одинаково). */
  takeAll(dir: string, base: string, exts: string[]): string {
    for (let k = 1; ; k++) {
      const name = k === 1 ? base : `${base}_${k}`;
      if (exts.every((e) => !this.used.get(`${dir}|${e.toLowerCase()}`)?.has(name.toLowerCase()))) {
        for (const e of exts) this.take(dir, name, e);
        return name;
      }
    }
  }
}
