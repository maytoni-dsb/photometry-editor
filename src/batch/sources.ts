/**
 * Источники света файла (комплекты ламп) — для сохранения «по источнику».
 *
 * Первый источник задаёт силы света; файл для источника k — силы света × Φk / Φ1, в файле только этот источник.
 * Имена: лампа — «<артикул светильника> @ <артикул лампы>» (тип лампы «LED / <артикул лампы>»);
 * абсолютная фотометрия с несколькими источниками — «<артикул светильника> @ <CCT>K».
 */
import { clonePhotometry, type LampSet, type Photometry } from '../core/index';
import { cctLabel } from './import-table';

/** Артикул лампы из типа «LED / <артикул>» (часть после последней «/»); нет — пусто. */
export function lampArticle(l: LampSet | undefined): string {
  const m = /\/\s*([^/]+?)\s*$/.exec(l?.type ?? '');
  return m ? m[1] : '';
}

/** Суффикс имени файла для источника k (без « @ »). */
export function sourceSuffix(p: Photometry, k: number): string {
  const l = p.lamps[k];
  if (!l) return String(k + 1);
  const art = lampArticle(l);
  if (!p.absolute && art) return art;
  if (l.cct.trim()) return cctLabel(l.cct);
  return art || String(k + 1);
}

/** Модель с одним источником k: силы света в масштабе его потока. */
export function sourceVariant(p: Photometry, k: number): Photometry {
  const q = clonePhotometry(p);
  const l0 = p.lamps[0];
  const lk = p.lamps[k];
  if (!lk) return q;
  if (k > 0 && l0?.flux && lk.flux && l0.flux > 0 && lk.flux > 0) {
    const s = lk.flux / l0.flux;
    q.candela = q.candela.map((row) => row.map((x) => x * s));
  }
  q.lamps = [{ ...lk, count: p.absolute ? -1 : Math.max(1, Math.abs(lk.count) || 1) }];
  return q;
}

export type IesMode = 'one' | 'each';
export type LdtMode = 'one' | 'all' | 'each';

export interface SavePlanItem {
  /** Имя без расширения. */
  base: string;
  fmt: 'ies' | 'ldt';
  photometry: Photometry;
}

/** Какие файлы получатся при сохранении. */
export function savePlan(p: Photometry, base: string, opts: { ies: boolean; ldt: boolean; iesMode: IesMode; ldtMode: LdtMode; source: number }): SavePlanItem[] {
  const n = Math.max(1, p.lamps.length);
  const many = n > 1;
  const named = (k: number) => (many ? `${base} @ ${sourceSuffix(p, k)}` : base);
  const out: SavePlanItem[] = [];
  const each = (fmt: 'ies' | 'ldt') => {
    for (let k = 0; k < n; k++) out.push({ base: named(k), fmt, photometry: sourceVariant(p, k) });
  };
  if (opts.ies) {
    if (many && opts.iesMode === 'each') each('ies');
    else out.push({ base: named(opts.source), fmt: 'ies', photometry: sourceVariant(p, many ? opts.source : 0) });
  }
  if (opts.ldt) {
    if (many && opts.ldtMode === 'each') each('ldt');
    else if (many && opts.ldtMode === 'all') out.push({ base, fmt: 'ldt', photometry: clonePhotometry(p) });
    else out.push({ base: named(opts.source), fmt: 'ldt', photometry: sourceVariant(p, many ? opts.source : 0) });
  }
  return out;
}

/** Источники, имена файлов которых совпадут (одинаковый суффикс «@ …»). */
export function duplicateSources(p: Photometry): Set<number> {
  const out = new Set<number>();
  if (p.lamps.length < 2) return out;
  const seen = new Map<string, number>();
  p.lamps.forEach((_, k) => {
    const key = sourceSuffix(p, k).toLowerCase();
    const j = seen.get(key);
    if (j != null) {
      out.add(j);
      out.add(k);
    } else seen.set(key, k);
  });
  return out;
}
