/**
 * Источники света из таблицы Excel (паспорт → «Загрузить из Excel»): первый лист, первая строка — заголовки.
 * Колонки (без учёта регистра): Количество / NumberOfLamps / Count; Тип / LampType / Type;
 * Световой поток / LuminousFlux / Flux; Цветовая температура / CCT; CRI / Ra; Мощность / Power / Watts.
 */
import type { LampSet } from '../core/index';
import { readXlsx } from './xlsx-read';

const COLS: Record<keyof LampSet, string[]> = {
  count: ['количество', 'число', 'numberoflamps', 'count', 'qty'],
  type: ['тип', 'тип лампы', 'lamptype', 'type', 'lamp'],
  flux: ['световой поток', 'поток', 'luminousflux', 'flux', 'lm'],
  cct: ['цветовая температура', 'цт', 'cct', 'colortemp'],
  cri: ['cri', 'ra', 'индекс цветопередачи'],
  watts: ['мощность', 'power', 'watts', 'w'],
};
const norm = (s: string) => s.trim().toLowerCase().replace(/,\s*(лм|вт|k|к|lm|w)$/i, '').trim();
const num = (s: string) => Number(s.trim().replace(/\s/g, '').replace(',', '.'));

export function lampsFromCells(cells: string[][]): LampSet[] {
  const head = (cells[0] ?? []).map(norm);
  const at = (k: keyof LampSet) => head.findIndex((h) => COLS[k].includes(h));
  const idx = { count: at('count'), type: at('type'), flux: at('flux'), cct: at('cct'), cri: at('cri'), watts: at('watts') };
  if (idx.flux < 0 && idx.type < 0 && idx.cct < 0) return [];
  const out: LampSet[] = [];
  for (const r of cells.slice(1)) {
    const g = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    if ([idx.count, idx.type, idx.flux, idx.cct, idx.cri, idx.watts].every((i) => !g(i))) continue;
    const count = num(g(idx.count));
    const flux = num(g(idx.flux));
    const watts = num(g(idx.watts));
    out.push({
      count: Number.isFinite(count) && count !== 0 ? Math.round(count) : 1,
      type: g(idx.type),
      flux: Number.isFinite(flux) && g(idx.flux) ? flux : null,
      cct: g(idx.cct).replace(/\s*k$/i, ''),
      cri: g(idx.cri),
      watts: Number.isFinite(watts) && g(idx.watts) ? watts : 0,
    });
  }
  return out;
}

export async function lampsFromXlsx(bytes: Uint8Array): Promise<LampSet[]> {
  const { sheets } = await readXlsx(bytes);
  for (const s of sheets) {
    const r = lampsFromCells(s.rows);
    if (r.length) return r;
  }
  return [];
}
