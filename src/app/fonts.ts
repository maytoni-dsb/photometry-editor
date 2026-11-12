/**
 * Шрифты графиков в приложении.
 *
 * Фирменный шрифт — Suisse Intl. Он коммерческий, поэтому в публичный репозиторий не входит:
 * подключается с компьютера пользователя (Local Font Access API в Chrome / Edge) или из файлов
 * OTF / TTF. Подключённый шрифт хранится в браузере (localStorage, base64) и регистрируется
 * на странице через FontFace — график на экране рисуется тем же шрифтом, что и в экспорте.
 * Пока свой шрифт не подключён, используется встроенный Roboto (public/fonts, Apache 2.0).
 */

import { isCff, openFont, type FontSet } from '../charts/fonts';
import { load, remove, save } from './storage';

/** Фирменный шрифт MAYTONI. */
export const BRAND_FONT = 'Suisse Intl';

export interface LoadedFonts {
  set: FontSet;
  family: string;
  custom: boolean;
  cff: boolean;
  /** Начертания, которые удалось подключить: «Regular», «Medium»… */
  styles: string[];
}

let builtin: Promise<FontSet> | null = null;

export function loadBuiltinFonts(): Promise<FontSet> {
  if (!builtin) {
    const base = import.meta.env.BASE_URL;
    const get = (f: string) =>
      fetch(`${base}fonts/${f}`).then((r) => {
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

async function register(family: string, bytes: Uint8Array, weight: string): Promise<void> {
  try {
    const face = new FontFace(family, bytes.slice().buffer, { weight });
    await face.load();
    document.fonts.add(face);
  } catch {
    /* шрифт не подключился к странице — экспорт всё равно работает */
  }
}

interface FaceInfo {
  bytes: Uint8Array;
  family: string;
  sub: string;
  weight: number;
  italic: boolean;
}

/** Разбирает файл шрифта; бросает исключение, если это не шрифт (или коллекция TTC). */
function describe(bytes: Uint8Array): FaceInfo {
  const f = openFont(bytes) as ReturnType<typeof openFont> & { subfamilyName?: string; 'OS/2'?: { usWeightClass?: number }; italicAngle?: number };
  if (!f.familyName) throw new Error('not a font');
  const sub = f.subfamilyName ?? 'Regular';
  const weight = f['OS/2']?.usWeightClass ?? (/bold/i.test(sub) ? 700 : /medium/i.test(sub) ? 500 : 400);
  return { bytes, family: f.familyName, sub, weight, italic: /italic|oblique/i.test(sub) || (f.italicAngle ?? 0) !== 0 };
}

/**
 * Из набора начертаний выбирает обычное (ближе всего к 400) и полужирное для заголовков
 * (Medium 500, иначе ближайшее более жирное). Курсив не берётся.
 */
function pick(faces: FaceInfo[]): { regular: FaceInfo; bold?: FaceInfo } {
  const upright = faces.filter((f) => !f.italic);
  const pool = upright.length ? upright : faces;
  const regular = pool.reduce((a, b) => (Math.abs(b.weight - 400) < Math.abs(a.weight - 400) ? b : a));
  const heavier = pool.filter((f) => f.weight > regular.weight).sort((a, b) => Math.abs(a.weight - 500) - Math.abs(b.weight - 500));
  return { regular, bold: heavier[0] };
}

async function apply(regular: FaceInfo, bold?: FaceInfo): Promise<LoadedFonts> {
  await register(regular.family, regular.bytes, '400');
  if (bold) await register(regular.family, bold.bytes, '500');
  return {
    // символы, которых нет в своём шрифте (Φ, γ в Suisse Intl), берутся из встроенного Roboto
    set: { regular: regular.bytes, bold: bold?.bytes, fallback: (await loadBuiltinFonts()).regular },
    family: regular.family,
    custom: true,
    cff: isCff(openFont(regular.bytes)),
    styles: [regular.sub, ...(bold ? [bold.sub] : [])],
  };
}

function store(regular: FaceInfo, bold?: FaceInfo): void {
  save('custom-font', { regular: toBase64(regular.bytes), bold: bold ? toBase64(bold.bytes) : null });
}

/** Подключает свой шрифт из файлов (одно или несколько начертаний одного семейства). */
export async function setCustomFonts(files: Uint8Array[]): Promise<LoadedFonts> {
  const faces = files.map(describe);
  const family = faces[0].family;
  const { regular, bold } = pick(faces.filter((f) => f.family === family));
  store(regular, bold);
  return apply(regular, bold);
}

/** Есть ли в браузере доступ к шрифтам компьютера (Chrome / Edge). */
export function canUseLocalFonts(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window;
}

interface LocalFontData {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

/**
 * Берёт шрифт, установленный на компьютере (по умолчанию Suisse Intl).
 * Браузер спросит разрешение. Возвращает null, если такого шрифта нет.
 */
export async function setLocalFont(familyQuery = BRAND_FONT): Promise<LoadedFonts | null> {
  const q = (window as unknown as { queryLocalFonts(): Promise<LocalFontData[]> }).queryLocalFonts;
  const all = await q.call(window);
  const norm = (s: string) => s.toLowerCase().replace(/[\s'’_-]+/g, '');
  const want = norm(familyQuery);
  const found = all.filter((f) => norm(f.family).includes(want) || norm(f.postscriptName).includes(want));
  if (!found.length) return null;
  // семейство с самым коротким именем — основное («Suisse Intl», а не «Suisse Intl Mono»)
  const family = found.map((f) => f.family).sort((a, b) => a.length - b.length)[0];
  const faces: FaceInfo[] = [];
  for (const f of found.filter((x) => x.family === family)) {
    if (/italic|oblique/i.test(f.style)) continue;
    try {
      faces.push(describe(new Uint8Array(await (await f.blob()).arrayBuffer())));
    } catch {
      /* начертание не читается (например, коллекция TTC) */
    }
  }
  if (!faces.length) return null;
  const { regular, bold } = pick(faces);
  store(regular, bold);
  return apply(regular, bold);
}

export function clearCustomFont(): void {
  remove('custom-font');
}

export async function loadFonts(): Promise<LoadedFonts> {
  const stored = load<{ regular: string; bold: string | null } | string | null>('custom-font', null);
  if (stored) {
    try {
      // v0.2: хранилась одна строка base64
      const rec = typeof stored === 'string' ? { regular: stored, bold: null } : stored;
      const regular = describe(fromBase64(rec.regular));
      const bold = rec.bold ? describe(fromBase64(rec.bold)) : undefined;
      return await apply(regular, bold);
    } catch {
      clearCustomFont();
    }
  }
  const set = await loadBuiltinFonts();
  await register('Roboto', set.regular, '400');
  if (set.bold) await register('Roboto', set.bold, '500');
  return { set, family: 'Roboto', custom: false, cff: false, styles: ['Regular', 'Medium'] };
}
