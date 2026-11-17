/**
 * Пользователь (оператор) — пишется в файлы (LDT строка 12, IES [_OPERATOR]).
 * Список имён — public/users.txt в репозитории (одно имя на строку, # — комментарий); выбор запоминается в браузере.
 */
import type { HouseContext } from '../batch/house';
import { load, save } from './storage';

let current = load('user', '');

export const getUser = () => current;
export function setUser(name: string): void {
  current = name.trim();
  save('user', current);
}

export const houseCtx = (): HouseContext => ({ user: current, version: __APP_VERSION__ });

/** Имена из public/users.txt. */
export async function fetchUsers(): Promise<string[]> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}users.txt`, { cache: 'no-cache' });
    if (!r.ok) return [];
    return parseUsers(await r.text());
  } catch {
    return [];
  }
}

export function parseUsers(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.replace(/#.*$/, '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
