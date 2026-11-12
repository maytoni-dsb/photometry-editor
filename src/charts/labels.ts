/**
 * Подписи на графиках. Язык подписей выбирается отдельно от языка интерфейса.
 */

import type { Lang } from '../core/issues';

export interface ChartLabels {
  cdklm: string;
  cd: string;
  lm: string;
  w: string;
  flux: string;
  imax: string;
  /** Нижний индекс в Iₘₐₓ. */
  maxSub: string;
  gammaAxis: string;
}

export const chartLabels: Record<Lang, ChartLabels> = {
  ru: { cdklm: 'кд/клм', cd: 'кд', lm: 'лм', w: 'Вт', flux: 'Φ', imax: 'Iмакс', maxSub: 'макс', gammaAxis: 'γ, °' },
  en: { cdklm: 'cd/klm', cd: 'cd', lm: 'lm', w: 'W', flux: 'Φ', imax: 'Imax', maxSub: 'max', gammaAxis: 'γ, °' },
  de: { cdklm: 'cd/klm', cd: 'cd', lm: 'lm', w: 'W', flux: 'Φ', imax: 'Imax', maxSub: 'max', gammaAxis: 'γ, °' },
};

/** Число в записи языка подписей: десятичная запятая для ru / de, разряды через узкий пробел от 10 000. */
export function fmtNum(lang: Lang, x: number, decimals = 0): string {
  const fixed = Math.abs(x) < 1e15 ? x.toFixed(decimals) : String(x);
  let [int, frac] = fixed.split('.');
  const neg = int.startsWith('-');
  if (neg) int = int.slice(1);
  if (int.length > 4) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ');
  const sep = lang === 'en' ? '.' : ',';
  return (neg ? '\u2212' : '') + int + (frac ? sep + frac : '');
}

/** Угол с градусом и настоящим знаком минуса: «−30°». */
export function fmtAngle(g: number): string {
  const r = Math.round(g * 100) / 100;
  return `${r < 0 ? '\u2212' : ''}${Math.abs(r)}°`;
}

/** Подпись пары плоскостей: «C0–C180». */
export function planeLabel(c: number): string {
  const a = ((c % 360) + 360) % 360;
  const b = (a + 180) % 360;
  const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return `C${f(a)}–C${f(b)}`;
}
