/**
 * Тексты для фонового потока (журнал пакетной обработки): те же файлы переводов, что у интерфейса,
 * без i18next — подстановка {{param}} вручную.
 */

import type { Lang } from '../core/issues';
import de from '../app/locales/de.json';
import en from '../app/locales/en.json';
import ru from '../app/locales/ru.json';

const DICTS: Record<Lang, unknown> = { ru, en, de };

export function tr(lang: Lang, key: string, params: Record<string, unknown> = {}): string {
  const get = (d: unknown) => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), d);
  const s = get(DICTS[lang]) ?? get(DICTS.ru);
  if (typeof s !== 'string') return key;
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(params[k] ?? ''));
}
