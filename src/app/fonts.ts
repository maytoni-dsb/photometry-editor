/**
 * Шрифты графиков в приложении: встроенный Roboto (public/fonts) или свой шрифт пользователя.
 * Свой шрифт сохраняется в localStorage (base64), подключается к странице через FontFace,
 * чтобы график на экране был тем же шрифтом, что и в экспорте.
 */

import { isCff, openFont, type FontSet } from '../charts/fonts';
import { load, remove, save } from './storage';

export interface LoadedFonts {
  set: FontSet;
  family: string;
  custom: boolean;
  cff: boolean;
}

let builtin: Promise<FontSet> | null = null;

export function loadBuiltinFonts(): Promise<FontSet> {
  if (!builtin) {
    const base = import.meta.env.BASE_URL;
    const get = (f: string) => fetch(`${base}fonts/${f}`).then((r) => {
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    builtin = Promise.all([get('Roboto-Regular.woff'), get('Roboto-Medium.woff')]).then(([r, b]) => ({
      regular: new Uint8Array(r),
      bold: new Uint8Array(b),
    }));
  }
  return builtin;
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function register(family: string, bytes: Uint8Array, weight = '400'): Promise<void> {
  try {
    const face = new FontFace(family, bytes.slice().buffer, { weight });
    await face.load();
    document.fonts.add(face);
  } catch {
    /* шрифт не подключился к странице — экспорт всё равно работает */
  }
}

/** Разбирает файл шрифта пользователя; бросает исключение, если это не шрифт. */
export function describeFont(bytes: Uint8Array): { family: string; cff: boolean } {
  const f = openFont(bytes);
  return { family: f.familyName || 'Custom', cff: isCff(f) };
}

export async function setCustomFont(bytes: Uint8Array): Promise<LoadedFonts> {
  const { family, cff } = describeFont(bytes);
  save('custom-font', toBase64(bytes));
  await register(family, bytes);
  return { set: { regular: bytes }, family, custom: true, cff };
}

export function clearCustomFont(): void {
  remove('custom-font');
}

export async function loadFonts(): Promise<LoadedFonts> {
  const stored = load<string | null>('custom-font', null);
  if (stored) {
    try {
      const bytes = fromBase64(stored);
      const { family, cff } = describeFont(bytes);
      await register(family, bytes);
      return { set: { regular: bytes }, family, custom: true, cff };
    } catch {
      clearCustomFont();
    }
  }
  const set = await loadBuiltinFonts();
  await register('Roboto', set.regular, '400');
  if (set.bold) await register('Roboto', set.bold, '500');
  return { set, family: 'Roboto', custom: false, cff: false };
}
